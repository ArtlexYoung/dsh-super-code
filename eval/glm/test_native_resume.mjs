import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { executeNative, readRootSession, transportFailure, budgetSnapshot } from './native-resume.mjs'

const sessionId = 'sess_fixture-1'
const original = ['exec', 'task-container', '/opt/node/bin/node', '/opt/zcode/glm/zcode.cjs', '--cwd', '/app', '--mode', 'yolo', '--json', '-p', 'original issue']
const completed = { code: 0, result: { sessionId, response: 'Done' }, stderr: '', timedOut: false, interrupted: false }
const disconnected = { code: 1, result: {}, stderr: 'Error: fetch failed', timedOut: false, interrupted: false }

function harness(overrides = {}) {
  let clock = 0
  const calls = [], records = []
  const deps = {
    now: () => clock,
    invoke: async (args, options) => {
      calls.push({ args, options }); clock += 1000
      return calls.length === 1 ? disconnected : completed
    },
    readSession: async () => ({ found: true, sessionId }),
    transportFailure: async () => calls.length === 1 ? { recoverable: true, reason: 'interrupted-provider-request' } : { recoverable: false, reason: 'completed-response' },
    writeRecovery: async (root, row) => { records.push(structuredClone(row)) },
    writeOutages: async () => {},
    waitForTransport: async () => {},
    sleep: async ms => { clock += ms },
    ...overrides,
  }
  return { calls, records, deps }
}

test('transport interruption resumes the exact native session without resubmitting the issue', async () => {
  const h = harness()
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.calls[0].args, original)
  assert.deepEqual(h.calls[1].args, [...original.slice(0, -2), '--resume', sessionId, '-p', 'Continue.'])
  assert.equal(h.calls[1].options.budgetMs, 29_000)
  assert.equal(result.recovery.phase, 'completed')
  assert.equal(result.recovery.session_id, sessionId)
  assert.equal(result.timedOut, false)
})

test('native success and native internal retries do not trigger an extra prompt', async () => {
  const h = harness({ invoke: async () => completed, transportFailure: async () => ({ recoverable: false, reason: 'completed-response' }) })
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)
  assert.equal(result.recovery.invocations.length, 1)
  assert.equal(result.recovery.phase, 'completed')
})

test('zero exit with no final result still resumes when the provider stream failed', async () => {
  const h = harness()
  const invoke = h.deps.invoke
  h.deps.invoke = async (...args) => ({ ...await invoke(...args), code: 0 })
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)
  assert.equal(h.calls.length, 2)
  assert.equal(result.recovery.session_id, sessionId)
})

test('a clean native error is preserved for inspection, never resumed or retried as a new task', async () => {
  const h = harness({ transportFailure: async () => ({ recoverable: false, reason: 'non-transport-rejection' }) })
  await assert.rejects(executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps), /without a recoverable transport failure/u)
  assert.equal(h.calls.length, 1)
  assert.equal(h.records.at(-1).preserve_workspace, true)
})

test('missing or ambiguous sessions never fall back to creating a new native session', async () => {
  for (const reason of ['missing-root-session', 'ambiguous-root-session']) {
    const h = harness({ readSession: async () => ({ found: false, reason }) })
    await assert.rejects(executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps), /refusing to create a replacement/u)
    assert.equal(h.calls.length, 1)
  }
})

test('a changed native session id blocks recovery', async () => {
  const h = harness()
  const invoke = h.deps.invoke
  h.deps.invoke = async (...args) => {
    const result = await invoke(...args)
    return h.calls.length > 1 ? { ...result, result: { sessionId: 'sess_wrong' } } : result
  }
  await assert.rejects(executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps), /different session/u)
  assert.equal(h.records.at(-1).reason, 'native-session-identity-changed')
})

test('reconnects never renew the one-hour budget or restart a nearly finished task', async () => {
  const h = harness()
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 10_000 }, original, h.deps)
  assert.equal(h.calls.length, 1)
  assert.equal(result.timedOut, true)
  assert.equal(result.elapsedMs, 10_000)
  assert.equal(result.recovery.phase, 'time-budget-exhausted')
})

test('native time limit and external interruption never submit a continuation', async () => {
  const h = harness({ invoke: async () => ({ ...disconnected, timedOut: true }) })
  assert.equal((await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)).timedOut, true)
  const interrupted = harness({ invoke: async () => ({ ...disconnected, interrupted: true }) })
  await assert.rejects(executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, interrupted.deps), /interrupted/u)
  assert.equal(interrupted.records.at(-1).preserve_workspace, true)
})

async function wireFixture(rows, check) {
  const root = await mkdtemp(join(tmpdir(), 'zcode-resume-'))
  try {
    const wire = join(root, 'wire.jsonl')
    await writeFile(wire, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    await writeFile(join(root, 'ApiReceipt.json'), JSON.stringify({ wire_file: wire }))
    await check(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

const request = { event: 'request', sequence: 1, at_ms: 100 }
test('failed requests and retry waits refund work time, while live requests do not', async () => {
  await wireFixture([
    { event: 'request', sequence: 1, at_ms: 100 },
    { event: 'request-error', sequence: 1, at_ms: 200 },
    { event: 'request', sequence: 2, at_ms: 500 },
    { event: 'finished', sequence: 2, at_ms: 800, type: 'response.completed', usage: {} },
    { event: 'request', sequence: 3, at_ms: 900 },
  ], async root => {
    assert.equal((await budgetSnapshot(root, 0, 1000)).excluded_retry_ms, 400)
  })
  await wireFixture([{ event: 'request', sequence: 1, at_ms: 100 },
    { event: 'request-error', sequence: 1, at_ms: 200 }], async root => {
    assert.equal((await budgetSnapshot(root, 0, 1000)).excluded_retry_ms, 900)
  })
})

test('a confirmed transport outage extends wall time without granting a new work budget', async () => {
  let clock = 0, count = 0
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 10_000 }, original, {
    now: () => clock,
    budgetSnapshot: async () => ({ excluded_retry_ms: count ? clock - 1000 : 0 }),
    invoke: async (args, options) => {
      if (count++ === 0) { clock += 6000; return disconnected }
      assert.equal(options.budgetMs, 9000)
      clock += 1000
      return completed
    },
    transportFailure: async () => count === 1 ? { recoverable: true } : { recoverable: false, reason: 'completed-response' },
    readSession: async () => ({ found: true, sessionId }), writeRecovery: async () => {},
    writeOutages: async () => {}, waitForTransport: async () => {},
    sleep: async ms => { clock += ms },
  })
  assert.equal(count, 2)
  assert.equal(result.timedOut, false)
  assert.ok(result.elapsedMs > 10_000)
})

test('only a current failed provider request can authorize a resume', async () => {
  await wireFixture([request, { event: 'request-error', sequence: 1, at_ms: 200, reason: 'TimeoutError' }], async root => {
    assert.equal((await transportFailure(root, 0, disconnected)).recoverable, true)
    assert.equal((await transportFailure(root, 300, completed)).recoverable, false)
  })
})

test('429 and 5xx recover; authentication and bad requests do not', async () => {
  for (const status of [400, 401, 403, 429, 502, 503]) {
    await wireFixture([request, { event: 'response', sequence: 1, at_ms: 200, status }], async root => {
      assert.equal((await transportFailure(root, 0, disconnected)).recoverable, status === 429 || status >= 500)
    })
  }
})

test('successful responses stop recovery, including old failure followed by native retry', async () => {
  await wireFixture([request, { event: 'request-error', sequence: 1 }, { ...request, sequence: 2, at_ms: 300 },
    { event: 'finished', sequence: 2, type: 'response.completed', usage: {} }], async root => {
    assert.equal((await transportFailure(root, 0, completed)).reason, 'completed-response')
    assert.equal((await transportFailure(root, 0, { ...disconnected, stderr: 'Error: invalid configuration' })).recoverable, false)
    assert.equal((await transportFailure(root, 0, disconnected)).reason, 'native-client-disconnected')
  })
})

test('native root lookup excludes child agents and rejects multiple roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-session-'))
  try {
    await mkdir(join(root, 'zcode-home/cli/db'), { recursive: true })
    const db = new DatabaseSync(join(root, 'zcode-home/cli/db/db.sqlite'))
    db.exec('CREATE TABLE session(id TEXT, directory TEXT, parent_id TEXT)')
    const insert = db.prepare('INSERT INTO session VALUES(?,?,?)')
    insert.run(sessionId, '/app', null)
    insert.run('sess_child', '/app', sessionId)
    insert.run('sess_other-workspace', '/other', null)
    assert.deepEqual(await readRootSession(root), { found: true, sessionId })
    insert.run('sess_second-root', '/app', null)
    assert.equal((await readRootSession(root)).reason, 'ambiguous-root-session')
    db.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failure before any native session retries the original command in the same attempt', async () => {
  const h = harness({ readSession: async () => ({ found: false, reason: 'session-store-not-created', bootstrapSafe: true }) })
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)
  assert.deepEqual(h.calls.map(row => row.args), [original, original])
  assert.equal(result.recovery.same_workspace_and_home, true)
  assert.equal(result.recovery.phase, 'completed')
})

test('only absent or provably empty stores permit bootstrap; an unreadable store does not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-bootstrap-'))
  try {
    assert.equal((await readRootSession(root)).bootstrapSafe, true)
    await mkdir(join(root, 'zcode-home/cli/db'), { recursive: true })
    const path = join(root, 'zcode-home/cli/db/db.sqlite')
    await writeFile(path, 'corrupt database')
    assert.notEqual((await readRootSession(root)).bootstrapSafe, true)
    await rm(path)
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE session(id TEXT, directory TEXT, parent_id TEXT)')
    assert.equal((await readRootSession(root)).bootstrapSafe, true)
    db.prepare('INSERT INTO session VALUES(?,?,?)').run('sess_child', '/app', 'sess_missing')
    assert.notEqual((await readRootSession(root)).bootstrapSafe, true)
    db.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('local relay failure and temporary DNS errors recover before an upstream receipt exists', async () => {
  await wireFixture([], async root => {
    const relay = join(root, 'relay-wire.jsonl')
    await writeFile(relay, JSON.stringify({ event: 'relay-error', at_ms: 200, started_at_ms: 100, retryable: true }) + '\n')
    await writeFile(join(root, 'ApiReceipt.json'), JSON.stringify({ wire_file: join(root, 'wire.jsonl'), relay_wire_file: relay }))
    assert.equal((await transportFailure(root, 0, { ...disconnected, stderr: 'Model transport unavailable' })).reason, 'confirmed-local-relay-failure')
    assert.equal((await transportFailure(root, 300, { ...disconnected, stderr: 'invalid config' })).recoverable, false)
    assert.equal((await transportFailure(root, 300, { ...disconnected, stderr: 'getaddrinfo EAI_AGAIN glm-api' })).recoverable, true)
  })
})

test('local recovery waits and provider failures are merged once in the work budget', async () => {
  await wireFixture([request, { event: 'request-error', sequence: 1, at_ms: 200 },
    { ...request, sequence: 2, at_ms: 500 },
    { event: 'finished', sequence: 2, at_ms: 800, type: 'response.completed', usage: {} }], async root => {
    await writeFile(join(root, 'NativeTransportOutages.json'), JSON.stringify({ intervals: [
      { started_at_ms: 100, finished_at_ms: 500 }, { started_at_ms: 850 },
    ] }))
    assert.equal((await budgetSnapshot(root, 0, 1000)).excluded_retry_ms, 550)
  })
})

test('a local failure after earlier successful work is not mistaken for native completion', async () => {
  await wireFixture([request, { event: 'finished', sequence: 1, at_ms: 200, type: 'response.completed', usage: {} }], async root => {
    const relay = join(root, 'relay-wire.jsonl')
    await writeFile(relay, JSON.stringify({ event: 'relay-error', at_ms: 400, started_at_ms: 300, retryable: true }) + '\n')
    await writeFile(join(root, 'ApiReceipt.json'), JSON.stringify({ wire_file: join(root, 'wire.jsonl'), relay_wire_file: relay }))
    const failure = await transportFailure(root, 0, { ...disconnected, stderr: 'Model transport unavailable' })
    assert.equal(failure.recoverable, true)
    assert.equal(failure.request_at_ms, 300)
  })
})

test('repeated outages use capped backoff, the same native identity, and no retry-count limit', async () => {
  let count = 0
  const waits = []
  const h = harness({
    invoke: async args => { h.calls.push({ args }); return ++count > 6 ? completed : disconnected },
    transportFailure: async () => ({ recoverable: count <= 6, reason: count > 6 ? 'completed-response' : 'fixture' }),
    sleep: async ms => { waits.push(ms) },
  })
  await executeNative({ run_dir: '/fixture', timeout_ms: 3_600_000 }, original, h.deps)
  assert.equal(count, 7)
  assert.deepEqual(waits, [30_000, 60_000, 120_000, 120_000, 120_000, 120_000])
  assert.ok(h.calls.slice(1).every(row => row.args.includes(sessionId)))
})

test('a boundary crossed between invocations still records a verifiable budget cancellation', async () => {
  let clock = 100
  const h = harness({ now: () => clock, invoke: async () => { clock += 10_000; return completed } })
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 1000 }, original, h.deps)
  assert.equal(result.timedOut, true)
  assert.ok(result.budgetCancelledAtMs > 0)
})

test('a killed native client rechecks a late relay receipt before pausing', async () => {
  let inspections = 0
  const h = harness({ transportFailure: async () => {
    inspections++
    return inspections === 1 ? { recoverable: false, reason: 'no-transport-failure' }
      : inspections === 2 ? { recoverable: true, reason: 'interrupted-provider-request' }
        : { recoverable: false, reason: 'completed-response' }
  } })
  const invoke = h.deps.invoke
  h.deps.invoke = async (...args) => {
    const result = await invoke(...args)
    return h.calls.length === 1 ? { ...result, code: 137, stderr: '' } : result
  }
  const result = await executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps)
  assert.equal(result.recovery.phase, 'completed')
  assert.equal(inspections, 3)
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls[1].args.includes(sessionId))
})

test('late evidence never turns identity rejection into a recoverable interruption', async () => {
  let inspections = 0
  const h = harness({
    invoke: async () => ({ ...disconnected, code: 137, stderr: '' }),
    transportFailure: async () => ({ recoverable: false,
      reason: ++inspections === 1 ? 'no-transport-failure' : 'non-transport-rejection' }),
  })
  await assert.rejects(executeNative({ run_dir: '/fixture', timeout_ms: 60_000 }, original, h.deps),
    /without a recoverable transport failure/u)
  assert.equal(h.records.at(-1).reason, 'non-transport-rejection')
})

test('retained recovery verifies late transport and the unique persisted session, retaining spent budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-late-retained-'))
  try {
    const previous = { started_at_ms: 0, original_budget_ms: 60_000, preserve_workspace: true,
      reason: 'no-transport-failure', invocations: [{ started_at_ms: 0, finished_at_ms: 2000, exit_code: 137 }] }
    await writeFile(join(root, 'NativeSessionRecovery.json'), JSON.stringify(previous))
    const calls = []
    let inspections = 0
    const h = harness({ now: () => 5000,
      invoke: async (args, options) => { calls.push({ args, options }); return completed },
      budgetSnapshot: async () => ({ excluded_retry_ms: 3000 }),
      transportFailure: async () => ({ recoverable: ++inspections === 1,
        reason: inspections === 1 ? 'interrupted-provider-request' : 'completed-response' }),
    })
    const result = await executeNative({ run_dir: root, timeout_ms: 60_000, resume_native_session: true }, original, h.deps)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.budgetMs, 58_000)
    assert.ok(calls[0].args.includes(sessionId))
    assert.equal(result.recovery.invocations.length, 2)
    assert.equal(result.recovery.retained_verifications[0].previous_reason, 'no-transport-failure')
    // A null session receipt alone is never enough; real transport evidence is required.
    await writeFile(join(root, 'NativeSessionRecovery.json'), JSON.stringify(previous))
    h.deps.transportFailure = async () => ({ recoverable: false, reason: 'no-transport-failure' })
    await assert.rejects(executeNative({ run_dir: root, timeout_ms: 60_000, resume_native_session: true }, original, h.deps),
      /does not match verified recovery/u)
    assert.equal(calls.length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
