/** Transport recovery around the complete native CLI; never implements an agent turn. */
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

const sessionPattern = /^sess_[a-zA-Z0-9-]+$/u
const networkError = /\b(?:fetch failed|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|connection (?:reset|closed)|stream (?:interrupted|closed)|premature close|network error|transport error)\b/iu

async function jsonLines(path) {
  let source
  try { source = await readFile(path, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!line.trim()) return []
    try { return [JSON.parse(line)] } catch (error) {
      if (index === lines.length - 1) return []
      throw error
    }
  })
}

export async function readRootSession(root) {
  // Only inspect identity. The original CLI remains the sole writer of session state.
  let database
  try {
    const path = join(root, 'zcode-home/cli/db/db.sqlite')
    try { await stat(path) } catch (error) {
      if (error.code === 'ENOENT') return { found: false, reason: 'session-store-not-created', bootstrapSafe: true }
      throw error
    }
    database = new DatabaseSync(path, { readOnly: true })
    const rows = database.prepare("SELECT id FROM session WHERE directory = ? AND (parent_id IS NULL OR parent_id = '') LIMIT 2").all('/app')
    if (rows.length === 0 && database.prepare('SELECT COUNT(*) AS count FROM session').get().count === 0) {
      return { found: false, reason: 'empty-session-store', bootstrapSafe: true }
    }
    if (rows.length !== 1 || !sessionPattern.test(rows[0].id)) {
      return { found: false, reason: rows.length > 1 ? 'ambiguous-root-session' : 'missing-root-session' }
    }
    return { found: true, sessionId: rows[0].id }
  } catch {
    return { found: false, reason: 'session-store-unavailable' }
  } finally {
    database?.close()
  }
}

export async function transportFailure(root, startedMs, execution) {
  let receipt, rows = [], relay = []
  try {
    receipt = JSON.parse(await readFile(join(root, 'ApiReceipt.json'), 'utf8'))
    rows = await jsonLines(receipt.wire_file)
    if (receipt.relay_wire_file) relay = await jsonLines(receipt.relay_wire_file)
  } catch {
    return { recoverable: false, reason: 'no-current-transport-evidence' }
  }
  const request = rows.filter(row => row.event === 'request' && row.at_ms >= startedMs).at(-1)
  if (!request) {
    const local = relay.filter(row => row.event === 'relay-error' && row.at_ms >= startedMs).at(-1)
    const socketFailure = execution.code !== 0 && networkError.test(execution.stderr)
    return { recoverable: Boolean(local?.retryable || socketFailure),
      reason: local?.retryable ? 'confirmed-local-relay-failure' : socketFailure ? 'native-connection-failed' : 'no-request-in-this-invocation',
      request_at_ms: local?.started_at_ms ?? startedMs }
  }
  const events = rows.filter(row => row.sequence === request.sequence)
  const response = events.findLast(row => row.event === 'response')
  const terminal = events.findLast(row => row.event === 'finished')
  const error = events.findLast(row => row.event === 'request-error')
  const laterLocal = relay.filter(row => row.event === 'relay-error' && row.retryable
    && row.started_at_ms > Math.max(startedMs, terminal?.at_ms ?? request.at_ms)).at(-1)
  if (laterLocal) return { recoverable: true, reason: 'confirmed-local-relay-failure', request_at_ms: laterLocal.started_at_ms }
  const usable = ['response.completed', 'response.incomplete'].includes(terminal?.type)
    && !terminal.error_code && typeof terminal.usage === 'object' && terminal.usage !== null
  const localDisconnect = execution.code !== 0 && networkError.test(execution.stderr)
  if (usable) return { recoverable: localDisconnect, reason: localDisconnect ? 'native-client-disconnected' : 'completed-response', sequence: request.sequence, request_at_ms: terminal.at_ms }
  const status = response?.status
  const retryableStatus = status === 408 || status === 429 || (status >= 500 && status <= 599)
  const retryableTerminal = ['server_error', 'rate_limit_exceeded', 'timeout', 'network_error'].includes(terminal?.error_code)
  // A bad request, rejected identity, or authentication error needs inspection, not another turn.
  const rejected = events.some(row => row.event === 'identity-rejected') || (status >= 400 && status < 500 && ![408, 429].includes(status))
  return { recoverable: !rejected && Boolean(retryableStatus || retryableTerminal || (!terminal && (error || localDisconnect))),
    reason: rejected ? 'non-transport-rejection' : retryableStatus ? 'retryable-http-status' : error ? 'interrupted-provider-request' : localDisconnect ? 'native-client-disconnected' : 'no-transport-failure',
    sequence: request.sequence, request_at_ms: request.at_ms, ...(status === undefined ? {} : { http_status: status }) }
}

export async function writeRecovery(root, record) {
  const target = join(root, 'NativeSessionRecovery.json')
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n')
  await rename(temporary, target)
}

// Only confirmed failed requests receive a refund. An unfinished live request
// keeps consuming the budget until a failure receipt proves otherwise.
export async function budgetSnapshot(root, startedMs, nowMs) {
  let rows = []
  try {
    const receipt = JSON.parse(await readFile(join(root, 'ApiReceipt.json'), 'utf8'))
    rows = await jsonLines(receipt.wire_file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const requests = rows.filter(row => row.event === 'request')
  const intervals = []
  try {
    const outages = JSON.parse(await readFile(join(root, 'NativeTransportOutages.json'), 'utf8'))
    for (const row of outages.intervals) intervals.push([Math.max(startedMs, row.started_at_ms), Math.min(nowMs, row.finished_at_ms ?? nowMs)])
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index]
    const events = rows.filter(row => row.sequence === request.sequence)
    const terminal = events.findLast(row => row.event === 'finished')
    const usable = ['response.completed', 'response.incomplete'].includes(terminal?.type)
      && !terminal.error_code && terminal.usage !== null && typeof terminal.usage === 'object'
    if (usable) continue
    const failure = events.findLast(row => row.event === 'request-error' || row.event === 'finished')
    if (!failure) continue
    intervals.push([Math.max(startedMs, request.at_ms), Math.min(nowMs,
      Math.max(failure.at_ms, requests[index + 1]?.at_ms ?? nowMs))])
  }
  try {
    const suspensions = JSON.parse(await readFile(join(root, 'NativeSuspensions.json'), 'utf8'))
    for (const row of suspensions.intervals) intervals.push([Math.max(startedMs, row.started_at_ms), Math.min(nowMs, row.finished_at_ms)])
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const merged = []
  for (const [left, right] of intervals.sort((a, b) => a[0] - b[0])) {
    if (merged.length && left <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], right)
    else merged.push([left, Math.max(left, right)])
  }
  return { excluded_retry_ms: merged.reduce((sum, [left, right]) => sum + right - left, 0) }
}

export async function invokeCli(command, { root, index, budgetMs, remainingMs }) {
  const prefix = `zcode-invocation-${String(index).padStart(3, '0')}`
  let stdout = '', stderr = '', timedOut = false, interrupted = false
  const child = spawn('docker', command, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  let escalation
  const terminate = () => {
    child.kill('SIGTERM')
    escalation ??= setTimeout(() => child.kill('SIGKILL'), 5_000)
    escalation.unref()
  }
  const stop = () => { interrupted = true; terminate() }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  let timer, budgetError, closed = false, budgetCancelledAtMs = 0
  const checkBudget = async () => {
    try {
      const remaining = remainingMs ? await remainingMs() : budgetMs
      if (closed) return
      if (remaining <= 0) { timedOut = true; budgetCancelledAtMs = Date.now(); terminate(); return }
      timer = setTimeout(checkBudget, Math.min(1000, remaining))
    } catch (error) { budgetError = error; terminate() }
  }
  timer = setTimeout(remainingMs ? checkBudget : () => { timedOut = true; terminate() }, Math.min(remainingMs ? 1000 : budgetMs, budgetMs))
  let code
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', value => resolve(value ?? 1))
    })
  } finally {
    closed = true
    clearTimeout(timer)
    clearTimeout(escalation)
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop)
    await writeFile(join(root, `${prefix}.stdout.json`), stdout)
    await writeFile(join(root, `${prefix}.stderr.log`), stderr)
    await writeFile(join(root, 'zcode.stdout.json'), stdout)
    await writeFile(join(root, 'zcode.stderr.log'), stderr)
  }
  let result = {}
  try { result = JSON.parse(stdout) } catch { /* Failure receipts still come from the provider and native session store. */ }
  if (budgetError) throw budgetError
  return { code, result, stderr, timedOut, interrupted, budgetCancelledAtMs }
}

export async function executeNative(input, command, dependencies = {}) {
  const now = dependencies.now ?? Date.now
  const invoke = dependencies.invoke ?? invokeCli
  const inspectSession = dependencies.readSession ?? readRootSession
  const inspectFailure = dependencies.transportFailure ?? transportFailure
  const save = dependencies.writeRecovery ?? writeRecovery
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const inspectBudget = dependencies.budgetSnapshot ?? budgetSnapshot
  const resumedAt = now()
  let previous
  if (input.resume_native_session) {
    previous = JSON.parse(await readFile(join(input.run_dir, 'NativeSessionRecovery.json'), 'utf8'))
    const identity = await inspectSession(input.run_dir)
    const last = previous.invocations.at(-1)
    const currentFailure = last ? await inspectFailure(input.run_dir, last.started_at_ms,
      { code: last.exit_code, stderr: '' }) : { recoverable: false, reason: 'no-previous-invocation' }
    const confirmedInterruption = currentFailure.recoverable
      || ['completed-response', 'no-request-in-this-invocation'].includes(currentFailure.reason)
    if (!previous.preserve_workspace || previous.original_budget_ms !== input.timeout_ms
      || !identity.found || previous.session_id && identity.sessionId !== previous.session_id
      || last?.exit_code !== 137 || !confirmedInterruption
      || !previous.session_id && !currentFailure.recoverable) {
      throw new Error('Retained native session or budget does not match verified recovery')
    }
    // A late transport receipt can appear after the CLI exits, before the old
    // recovery record could capture its session. The native store is authoritative.
    previous.session_id = identity.sessionId
    previous.retained_verifications ??= []
    previous.retained_verifications.push({ at_ms: resumedAt, session_id: identity.sessionId,
      transport_observation: currentFailure, previous_reason: previous.reason })
    const path = join(input.run_dir, 'NativeSuspensions.json')
    let suspensions = { schema: 1, intervals: [] }
    try { suspensions = JSON.parse(await readFile(path, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
    suspensions.intervals.push({ started_at_ms: previous.invocations.at(-1).finished_at_ms,
      finished_at_ms: resumedAt, reason: 'no-native-process-during-preserved-host-pause' })
    await writeFile(path, JSON.stringify(suspensions) + '\n')
  }
  const started = previous?.started_at_ms ?? resumedAt
  const record = previous ?? { schema: 3, policy: 'native-cli-resume-effective-budget/v3', started_at_ms: started,
    original_budget_ms: input.timeout_ms, native_cli_unchanged: true,
    same_workspace_and_home: true, resume_prompt: 'Continue.', invocations: [], phase: 'running' }
  const remainingMs = async () => {
    const clock = now(), budget = await inspectBudget(input.run_dir, started, clock)
    record.excluded_retry_ms = budget.excluded_retry_ms
    record.effective_elapsed_ms = Math.max(0, clock - started - budget.excluded_retry_ms)
    return input.timeout_ms - record.effective_elapsed_ms
  }
  let outages = { schema: 1, confirmed_transport_only: true, intervals: [] }
  if (previous) {
    try { outages = JSON.parse(await readFile(join(input.run_dir, 'NativeTransportOutages.json'), 'utf8')) }
    catch (e) { if (e.code !== 'ENOENT') throw e }
    record.restarts ??= []; record.restarts.push({ at_ms: resumedAt, session_id: previous.session_id })
  }
  const saveOutages = dependencies.writeOutages ?? (async value => {
    const path = join(input.run_dir, 'NativeTransportOutages.json'), temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(value) + '\n'); await rename(temporary, path)
  })
  const waitForTransport = dependencies.waitForTransport ?? (async () => {
    let receipt
    try { receipt = JSON.parse(await readFile(join(input.run_dir, 'ApiReceipt.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (!receipt.transport_health_file) return
    for (;;) {
      try {
        const health = JSON.parse(await readFile(receipt.transport_health_file, 'utf8'))
        if (health.passed && now() - health.at * 1000 < 20_000 && (health.retry_after_ms ?? 0) <= now()) return
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      await sleep(2000)
    }
  })
  let sessionId = previous?.session_id, lastResult = {}
  for (let index = record.invocations.length; ; index++) {
    const remaining = await remainingMs()
    if (remaining <= 0) {
      record.phase = 'time-budget-exhausted'
      record.preserve_workspace = false
      await save(input.run_dir, record)
      return { result: lastResult, timedOut: true, elapsedMs: now() - started, recovery: record, budgetCancelledAtMs: now() }
    }
    const invocationStarted = now()
    const pending = outages.intervals.at(-1)
    if (pending && pending.finished_at_ms === undefined) { pending.finished_at_ms = invocationStarted; await saveOutages(outages) }
    // Never resubmit the issue or add solution guidance. The CLI loads its own persisted state.
    const args = sessionId ? [...command.slice(0, -2), '--resume', sessionId, '-p', 'Continue.'] : command
    record.phase = 'running'
    await save(input.run_dir, record)
    const execution = await invoke(args, { root: input.run_dir, index, budgetMs: remaining, remainingMs })
    lastResult = execution.result
    record.invocations.push({ index, started_at_ms: invocationStarted, finished_at_ms: now(),
      exit_code: execution.code, resumed: Boolean(sessionId), ...(sessionId ? { session_id: sessionId } : {}) })
    if (execution.interrupted) {
      record.phase = 'interrupted'; record.preserve_workspace = true
      await save(input.run_dir, record)
      throw new Error('Native ZCode interrupted; session retained')
    }
    if (execution.timedOut || await remainingMs() <= 0) {
      record.phase = 'time-budget-exhausted'
      record.preserve_workspace = false
      await save(input.run_dir, record)
      return { result: lastResult, timedOut: true, elapsedMs: now() - started, recovery: record,
        budgetCancelledAtMs: execution.budgetCancelledAtMs || now() }
    }
    if (sessionId && execution.result.sessionId && execution.result.sessionId !== sessionId) {
      record.phase = 'blocked'; record.reason = 'native-session-identity-changed'; record.preserve_workspace = true
      await save(input.run_dir, record)
      throw new Error('Native ZCode resumed a different session')
    }
    let failure = await inspectFailure(input.run_dir, invocationStarted, execution)
    if (execution.code === 137 && !failure.recoverable && failure.reason === 'no-transport-failure') {
      // The relay writes its terminal error after noticing the killed client.
      // Re-read the evidence; never infer a successful or failed model answer.
      await sleep(2000)
      failure = await inspectFailure(input.run_dir, invocationStarted, execution)
    }
    // Exit 137 is a runtime interruption, not proof of a completed native answer.
    // Resume only a uniquely identified native session; completed work is not refunded.
    const runtimeInterrupted = execution.code === 137 && ['completed-response', 'no-request-in-this-invocation'].includes(failure.reason)
    if (!failure.recoverable && !runtimeInterrupted) {
      if (execution.code === 0 && execution.result.sessionId && failure.reason === 'completed-response') {
        record.phase = 'completed'; record.session_id = execution.result.sessionId; record.preserve_workspace = false
        await save(input.run_dir, record)
        return { result: execution.result, timedOut: false, elapsedMs: now() - started, recovery: record }
      }
      record.phase = 'blocked'; record.reason = failure.reason; record.preserve_workspace = true
      await save(input.run_dir, record)
      throw new Error('Native ZCode stopped without a recoverable transport failure; session retained')
    }
    const identity = await inspectSession(input.run_dir)
    const bootstrap = !runtimeInterrupted && !sessionId && !identity.found && identity.bootstrapSafe === true
    if ((!identity.found && !bootstrap) || (sessionId && identity.sessionId !== sessionId)) {
      record.phase = 'blocked'; record.reason = identity.reason ?? 'native-session-identity-changed'; record.preserve_workspace = true
      await save(input.run_dir, record)
      throw new Error('Native ZCode session identity unavailable; refusing to create a replacement session')
    }
    if (identity.found) sessionId = identity.sessionId
    record.phase = runtimeInterrupted ? 'runtime-retry' : bootstrap ? 'transport-bootstrap-retry' : 'transport-retry'
    if (sessionId) record.session_id = sessionId
    record.preserve_workspace = true
    record.invocations.at(-1)[runtimeInterrupted ? 'runtime_failure' : 'transport_failure'] = failure
    if (!runtimeInterrupted) {
      outages.intervals.push({ started_at_ms: failure.request_at_ms ?? invocationStarted, reason: failure.reason })
      await saveOutages(outages)
    }
    await save(input.run_dir, record)
    // No fresh work budget per reconnect. Failed transmission and its retry wait
    // are excluded using the same provider receipts as the final usage ledger.
    await sleep(Math.max(0, Math.min(120_000, 30_000 * 2 ** Math.min(index, 2), await remainingMs())))
    await waitForTransport()
  }
}
