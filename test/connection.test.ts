import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, stat, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionService } from '../src/connection/service.js'
import { ConnectionError, defaultConnectionConfig } from '../src/connection/types.js'
import type { ConnectionConfig, DelegationHost, HostObservation } from '../src/connection/types.js'
import { DelegatedTasks, withinDirectory } from '../src/connection/tasks.js'
import { ConnectionHost, connectionSessionFacts } from '../src/dsh/connection-host.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { SuperCodeConnection } from '../src/dsh/connection.js'

class FakeHost implements DelegationHost {
  created: string[] = []; prompts: string[] = []; cancelled: string[] = []
  observation: HostObservation = { status: 'running', output: '', detail: 'running' }
  rejectPrompt = false
  async preset(): Promise<string> { return 'owned-preset' }
  async create(id: string): Promise<void> { this.created.push(id) }
  async prompt(_id: string, _request: string, prompt: string): Promise<void> {
    this.prompts.push(prompt); if (this.rejectPrompt) throw new Error('admission unknown')
  }
  async observe(): Promise<HostObservation> { return this.observation }
  async cancel(id: string): Promise<void> { this.cancelled.push(id); this.observation = { status: 'interrupted', output: '', detail: 'aborted' } }
}
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-mcp-'))
  const cwd = join(directory, 'workspace'); await mkdir(cwd)
  const store = new ConnectionStore(join(directory, 'store')); await store.initialize()
  const host = new FakeHost(), config: ConnectionConfig = { ...defaultConnectionConfig, enabled: true, allowedDirectories: [cwd] }
  const tasks = new DelegatedTasks(store, host, () => config); await tasks.initialize()
  t.after(async () => { await tasks.close(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  return { directory, cwd, store, host, config, tasks }
}
const request = (cwd: string) => ({ cwd, requestId: 'retry-1', prompt: 'Implement the task', client: 'test' })

test('run and send persist intent, coalesce retries, reject conflicts and restrict task ownership', async t => {
  const f = await setup(t)
  const [first, retry] = await Promise.all([f.tasks.run(request(f.cwd)), f.tasks.run(request(f.cwd))])
  assert.equal(first.taskId, retry.taskId); assert.equal(first.preset, 'owned-preset'); assert.equal(first.acceptance, 'not-verified')
  assert.equal(f.host.prompts.length, 1)
  await assert.rejects(f.tasks.run({ ...request(f.cwd), prompt: 'Different' }), /request-conflict/)
  await assert.rejects(f.tasks.cancel('arbitrary-session'), /task-not-found/)
  await f.tasks.send({ taskId: first.taskId, requestId: 'send-1', prompt: 'Also test' })
  await f.tasks.send({ taskId: first.taskId, requestId: 'send-1', prompt: 'Also test' })
  assert.equal(f.host.prompts.length, 2)
  await assert.rejects(f.tasks.send({ taskId: first.taskId, requestId: 'send-1', prompt: 'changed' }), /request-conflict/)
  const history = JSON.parse(await readFile(join(f.directory, 'store/tasks.json'), 'utf8'))
  assert.equal(history[0].id, first.taskId)
  assert.equal((await stat(join(f.directory, 'store/tasks.json'))).mode & 0o777, 0o600)
})

test('directory boundaries resolve symlinks and reject siblings, relative paths and concurrent workspace writes', async t => {
  const f = await setup(t), outside = join(f.directory, 'outside'); await mkdir(outside)
  await symlink(outside, join(f.cwd, 'escape'))
  assert.equal(withinDirectory(f.cwd, f.cwd + '-sibling'), false)
  await assert.rejects(f.tasks.run(request('relative')), /absolute-directory-required/)
  await assert.rejects(f.tasks.run(request(join(f.cwd, 'escape'))), /directory-not-allowed/)
  await f.tasks.run(request(f.cwd)); f.config.maxConnections = 2
  await assert.rejects(f.tasks.run({ ...request(f.cwd), requestId: 'second' }), /workspace-busy/)
  f.config.enabled = false
  await assert.rejects(f.tasks.run({ ...request(f.cwd), requestId: 'disabled' }), /connection-disabled/)
})

test('task concurrency follows maximum connections and stored legacy limits are migrated', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-concurrency-')), profile = join(root, 'profile')
  const initialStore = new ConnectionStore(profile); await initialStore.initialize()
  const initialSettings = await initialStore.settings(); await initialStore.close()
  const legacySettings = { ...initialSettings, revision: 1, config: { ...initialSettings.config, maxConnections: 7, maxConcurrent: 1 } }
  await writeFile(join(profile, 'settings.json'), JSON.stringify(legacySettings))

  const service = new ConnectionService(new ConnectionStore(profile), new FakeHost()); await service.initialize()
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  assert.equal(service.read().configuration.maxConnections, 7)
  assert.equal(service.read().configuration.maxConcurrent, 7)
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).config.maxConcurrent, 7)

  const config = { ...service.read().configuration, maxConnections: 9, maxConcurrent: 1 }
  const saved = await service.save(JSON.stringify(config), String(service.read().revision))
  assert.equal(saved.ok, true)
  assert.equal(service.read().configuration.maxConcurrent, 9)
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).config.maxConcurrent, 9)

  const workspace = join(root, 'workspace'), other = join(root, 'other')
  await Promise.all([mkdir(workspace), mkdir(other)])
  const store = new ConnectionStore(join(root, 'task-store')); await store.initialize()
  const host = new FakeHost(), taskConfig = { ...defaultConnectionConfig, enabled: true, maxConnections: 2, maxConcurrent: 1, allowedDirectories: [root] }
  const tasks = new DelegatedTasks(store, host, () => taskConfig); await tasks.initialize()
  try {
    await tasks.run({ ...request(workspace), requestId: 'first' })
    const second = await tasks.run({ ...request(other), requestId: 'second' })
    assert.equal(second.status, 'running')
    assert.equal(host.prompts.length, 2)
  } finally { await tasks.close(); await store.close() }
})

test('wait timeout and caller abort do not cancel, approval is distinct, cancel reaches terminal state', async t => {
  const f = await setup(t), first = await f.tasks.run(request(f.cwd))
  assert.equal((await f.tasks.wait(first.taskId, first.cursor, 10)).status, 'running')
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.tasks.wait(first.taskId, first.cursor, 100, abort.signal))
  assert.equal(f.host.cancelled.length, 0)
  f.host.observation = { status: 'waiting_confirmation', output: '', detail: 'approve in host' }
  assert.equal((await f.tasks.wait(first.taskId, first.cursor, 30000)).status, 'waiting_confirmation')
  await assert.rejects(f.tasks.send({ taskId: first.taskId, requestId: 'follow', prompt: 'continue' }), /resolve-in-dsh-first/)
  assert.equal((await f.tasks.cancel(first.taskId)).status, 'cancelled')
})

test('ambiguous admission and restart never replay prompts, explicit continuation uses a new operation', async t => {
  const f = await setup(t); f.config.maxConnections = 1; f.host.rejectPrompt = true
  f.host.observation = { status: 'unavailable', output: '', detail: 'unknown' }
  const first = await f.tasks.run(request(f.cwd))
  const recovered = new DelegatedTasks(f.store, f.host, () => f.config); await recovered.initialize()
  await recovered.run(request(f.cwd)); assert.equal(f.host.prompts.length, 1)
  await assert.rejects(recovered.run({ ...request(f.cwd), requestId: 'new' }), /concurrency-limit/)
  f.host.rejectPrompt = false; f.host.observation = { status: 'running', output: '', detail: 'running' }
  await recovered.send({ taskId: first.taskId, requestId: 'continue', prompt: 'Explicit continue' })
  assert.equal(f.host.prompts.length, 2)
  await recovered.close()
})

test('profile lock rejects a second owner and closed stores cannot write', async t => {
  const f = await setup(t), other = new ConnectionStore(f.store.directory)
  await assert.rejects(other.initialize(), /profile-busy/)
  assert.equal((await stat(f.store.directory)).mode & 0o777, 0o700)
})
function events(rows: [string, object][]): SessionEvent[] {
  return rows.map(([type, data], seq) => ({ type, seq, data, timestamp: Date.now() })) as SessionEvent[]
}
test('journal facts require an admitted request and settled turn, normalize output and confirmations', () => {
  const log = events([['turn/start', {}], ['user/message', { source: { rpcId: 'request' } }],
    ['assistant/message', { message: { content: [{ type: 'text', text: 'Result' }] } }], ['turn/end', { reason: { kind: 'completed' } }]])
  assert.equal(connectionSessionFacts(log, 'idle', 'other').status, 'running')
  assert.equal(connectionSessionFacts(log, 'running', 'request').status, 'running')
  assert.deepEqual(connectionSessionFacts(log, 'idle', 'request'), { status: 'finished', output: 'Result' })
  assert.equal(connectionSessionFacts(events([['approval/asked', { id: 'a' }]]), 'running', '').status, 'waiting_confirmation')
  assert.equal(connectionSessionFacts(events([['turn/end', { reason: { kind: 'max-tokens' } }]]), 'idle', '').status, 'failed')
})
test('host adapter waits for descendants and cancels only the owned tree with queued work cleared', async () => {
  const cuts = new Map([['root', events([['user/message', { source: { rpcId: 'r' } }], ['turn/end', { reason: { kind: 'completed' } }]])],
    ['child', events([['turn/start', {}]])]])
  const cancellations: unknown[] = [], interrupted: string[] = []
  const agent = { status: 'idle', cancel: (...args: unknown[]) => { cancellations.push(args) } }
  const host = new ConnectionHost({
    presets: { status: async () => ({ state: 'available', id: 'custom-super-code' }) as any },
    controller: { create: async row => ({ sessionId: row.sessionId }), prompt: async () => ({ accepted: true }) },
    agents: { get: id => id === 'root' ? agent : { ...agent, status: 'running' } },
    query: { observeSession: async id => ({ events: cuts.get(id)!, inheritedEventCount: 0, [Symbol.dispose]: () => {} }) },
    subagents: { listDescendants: async () => [{ id: 'child', parentId: 'root', kind: 'child', mode: 'continuable' }], interrupt: async id => { interrupted.push(id) } },
  })
  assert.equal(await host.preset(), 'custom-super-code')
  assert.equal((await host.observe('root', 'r')).status, 'running')
  await host.cancel('root')
  assert.equal(cancellations.length, 2, 'Root and child both clear queued work')
  for (const args of cancellations) assert.deepEqual(args, [{ kind: 'user' }, { keepInbox: false }])
  assert.deepEqual(interrupted, ['child'])
})
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port')
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port
}
test('real MCP HTTP client covers disabled default, authentication, tools, token rotation and configuration conflicts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-http-')), host = new FakeHost()
  const service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host); await service.initialize()
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  assert.equal(service.read().state, 'disabled'); assert.equal('token' in service.read(), false)
  const port = await freePort(), configuration = { ...defaultConnectionConfig, enabled: true, port, allowedDirectories: [root] }
  assert.equal((await service.save(JSON.stringify(configuration), '0')).ok, true)
  assert.equal(service.read().state, 'listening')
  assert.deepEqual(await service.save(JSON.stringify(configuration), '0'), { ok: false, error: 'conflict' })
  const url = service.read().url, token = service.reveal().token
  assert.equal((await fetch(url, { method: 'POST' })).status, 401)
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://evil.test' } })).status, 403)
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status, 405)
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: 'a'.repeat(131073) })).status, 413)
  const client = new Client({ name: 'integration-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  t.after(() => client.close())
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['dsh_cancel', 'dsh_request_directory', 'dsh_run', 'dsh_send', 'dsh_wait'])
  const run = await client.callTool({ name: 'dsh_run', arguments: { ...request(root) } })
  assert.equal(run.isError, undefined)
  const task = JSON.parse((run.content as any)[0].text)
  assert.equal(task.status, 'running')
  const retry = await client.callTool({ name: 'dsh_run', arguments: request(root) })
  assert.equal(JSON.parse((retry.content as any)[0].text).taskId, task.taskId)
  const unknown = await client.callTool({ name: 'dsh_wait', arguments: { taskId: 'unknown', waitMs: 0 } })
  assert.equal(unknown.isError, true)
  assert.equal((await service.rotate('1')).ok, true)
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 401)
  const current = service.read(); await service.save(JSON.stringify({ ...configuration, enabled: false }), String(current.revision))
  assert.equal(service.read().state, 'disabled'); assert.equal(host.cancelled.length, 0)
})

test('cancelling a queued message is settled by true idle without fabricating admission', () => {
  assert.equal(connectionSessionFacts([], 'idle', 'queued').status, 'running')
  assert.equal(connectionSessionFacts([], 'idle', 'queued', true).status, 'interrupted')
  assert.equal(connectionSessionFacts([], 'running', 'queued', true).status, 'running')
  assert.equal(connectionSessionFacts([], 'missing', 'queued', true).status, 'unavailable')
})

test('Git observations preserve baseline dirt and detect staged and untracked content changes', async t => {
  const { execFile } = await import('node:child_process'), { promisify } = await import('node:util')
  const { writeFile } = await import('node:fs/promises')
  const { gitSnapshot, workspaceChanges } = await import('../src/connection/git.js')
  const exec = promisify(execFile), f = await setup(t)
  await exec('git', ['init', f.cwd])
  await writeFile(join(f.cwd, 'existing.txt'), 'user content')
  const baseline = await gitSnapshot(f.cwd)
  assert.equal(baseline.available, true)
  assert.equal((await workspaceChanges(f.cwd, baseline)).changedSinceStart, false)
  await writeFile(join(f.cwd, 'existing.txt'), 'changed content')
  assert.equal((await workspaceChanges(f.cwd, baseline)).changedSinceStart, true)
  await exec('git', ['-C', f.cwd, 'add', 'existing.txt'])
  const staged = await gitSnapshot(f.cwd)
  assert.equal(staged.available, true)
  await writeFile(join(f.cwd, 'existing.txt'), 'additional work')
  const result = await workspaceChanges(f.cwd, staged)
  assert.equal(result.changedSinceStart, true); assert.equal(result.attribution, 'workspace-observation')
  assert.ok(result.baselineDirty.length > 0)
})

test('service restart retains settings and credentials without redispatch and task list recovers IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-restart-')), host = new FakeHost()
  const store = new ConnectionStore(join(root, 'profile'))
  const first = new ConnectionService(store, host); await first.initialize()
  const config = { ...defaultConnectionConfig, enabled: true, port: await freePort(), allowedDirectories: [root] }
  await first.save(JSON.stringify(config), '0')
  const token = first.reveal().token
  const client = new Client({ name: 'restart-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(first.read().url), { requestInit: { headers: { authorization: 'Bearer ' + token } } }))
  await client.callTool({ name: 'dsh_run', arguments: request(root) }); await client.close(); await first.close()
  const second = new ConnectionService(new ConnectionStore(store.directory), host); await second.initialize()
  t.after(async () => { await second.close(); await rm(root, { recursive: true, force: true }) })
  assert.equal(second.reveal().token, token); assert.equal(second.read().state, 'listening'); assert.equal(host.prompts.length, 1)
  const restored = new Client({ name: 'restored', version: '1' })
  await restored.connect(new StreamableHTTPClientTransport(new URL(second.read().url), { requestInit: { headers: { authorization: 'Bearer ' + token } } }))
  const listing = await restored.callTool({ name: 'dsh_wait', arguments: {} })
  assert.equal(listing.isError, undefined)
  const rows = JSON.parse((listing.content as any)[0].text)
  assert.equal(rows.tasks.length, 1); assert.match(rows.tasks[0].taskId, /^sc-/)
  await restored.close()
})

test('MCP directory access requires explicit DSH consent, remains live after approval and detects stale settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-consent-')), host = new FakeHost()
  const initial = join(root, 'initial'), added = join(root, 'added'), rejected = join(root, 'rejected')
  await Promise.all([mkdir(initial), mkdir(added), mkdir(rejected)])
  const service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host); await service.initialize()
  let firstClosed = false
  t.after(async () => { if (!firstClosed) await service.close(); await rm(root, { recursive: true, force: true }) })
  await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: await freePort(), maxConnections: 1, allowedDirectories: [initial] }), '0')
  const before = service.read(), client = new Client({ name: 'Consent test', version: '1' })
  const invalid = await fetch(before.url, { method: 'POST', headers: { authorization: 'Bearer ' + service.reveal().token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })
  assert.ok(invalid.status >= 400); assert.equal(service.overview().connections.length, 0, 'Malformed initialization must not reserve the only client slot')
  const transport = new StreamableHTTPClientTransport(new URL(before.url), { requestInit: { headers: { authorization: 'Bearer ' + service.reveal().token } } })
  await client.connect(transport); t.after(() => client.close())
  const tool = async (name: string, args: object) => client.callTool({ name, arguments: args as Record<string, unknown> })
  const apply = { requestId: 'access-new', path: added, reason: 'Use a second workspace' }
  const first = JSON.parse(((await tool('dsh_request_directory', apply)).content[0] as { text: string }).text)
  assert.equal(first.status, 'pending'); assert.equal(service.pendingDirectories().length, 1)
  assert.equal(service.pendingDirectories()[0]!.client, 'Consent test')
  assert.equal((await tool('dsh_run', request(added))).isError, true); assert.equal(host.prompts.length, 0)
  assert.deepEqual(await service.resolveDirectory(first.id, 'approved'), { status: 'approved' })
  assert.equal(service.pendingDirectories().length, 0)
  assert.equal(service.read().configuration.allowedDirectories.includes(await import('node:fs/promises').then(fs => fs.realpath(added))), true)
  assert.deepEqual(await service.save(JSON.stringify(before.configuration), String(before.revision)), { ok: false, error: 'conflict' })
  assert.equal(JSON.parse(((await tool('dsh_request_directory', apply)).content[0] as { text: string }).text).status, 'approved')
  assert.equal((await tool('dsh_run', request(added))).isError, undefined); assert.equal(host.prompts.length, 1)
  const denial = JSON.parse(((await tool('dsh_request_directory', { ...apply, requestId: 'denied', path: rejected })).content[0] as { text: string }).text)
  await service.resolveDirectory(denial.id, 'rejected')
  assert.equal((await tool('dsh_request_directory', { ...apply, path: rejected })).isError, true, 'Same request ID cannot change directory')
  assert.equal((await tool('dsh_run', { ...request(rejected), requestId: 'run-denied' })).isError, true)
  assert.equal(service.overview().connections.length, 1)
  assert.equal(service.overview().sessions[0]!.connectionId, service.overview().connections[0]!.id)
  const second = new Client({ name: 'excess', version: '1' })
  await assert.rejects(second.connect(new StreamableHTTPClientTransport(new URL(before.url), { requestInit: { headers: { authorization: 'Bearer ' + service.reveal().token } } })), /Maximum MCP connections/)
  await second.close()
  await transport.terminateSession(); await client.close()
  assert.equal(service.overview().connections.length, 0); assert.equal(host.cancelled.length, 0)
  const third = new Client({ name: 'after-disconnect', version: '1' })
  await third.connect(new StreamableHTTPClientTransport(new URL(before.url), { requestInit: { headers: { authorization: 'Bearer ' + service.reveal().token } } }))
  const pendingRestart = join(root, 'pending-restart'); await mkdir(pendingRestart)
  await third.callTool({ name: 'dsh_request_directory', arguments: { requestId: 'pending-restart', path: pendingRestart, reason: 'Do not auto approve on restart' } })
  assert.equal(service.pendingDirectories().length, 1)
  await third.close(); await service.close(); firstClosed = true
  const restored = new ConnectionService(new ConnectionStore(join(root, 'profile')), host); await restored.initialize()
  try {
    assert.equal(restored.pendingDirectories().length, 0)
    assert.equal(restored.read().configuration.allowedDirectories.includes(await import('node:fs/promises').then(fs => fs.realpath(added))), true)
    assert.equal(restored.read().configuration.allowedDirectories.includes(pendingRestart), false)
    assert.equal(host.prompts.length, 1)
  } finally { await restored.close() }
})

test('directory requests canonicalize paths, bound pending consent, expire and reject changed targets', async t => {
  const { DirectoryRequests } = await import('../src/connection/directories.js')
  const f = await setup(t); let now = 0
  const queue = new DirectoryRequests(() => [], () => now), grants: string[] = []
  const alias = join(f.directory, 'alias'); await symlink(f.cwd, alias)
  const pending = await queue.request({ requestId: 'alias', path: alias, reason: 'reason' }, 'client')
  assert.equal(pending.path, await import('node:fs/promises').then(fs => fs.realpath(f.cwd)))
  assert.equal((await queue.request({ requestId: 'alias', path: alias, reason: 'reason' }, 'client')).id, pending.id)
  await assert.rejects(queue.request({ requestId: 'relative', path: 'relative', reason: 'x' }, 'client'), /absolute-directory/)
  for (let index = 0; index < 7; index++) await queue.request({ requestId: 'req-' + index, path: f.cwd, reason: 'x' }, 'client')
  await assert.rejects(queue.request({ requestId: 'overflow', path: f.cwd, reason: 'x' }, 'client'), /directory-request-limit/)
  now = 300000; assert.equal(queue.pending().length, 0)
  assert.deepEqual(await queue.resolve(pending.id, 'approved', async path => { grants.push(path) }), { status: 'expired' })
  assert.equal(grants.length, 0)
  const changed = await queue.request({ requestId: 'changed', path: f.cwd, reason: 'x' }, 'client')
  await rm(f.cwd, { recursive: true }); await symlink(f.directory, f.cwd)
  await assert.rejects(queue.resolve(changed.id, 'approved', async path => { grants.push(path) }), /directory-changed/)
  assert.equal(grants.length, 0)
  const restarted = new DirectoryRequests(() => [])
  assert.equal(restarted.pending().length, 0)
  await assert.rejects(restarted.resolve(changed.id, 'approved', async () => {}), /not-found/)
})

test('reconnecting and explicitly following up rebinds conversations without duplicate dispatch', async t => {
  const f = await setup(t)
  const first = await f.tasks.run({ ...request(f.cwd), connectionId: 'first' })
  await f.tasks.run({ ...request(f.cwd), connectionId: 'reconnected' })
  assert.equal(f.tasks.overview()[0]!.connectionId, 'reconnected')
  assert.equal(f.host.prompts.length, 1)
  await assert.rejects(f.tasks.run({ ...request(f.cwd), prompt: 'changed', connectionId: 'invalid' }), /request-conflict/)
  assert.equal(f.tasks.overview()[0]!.connectionId, 'reconnected')
  await f.tasks.send({ taskId: first.taskId, requestId: 'follow', prompt: 'continue', connectionId: 'follow-up' })
  assert.equal(f.tasks.overview()[0]!.connectionId, 'follow-up')
  await f.tasks.send({ taskId: first.taskId, requestId: 'follow', prompt: 'continue', connectionId: 'retried' })
  assert.equal(f.tasks.overview()[0]!.connectionId, 'retried')
  assert.equal(f.host.prompts.length, 2)
})

test('directory catalog reads workspace entity getters and preserves distinct paths and unavailable entries', async t => {
  const f = await setup(t), ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const second = join(f.cwd, 'second'); await mkdir(second)
  const file = join(f.cwd, 'file'); await writeFile(file, 'not a directory')
  class Workspace {
    constructor(private readonly location: string, private readonly label: string) {}
    get path(): string { return this.location }
    get title(): string { return this.label }
  }
  const entity = new Workspace(f.cwd, '主项目')
  assert.equal(Object.hasOwn(entity, 'path'), false)
  const remote = new SuperCodeConnection(ctx, () => false, { workspaces: { list: () => [entity,
    new Workspace(second, '第二个项目'), { path: second, title: '重复项目' },
    new Workspace(join(f.cwd, 'missing'), '已移除项目'), new Workspace(file, '普通文件')] }, picker: false })
  const result = await remote.directories()
  assert.equal(result.items.length, 4)
  assert.equal(result.items[0]!.title, '主项目')
  assert.equal(result.items[1]!.title, '第二个项目')
  assert.equal(result.items[0]!.path, await realpath(f.cwd))
  assert.deepEqual(result.items.map(row => row.available), [true, true, false, false])
  assert.ok(result.items.every(row => typeof row.path === 'string' && row.path.length > 0 && row.workspace))
})
