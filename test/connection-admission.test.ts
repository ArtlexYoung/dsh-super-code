import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DelegatedTasks } from '../src/connection/tasks.js'
import { ConnectionService } from '../src/connection/service.js'
import { ConnectionStore } from '../src/connection/store.js'
import { defaultConnectionConfig } from '../src/connection/types.js'
import type { DelegationHost, HostObservation, ModelSelection } from '../src/connection/types.js'
import type { ConnectionHttp } from '../src/connection/http.js'

type Stage = 'preset' | 'persist' | 'create' | 'select' | 'prompt' | 'observe'
class Host implements DelegationHost {
  calls: string[] = []
  observedRequests: string[] = []
  observation: HostObservation = { status: 'running', output: '', detail: 'Running' }
  gates = new Map<Stage, { entered: () => void; wait: Promise<void> }>()
  releases: (() => void)[] = []
  pause(stage: Stage) {
    const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
    this.gates.set(stage, { entered: () => entered.resolve(), wait: released.promise })
    this.releases.push(() => released.resolve())
    return { entered: entered.promise, release: () => released.resolve() }
  }
  async hold(stage: Stage): Promise<void> {
    const gate = this.gates.get(stage)
    if (gate) { this.gates.delete(stage); gate.entered(); await gate.wait }
  }
  async preset(): Promise<string> { await this.hold('preset'); return 'super-code' }
  async create(): Promise<void> { this.calls.push('create'); await this.hold('create') }
  async selectModel(_id: string, selection: ModelSelection): Promise<ModelSelection> {
    this.calls.push('select'); await this.hold('select'); return selection
  }
  async prompt(): Promise<void> { this.calls.push('prompt'); await this.hold('prompt') }
  async observe(_id: string, request: string): Promise<HostObservation> {
    this.observedRequests.push(request); await this.hold('observe'); return this.observation
  }
  async cancel(): Promise<void> { this.calls.push('cancel') }
}
async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
async function fixture(t: test.TestContext, http = false) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-admission-')), cwd = join(root, 'workspace')
  await mkdir(cwd)
  const store = new ConnectionStore(join(root, 'profile')), host = new Host()
  const config = { ...defaultConnectionConfig, enabled: true, allowedDirectories: [cwd] }
  const service = http ? new ConnectionService(store, host) : false
  let tasks: DelegatedTasks
  if (service) {
    await service.initialize()
    assert.ok((await service.save(JSON.stringify({ ...config, port: await port() }), '0')).ok)
    tasks = (service as unknown as { tasks: DelegatedTasks }).tasks
  } else {
    await store.initialize(); tasks = new DelegatedTasks(store, host, () => config); await tasks.initialize()
  }
  const save = store.saveTasks.bind(store)
  store.saveTasks = async rows => { if (rows.length) await host.hold('persist'); await save(rows) }
  t.after(async () => {
    host.releases.forEach(release => release())
    try { if (service) await service.close(); else { await tasks.close(); await store.close() } }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  return { root, cwd, store, host, config, tasks, service }
}
const selection = { provider: 'fixture', model: 'fixture', reasoningEffort: 'high' }
const request = (cwd: string) => ({ cwd, requestId: 'initial', prompt: 'Initial prompt', modelSelection: selection })

for (const change of ['disable', 'revoke-directory', 'disable-creation', 'close'] as const) {
  test(`new admission rechecks ${change} after asynchronous preset lookup`, { timeout: 10000 }, async t => {
    const f = await fixture(t), gate = f.host.pause('preset')
    const running = f.tasks.run(request(f.cwd))
    const rejected = assert.rejects(running, change === 'revoke-directory' ? /directory-not-allowed/
      : change === 'disable-creation' ? /new-conversation-disabled/ : /connection-disabled/)
    await gate.entered
    let closing = Promise.resolve()
    if (change === 'disable') f.config.enabled = false
    if (change === 'revoke-directory') f.config.allowedDirectories = []
    if (change === 'disable-creation') f.config.allowNewConversations = false
    if (change === 'close') closing = f.tasks.close()
    gate.release(); await rejected; await closing
    assert.deepEqual(f.host.calls, [])
    assert.deepEqual(await f.store.tasks(), [])
  })
}

test('revocation while saving intent prevents creation and stable retries never replay that intent', async t => {
  const f = await fixture(t), gate = f.host.pause('persist'), running = f.tasks.run(request(f.cwd))
  await gate.entered; f.config.enabled = false; gate.release()
  const denied = await running
  assert.equal(denied.status, 'failed'); assert.match(denied.events.at(-1)!.message, /connection-disabled.*No prompt was sent/)
  assert.deepEqual(f.host.calls, [])
  f.config.enabled = true
  assert.equal((await f.tasks.run(request(f.cwd))).taskId, denied.taskId)
  assert.deepEqual(f.host.calls, [])
  await f.tasks.run({ ...request(f.cwd), requestId: 'explicit-new-request' })
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
})

test('revocation during session creation stops model selection and prompt, preserving the empty session intent', async t => {
  const f = await fixture(t), gate = f.host.pause('create'), running = f.tasks.run(request(f.cwd))
  await gate.entered; f.config.allowedDirectories = []; gate.release()
  const denied = await running
  assert.equal(denied.status, 'failed'); assert.match(denied.events.at(-1)!.message, /directory-not-allowed.*No prompt was sent/)
  assert.deepEqual(f.host.calls, ['create'])
  f.config.allowedDirectories = [f.cwd]
  await f.tasks.run(request(f.cwd))
  assert.deepEqual(f.host.calls, ['create'])
})

test('revocation during model selection prevents the prompt without pretending the selection was undone', async t => {
  const f = await fixture(t), gate = f.host.pause('select'), running = f.tasks.run(request(f.cwd))
  await gate.entered; f.config.allowNewConversations = false; gate.release()
  const denied = await running
  assert.equal(denied.status, 'failed'); assert.deepEqual(denied.modelSelection, selection)
  assert.deepEqual(f.host.calls, ['create', 'select'])
})

test('removing the actual grant is denied even when an unrelated directory remains authorized', async t => {
  const f = await fixture(t), other = join(f.root, 'other'); await mkdir(other)
  f.config.allowedDirectories.push(other)
  const gate = f.host.pause('preset'), running = f.tasks.run(request(f.cwd))
  const rejected = assert.rejects(running, /directory-not-allowed/)
  await gate.entered; f.config.allowedDirectories = [other]; gate.release(); await rejected
  assert.deepEqual(f.host.calls, [])
})

test('a remaining parent grant still authorizes the same directory after a redundant grant is removed', async t => {
  const f = await fixture(t); f.config.allowedDirectories.push(f.root)
  const gate = f.host.pause('preset'), running = f.tasks.run(request(f.cwd))
  await gate.entered; f.config.allowedDirectories = [f.root]; gate.release()
  assert.equal((await running).status, 'running')
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
})

test('a canonical working directory replaced by a symlink is never silently retargeted', async t => {
  const f = await fixture(t), other = join(f.root, 'other'); await mkdir(other)
  f.config.allowedDirectories = [f.root]
  const gate = f.host.pause('create'), running = f.tasks.run(request(f.cwd))
  await gate.entered
  await rename(f.cwd, join(f.root, 'original')); await symlink(other, f.cwd)
  gate.release(); const denied = await running
  assert.equal(denied.status, 'failed'); assert.match(denied.events.at(-1)!.message, /task-directory-mismatch/)
  assert.deepEqual(f.host.calls, ['create'])
})

test('denied continuation preserves the accepted request, its status and the new operation fingerprint', async t => {
  const f = await fixture(t), first = await f.tasks.run(request(f.cwd)), before = (await f.store.tasks())[0]!
  const follow = { taskId: first.taskId, requestId: 'follow', prompt: 'Follow-up', modelSelection: selection }
  const gate = f.host.pause('persist'), running = f.tasks.send(follow)
  await gate.entered; f.config.enabled = false; gate.release()
  const denied = await running, persisted = (await f.store.tasks())[0]!
  assert.equal(denied.status, 'running')
  assert.match(denied.events.find(event => /No prompt was sent/.test(event.message))!.message, /connection-disabled/)
  assert.equal(persisted.currentRequest, before.currentRequest)
  assert.ok(Object.hasOwn(persisted.operations, 'follow'))
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
  f.config.enabled = true; f.config.allowNewConversations = false
  await f.tasks.send(follow)
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
  await f.tasks.send({ ...follow, requestId: 'explicit-follow-up' })
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt', 'select', 'prompt'])
})

test('continuation revoked during model selection observes the previous accepted turn', async t => {
  const f = await fixture(t), first = await f.tasks.run(request(f.cwd)), before = (await f.store.tasks())[0]!
  const gate = f.host.pause('select'), running = f.tasks.send({ taskId: first.taskId, requestId: 'follow', prompt: 'Follow-up', modelSelection: selection })
  await gate.entered; f.config.allowedDirectories = []; gate.release()
  assert.equal((await running).status, 'running')
  assert.equal((await f.store.tasks())[0]!.currentRequest, before.currentRequest)
  assert.equal(f.host.observedRequests.at(-1), before.currentRequest)
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt', 'select'])
})

test('model selection failure on a continuation preserves the previous accepted execution', async t => {
  const f = await fixture(t), first = await f.tasks.run(request(f.cwd)), before = (await f.store.tasks())[0]!
  f.host.selectModel = async () => { throw new Error('fixture unavailable model') }
  const denied = await f.tasks.send({ taskId: first.taskId, requestId: 'bad-model', prompt: 'Follow-up', modelSelection: selection })
  assert.equal(denied.status, 'running'); assert.match(denied.events.at(-1)!.message, /No prompt was sent/)
  assert.equal((await f.store.tasks())[0]!.currentRequest, before.currentRequest)
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
})

test('closing during prompt admission neither cancels nor rewrites the accepted execution', async t => {
  const f = await fixture(t), gate = f.host.pause('prompt'), running = f.tasks.run(request(f.cwd))
  await gate.entered
  const closing = f.tasks.close(); assert.equal(f.tasks.close(), closing)
  gate.release(); const result = await running; await closing
  assert.equal(result.status, 'running'); assert.equal((await f.store.tasks())[0]!.status, 'running')
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
  assert.deepEqual(f.host.observedRequests, [], 'closed task collections serve the final saved state without starting new observations')
})

test('close rejects queued work while letting the already submitted prompt settle', async t => {
  const f = await fixture(t), gate = f.host.pause('prompt'), first = f.tasks.run(request(f.cwd))
  await gate.entered
  const second = f.tasks.run({ ...request(f.cwd), requestId: 'queued' })
  const rejected = assert.rejects(second, /connection-disabled/), closing = f.tasks.close()
  gate.release(); assert.equal((await first).status, 'running'); await rejected; await closing
  assert.equal((await f.store.tasks()).length, 1)
  assert.deepEqual(f.host.calls, ['create', 'select', 'prompt'])
})

test('service shutdown rejects pending admission before transport teardown completes', async t => {
  const f = await fixture(t, true); assert.ok(f.service)
  const http = (f.service as unknown as { http: ConnectionHttp }).http, close = http.close.bind(http)
  const teardown = f.host.pause('observe')
  http.close = async () => { await f.host.hold('observe'); await close() }
  const gate = f.host.pause('preset'), running = f.tasks.run(request(f.cwd))
  const rejected = assert.rejects(running, /connection-disabled/)
  await gate.entered
  const closing = f.service.close(); await teardown.entered
  gate.release(); await rejected
  assert.deepEqual(f.host.calls, [])
  teardown.release(); await closing
})

async function connect(t: test.TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  assert.ok(f.service)
  const client = new Client({ name: 'admission-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(f.service.read().url), {
    requestInit: { headers: { authorization: `Bearer ${f.service.reveal().token}` } },
  })
  await client.connect(transport)
  t.after(async () => { await transport.terminateSession().catch(() => {}); await client.close() })
  return { client, transport }
}

for (const action of ['disconnect', 'rotate', 'disable-reenable'] as const) {
  test(`HTTP ${action} invalidates only a request still preparing admission`, { timeout: 10000 }, async t => {
    const f = await fixture(t, true); assert.ok(f.service)
    const { client, transport } = await connect(t, f), gate = f.host.pause('preset')
    const running = client.callTool({ name: 'dsh_run', arguments: { ...request(f.cwd), modelSelection: undefined, newConversation: true } }).catch(() => false)
    await gate.entered
    if (action === 'disconnect') await f.service.disconnect(transport.sessionId!)
    else if (action === 'rotate') assert.ok((await f.service.rotate(String(f.service.read().revision))).ok)
    else {
      const before = f.service.read()
      assert.ok((await f.service.save(JSON.stringify({ ...before.configuration, enabled: false }), String(before.revision))).ok)
      const disabled = f.service.read()
      assert.ok((await f.service.save(JSON.stringify({ ...disabled.configuration, enabled: true }), String(disabled.revision))).ok)
    }
    await client.close(); gate.release(); await f.tasks.tick(); await running
    assert.deepEqual(f.host.calls, [])
    assert.deepEqual(await f.store.tasks(), [])
  })
}

test('HTTP disconnect after prompt invocation leaves the accepted task running', { timeout: 10000 }, async t => {
  const f = await fixture(t, true); assert.ok(f.service)
  const { client, transport } = await connect(t, f), gate = f.host.pause('prompt')
  const running = client.callTool({ name: 'dsh_run', arguments: { cwd: f.cwd, requestId: 'accepted', prompt: 'Run' } }).catch(() => false)
  await gate.entered; await f.service.disconnect(transport.sessionId!); await client.close(); gate.release()
  await f.tasks.tick(); await running
  assert.deepEqual(f.host.calls, ['create', 'prompt'])
  assert.equal((await f.store.tasks())[0]!.status, 'running')
})

for (const tool of ['dsh_send', 'dsh_run'] as const) {
  test(`HTTP disconnect stops an unsent continuation through ${tool} without losing the prior turn`, { timeout: 10000 }, async t => {
    const f = await fixture(t, true); assert.ok(f.service)
    const first = await f.tasks.run(request(f.cwd)), before = (await f.store.tasks())[0]!
    const { client, transport } = await connect(t, f), gate = f.host.pause('select')
    const running = client.callTool({ name: tool, arguments: { taskId: first.taskId, requestId: 'follow', prompt: 'Follow-up',
      provider: selection.provider, model: selection.model, ...(tool === 'dsh_run' ? { cwd: f.cwd } : {}) } }).catch(() => false)
    await gate.entered; await f.service.disconnect(transport.sessionId!); await client.close(); gate.release()
    await f.tasks.tick(); await running
    const row = (await f.store.tasks())[0]!
    assert.equal(row.status, 'running'); assert.equal(row.currentRequest, before.currentRequest)
    assert.match(row.events.find(event => /No prompt was sent/.test(event.message))!.message, /request-aborted/)
    assert.deepEqual(f.host.calls, ['create', 'select', 'prompt', 'select'])
  })
}

for (const stage of ['preset', 'prompt'] as const) {
  test(`MCP cancellation notification at ${stage} respects the prompt admission boundary`, { timeout: 10000 }, async t => {
    const f = await fixture(t, true), { client, transport } = await connect(t, f)
    const send = transport.send.bind(transport)
    let requestId: string | number | false = false
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message) requestId = message.id
      await send(message, options)
    }
    const gate = f.host.pause(stage)
    const running = client.callTool({ name: 'dsh_run', arguments: { cwd: f.cwd, requestId: 'cancel-notification', prompt: 'Run' } }).catch(() => false)
    await gate.entered; assert.notEqual(requestId, false)
    await client.notification({ method: 'notifications/cancelled', params: { requestId: requestId as string | number } })
    gate.release(); await f.tasks.tick()
    assert.deepEqual(f.host.calls, stage === 'preset' ? [] : ['create', 'prompt'])
    const rows = await f.store.tasks()
    if (stage === 'preset') assert.equal(rows.length, 0)
    else assert.equal(rows[0]!.status, 'running')
    await client.close(); await running
  })
}
