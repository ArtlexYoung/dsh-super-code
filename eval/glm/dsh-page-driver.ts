/** Run one SWE-bench Pro task through the Remote RPC API served by `dsh web`. */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { budgetSnapshot } from './native-resume.mjs'
import { verifyCandidate } from './candidate-identity.mjs'
import { outcomeFromEvents, readSessionEvents } from './candidate-outcome.mjs'

interface TaskInput {
  readonly repo: string
  readonly problem_statement: string
  readonly workspace: string
  readonly run_dir: string
  readonly container_name: string
  readonly timeout_ms: number
}

interface SessionSummary {
  readonly sessionId: string
  readonly running: boolean
  readonly blank: boolean
  readonly cwd?: string
  readonly projections?: {
    readonly values?: {
      readonly agentPreset?: string
      readonly permissions?: { readonly currentValue?: string }
    }
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

function redactHostLog(value: string): string {
  const secret = process.env.OA4_TENCENT_API_KEY
  return value
    .replaceAll(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1[redacted]')
    .replaceAll(secret ?? '', secret === undefined ? '' : '[redacted]')
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolveListen())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('failed to reserve a local Web Harness port')
  }
  const port = address.port
  await new Promise<void>((resolveClose, reject) => server.close(error => error === undefined ? resolveClose() : reject(error)))
  return port
}

async function probeReady(port: number): Promise<string | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
      signal: AbortSignal.timeout(1_000),
      redirect: 'manual',
    })
    // A freshly bound listener can briefly answer 404 while the Harness
    // Loader is still mounting the authenticated Web routes. Treat only the
    // stable Web responses as readiness signals. The caller still waits for
    // the printed authenticated URL because the token cannot be reconstructed
    // from the unauthenticated origin.
    if (response.status === 401 || response.status === 303 || response.status === 200) {
      return `http://127.0.0.1:${String(port)}`
    }
  } catch {
    // The listener may still be starting. The caller retries with a short
    // interval and reports the captured child output on timeout.
  }
  return undefined
}

function waitForReady(child: ChildProcess, output: { stdout: string; stderr: string }, port: number): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let settled = false
    let listenerReady = false
    let announcedUrl: string | undefined
    let probeTimer: NodeJS.Timeout | undefined
    const finish = (error: Error | undefined, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (probeTimer !== undefined) clearTimeout(probeTimer)
      if (error !== undefined) reject(error)
      else resolveReady(url as string)
    }
    const timer = setTimeout(() => {
      finish(new Error(`dsh web did not become ready\n${redactHostLog(output.stderr)}`))
    }, 120_000)
    const tryFinish = (): void => {
      if (listenerReady && announcedUrl !== undefined) finish(undefined, announcedUrl)
    }
    const inspect = (): void => {
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(`${output.stdout}\n${output.stderr}`)
      if (match?.[1] !== undefined) {
        announcedUrl = match[1].replace('0.0.0.0', '127.0.0.1')
        tryFinish()
      }
    }
    const probe = async (): Promise<void> => {
      if (settled) return
      const url = await probeReady(port)
      if (url !== undefined) {
        listenerReady = true
        inspect()
        tryFinish()
      }
      else probeTimer = setTimeout(() => { void probe() }, 250)
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('exit', code => {
      finish(new Error(`dsh web exited before readiness with code ${String(code)}\n${redactHostLog(output.stderr)}`))
    })
    void probe()
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const closed = new Promise<void>(resolveClose => child.once('close', () => resolveClose()))
  child.kill('SIGTERM')
  const clean = await Promise.race([
    closed.then(() => true),
    new Promise<false>(resolveTimeout => setTimeout(() => resolveTimeout(false), 10_000)),
  ])
  if (!clean && child.exitCode === null) {
    child.kill('SIGKILL')
    await closed
  }
}

async function authenticateWeb(url: string): Promise<{ origin: string; cookie: string }> {
  let lastStatus = 'unknown'
  // The URL announcement is emitted as soon as the Loader settles, while the
  // fallback route can take a short additional tick to replace its bootstrap
  // handler. Retry only these transient Web statuses; a real auth/config error
  // is reported immediately and remains outside model-quality scoring.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const authentication = await fetch(url, { redirect: 'manual' })
    lastStatus = String(authentication.status)
    const cookieHeader = authentication.headers.get('set-cookie')
    if (authentication.status === 303 && cookieHeader !== null) {
      return { origin: new URL(url).origin, cookie: cookieHeader.split(';', 1)[0] as string }
    }
    if (![401, 404, 429, 500, 502, 503].includes(authentication.status)) break
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`dsh web authentication returned HTTP ${lastStatus}`)
}

async function sessionLogs(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.name === 'session.v3.jsonl.zstd') found.push(path)
    }
  }
  await visit(root)
  return found
}

const inputPath = process.argv[2]
const outputPath = process.argv[3]
if (inputPath === undefined || outputPath === undefined) {
  throw new Error('usage: page-rpc-minimal-driver.ts <input.json> <output.json>')
}

const dshRoot = resolve(required('DSH_SOURCE_ROOT'))
const input = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as TaskInput
const workspace = resolve(input.workspace)
const runDir = resolve(input.run_dir)
const harnessHome = join(runDir, 'dsh-home-rpc')
const overlayPath = join(runDir, 'page-rpc.overlay.yml')
const guardPluginPath = fileURLToPath(new URL('./evaluation-tool-guard.mjs', import.meta.url))
const settingsPath = join(harnessHome, 'settings.yaml')
const bootInspectionPath = join(runDir, 'web-installation-inspection.json')
const model = process.env.DSH_MODEL ?? 'glm-5.3-flash'
const baseURL = required('DSH_BASE_URL')
const reasoningEffort = process.env.DSH_REASONING_EFFORT ?? 'max'
const preset = process.env.DSH_AGENT_PRESET ?? 'minimal'
const profileDir = process.env.DSH_EVAL_PROFILE_DIR
const candidateManifestPath = process.env.DSH_EVAL_CANDIDATE_MANIFEST
const bootOnly = process.env.DSH_EVAL_BOOT_ONLY === '1'
if (reasoningEffort !== 'max' || model !== 'glm-5.3-flash') throw new Error('Frozen GLM/max configuration required')
if (!['minimal', 'super-code', 'super-code-kernel'].includes(preset)) throw new Error(`unsupported DSH_AGENT_PRESET: ${preset}`)
if (preset.startsWith('super-code') && profileDir === undefined) {
  throw new Error('DSH_EVAL_PROFILE_DIR is required for the installed super-code candidate')
}
if (!bootOnly) required('OA4_TENCENT_API_KEY')
const verifiedCandidate = process.env.DSH_EVAL_VERIFY_INSTALLED === '1'
  ? await verifyCandidate(required('DSH_EVAL_PROFILE_DIR'), required('DSH_EVAL_CANDIDATE_MANIFEST'))
  : undefined

await mkdir(harnessHome, { recursive: true })
if (profileDir !== undefined) {
  // Harness 0.1.5+ discovers user presets from DSH_HOME/.agent-presets.
  // Seed the isolated home from the candidate package just as the plugin's
  // first-run installer does in a normal host session.
  const bundledPreset = join(profileDir, 'node_modules', 'dsh-super-code', 'presets', preset)
  const userPreset = join(harnessHome, '.agent-presets', preset)
  await mkdir(join(harnessHome, '.agent-presets'), { recursive: true })
  await cp(bundledPreset, userPreset, { recursive: true, force: true })
  const profilesDir = join(harnessHome, 'profiles')
  await mkdir(profilesDir, { recursive: true })
  // Retries reuse the task run directory. Remove only the previous link that
  // this driver owns so a failed boot can be replayed without EEXIST.
  const profileLink = join(profilesDir, 'web')
  const removeProfileLink = async () => {
    await rm(profileLink, { force: true, recursive: true, maxRetries: 3, retryDelay: 25 })
  }
  await removeProfileLink()
  try {
    await symlink(resolve(profileDir), profileLink, 'dir')
  } catch (error) {
    // A previous host can finish its cleanup just after the first rm. Make
    // retries idempotent without masking unrelated filesystem failures.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await removeProfileLink()
    await symlink(resolve(profileDir), profileLink, 'dir')
  }
}
await writeFile(settingsPath, [
  'llm-pi-ai:',
  '  providers:',
  '    tokenhub:',
  '      apiKeyEnv: OA4_TENCENT_API_KEY',
  '      api: openai-responses',
  `      baseURL: ${JSON.stringify(baseURL)}`,
  `      reasoning: ${reasoningEffort}`,
  `      timeoutMs: ${String(input.timeout_ms)}`,
  '      streamIdleTimeoutMs: 300000',
  '      models:',
  `        - id: ${JSON.stringify(model)}`,
  `          name: ${JSON.stringify(model)}`,
  '          contextWindow: 1000000',
  '          maxTokens: 128000',
  '          reasoningEfforts:',
  '            off: null',
  '            high: high',
  '            max: max',
  'agent-default-model:',
  '  provider: tokenhub',
  `  model: ${JSON.stringify(model)}`,
  `  reasoningEffort: ${reasoningEffort}`,
  '',
].join('\n'))
await writeFile(overlayPath, [
  '- id: llm-deepseek',
  '  disabled: true',
  '',
  '# Evaluation-only permission boundary: sessions may write only their task workspace.',
  '- id: sandbox-policy',
  '  config:',
  '    mode: workspace-write',
  `    workspaceRoot: ${JSON.stringify(workspace)}`,
  '- id: spill-local',
  '  config:',
  `    root: ${JSON.stringify(join(workspace, '.git/dsh-context-output'))}`,
  '    cleanupPeriodDays: 0',
  '- id: approval',
  '  config:',
  '    policy: never',
  '- id: permission',
  '  config:',
  '    presets:',
  '      read-only:',
  '        sandbox: read-only',
  '        approval: never',
  '      workspace-write:',
  '        sandbox: workspace-write',
  '        approval: never',
  '    defaultPreset: workspace-write',
  '- insert:',
  ...bootOnly ? ['    - id: fastctx-boot-inspector', `      name: ${JSON.stringify(join(fileURLToPath(new URL('.', import.meta.url)), 'boot-inspector.mjs'))}`] : [],
  '    - id: swebench-evaluation-tool-guard',
  `      name: ${JSON.stringify(guardPluginPath)}`,
  '',
].join('\n'))

const requireFromDsh = createRequire(join(dshRoot, 'package.json'))
const tsxLoader = pathToFileURL(requireFromDsh.resolve('tsx')).href
const hostOutput = { stdout: '', stderr: '' }
const webPort = await reservePort()
const host = spawn(process.execPath, [
  '--import', tsxLoader,
  '--import', fileURLToPath(new URL('./wire-observer.mjs', import.meta.url)),
  join(dshRoot, 'apps/cli/src/bin.ts'),
  'web', '--patch', overlayPath, '--no-open', '--port', String(webPort),
], {
  // Boot outside the task repository: its .env belongs to the target application.
  // The native session/create request below still selects the exact task workspace.
  cwd: harnessHome,
  env: {
    ...process.env,
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    http_proxy: 'http://127.0.0.1:1',
    https_proxy: 'http://127.0.0.1:1',
    all_proxy: 'http://127.0.0.1:1',
    NO_PROXY: `localhost,127.0.0.1,::1,[::1],${new URL(baseURL).hostname}`,
    no_proxy: `localhost,127.0.0.1,::1,[::1],${new URL(baseURL).hostname}`,
    DSH_HOME: harnessHome,
    DSH_EVAL_WIRE_RECORD: join(runDir, 'wire-reasoning.jsonl'),
    ...bootOnly ? { DSH_FASTCTX_BOOT_INSPECTOR: bootInspectionPath } : {},
    DSH_AGENTS_HOME: join(harnessHome, 'agents'),
    DSH_PERMISSION_MODE: 'workspace-write',
    DSH_EVAL_WORKSPACE: workspace,
    DSH_EVAL_CONTAINER_NAME: input.container_name,
    TSX_TSCONFIG_PATH: join(dshRoot, 'tsconfig.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
host.stdout?.setEncoding('utf8')
host.stderr?.setEncoding('utf8')
host.stdout?.on('data', (chunk: string) => { hostOutput.stdout += chunk })
host.stderr?.on('data', (chunk: string) => { hostOutput.stderr += chunk })

const started = performance.now()
let sessionId: string | undefined
let timeBudgetExhausted = false
let budgetCancellationAtMs = 0
try {
  const authenticatedUrl = await waitForReady(host, hostOutput, webPort)
  const { origin, cookie } = await authenticateWeb(authenticatedUrl)
  const rpc = async <T>(endpoint: string, args: object): Promise<T> => {
    const response = await fetch(`${origin}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request', rpcId: `swepro-${randomUUID()}`,
        method: endpoint, payload: { args },
      }),
    })
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${String(response.status)}: ${await response.text()}`)
    const body = await response.json() as {
      result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
    }
    if (!body.result.ok) throw new Error(`${endpoint} failed: ${body.result.error.code}: ${body.result.error.message}`)
    return body.result.value
  }

  const presetWaitMs = Number(process.env.DSH_EVAL_PRESET_WAIT_MS ?? '0')
  if (Number.isFinite(presetWaitMs) && presetWaitMs > 0) {
    await new Promise(resolveWait => setTimeout(resolveWait, presetWaitMs))
  }

  const created = await rpc<{ sessionId: string; agentPreset?: string }>('session/create', {
    request: { cwd: workspace, agentPreset: preset },
  })
  sessionId = created.sessionId
  if (created.agentPreset !== preset) throw new Error(`session/create selected ${String(created.agentPreset)}`)
  const initialList = await rpc<{ items: SessionSummary[] }>('session/list', { _request: {} })
  const initialRow = initialList.items.find(item => item.sessionId === sessionId)
  const permissionPreset = initialRow?.projections?.values?.permissions?.currentValue
  if (permissionPreset !== 'workspace-write') {
    throw new Error(`session/create selected permission ${String(permissionPreset)}`)
  }
  const selected = await rpc<{ selected: { provider: string; model: string; reasoningEffort?: string } }>(
    'session/selectModel',
    { request: { sessionId, provider: 'tokenhub', model, reasoningEffort } },
  )
  if (selected.selected.provider !== 'tokenhub' || selected.selected.model !== model
    || selected.selected.reasoningEffort !== reasoningEffort) {
    throw new Error(`session/selectModel mismatch: ${JSON.stringify(selected)}`)
  }

  if (bootOnly) {
    let inspected = false
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        const inspection = JSON.parse(await readFile(bootInspectionPath, 'utf8'))
        if (!inspection.passed) throw new Error('Web installation inspection failed: ' + inspection.message)
        inspected = true; break
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
    }
    if (!inspected) throw new Error('Web installation inspection missing')
  }
  if (!bootOnly) {
    const prompt = [
      'Solve the following SWE-bench issue in the current repository.',
      '',
      `Repository: ${input.repo}`,
      '',
      input.problem_statement,
      '',
      'Inspect the repository, edit the implementation, and run relevant tests. Do not edit tests or install packages.',
      'This is an offline evaluation. You may inspect anywhere in the assigned container and may try network commands such as curl, wget, or git fetch, but the container has no network, repository remotes, target commit, evaluator files, or other task results. Do not attempt to access host files or answer-bearing evaluation evidence.',
      `The official task environment is available for test commands as: docker exec ${input.container_name} bash -lc 'cd /app && <command>'.`,
      'Every shell command must use that exact docker exec form; direct host shell commands are denied.',
      'Do not use shell heredocs, multiline standard input, or commands that wait for interactive input; use single-line commands or the file editing tools instead.',
      'Before finishing, remove test-generated files and ensure the Git diff contains only intentional solution changes.',
      'Continue until the implementation is complete or the time limit is exhausted.',
    ].join('\n')
    await rpc<{ accepted: true }>('session/prompt', {
      request: {
        requestId: `swepro-${randomUUID()}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
        clientTimeZone: 'Asia/Singapore',
      },
    })
    const budgetStarted = Date.now()
    let observedRunning = false
    while (true) {
      const clock = Date.now()
      const { excluded_retry_ms: excluded } = await budgetSnapshot(input.run_dir, budgetStarted, clock)
      if (clock - budgetStarted - excluded >= input.timeout_ms) break
      const listed = await rpc<{ items: SessionSummary[] }>('session/list', { _request: {} })
      const row = listed.items.find(item => item.sessionId === sessionId)
      if (row?.running === true) observedRunning = true
      if (observedRunning && row?.running === false) break
      if (!observedRunning && row?.running === false) {
        // An immediate provider error can start and end between polls. The
        // persisted turn boundary, not a sampled spinner, proves completion.
        const currentLogs = await sessionLogs(join(harnessHome, 'sessions'))
        const currentLog = currentLogs.find(path => path.includes(sessionId as string))
        if (currentLog !== undefined) {
          const events = await readSessionEvents(currentLog)
          if (events.some(event => event.type === 'turn/end')) {
            observedRunning = true
            break
          }
        }
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
    }
    const finalList = await rpc<{ items: SessionSummary[] }>('session/list', { _request: {} })
    const finalRow = finalList.items.find(item => item.sessionId === sessionId)
    if (!observedRunning) throw new Error('session/prompt never entered running state')
    if (finalRow?.running === true) {
      timeBudgetExhausted = true
      budgetCancellationAtMs = Date.now()
      await rpc('session/cancel', { request: { sessionId } })
    }
  }

  await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
  await stopChild(host)
  const logs = await sessionLogs(join(harnessHome, 'sessions'))
  const sessionLog = logs.find(path => path.includes(sessionId as string))
  if (sessionLog === undefined) throw new Error(`persisted Session log missing for ${sessionId}`)
  const outcome = bootOnly ? { status: 'boot-only' }
    : outcomeFromEvents(await readSessionEvents(sessionLog), { timeBudgetExhausted, kind: process.env.DSH_GRAPH_KIND ?? 'baseline030' })
  const outcomeReceipt = JSON.parse(redactHostLog(JSON.stringify({ ...outcome,
    session_id: sessionId, session_log: sessionLog })))
  await writeFile(join(runDir, 'session-outcome.json'), JSON.stringify(outcomeReceipt, null, 2) + '\n')
  if ('pauseCandidate' in outcome && outcome.pauseCandidate && process.env.DSH_DEV_ROOT) {
    await writeFile(join(process.env.DSH_DEV_ROOT, 'PAUSED.json'), JSON.stringify({ ...outcomeReceipt, runDir, at: new Date().toISOString() }, null, 2) + '\n')
  }
  if (outcome.status === 'failed') {
    throw new Error(`evaluation session failed: ${outcome.category}; see session-outcome.json`)
  }
  const candidate = candidateManifestPath === undefined
    ? null
    : JSON.parse(await readFile(resolve(candidateManifestPath), 'utf8')) as unknown
  const wireRequests = bootOnly ? [] : (await readFile(join(runDir, 'wire-reasoning.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.event === 'request')
  if (!bootOnly && (!wireRequests.length || wireRequests.some(row => row.reasoning_effort !== reasoningEffort || row.model !== model))) throw new Error('Wire identity mismatch')
  const evidence = {
    wire_reasoning: { verified: !bootOnly, request_count: wireRequests.length, efforts: [...new Set(wireRequests.map(row => row.reasoning_effort))] },
    schema: 2,
    runtime: 'deepseek-harness-web-rpc',
    mode: bootOnly ? 'boot-only' : 'agent-run',
    session_id: sessionId,
    session_log: sessionLog,
    web_rpc: {
      origin,
      authenticated: true,
      calls: ['session/create', 'session/list', 'session/selectModel', ...bootOnly ? [] : ['session/prompt', 'session/list'], ...timeBudgetExhausted ? ['session/cancel'] : []],
      prompt_submitted: !bootOnly,
    },
    preset,
    isolation: {
      policy: 'swebench-pro-isolation-v3',
      permission_preset: permissionPreset,
      tool_guard: 'workspace-files-and-assigned-offline-container',
    },
    candidate,
    ...(verifiedCandidate === undefined ? {} : { installed_candidate: verifiedCandidate.installation }),
    model: { provider: 'tokenhub', id: model, reasoning_effort: reasoningEffort, max_tokens: 128_000 },
    elapsed_ms: Math.round(performance.now() - started),
    time_budget_exhausted: timeBudgetExhausted,
    budget_policy: 'effective-work-minus-confirmed-outages/v2',
    budget_cancellation_at_ms: budgetCancellationAtMs,
    session_outcome: outcomeReceipt,
    web_bundle_sha256: createHash('sha256').update(await readFile(join(dshRoot, 'apps/web/dist/index.html'))).digest('hex'),
  }
  await writeFile(resolve(outputPath), JSON.stringify(evidence, null, 2) + '\n')
} finally {
  await stopChild(host).catch(() => {})
  await writeFile(join(runDir, 'web-host.stdout.log'), redactHostLog(hostOutput.stdout)).catch(() => {})
  await writeFile(join(runDir, 'web-host.stderr.log'), redactHostLog(hostOutput.stderr)).catch(() => {})
}
