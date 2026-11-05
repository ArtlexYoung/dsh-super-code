import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionService } from '../src/connection/service.js'
import { DelegatedTasks } from '../src/connection/tasks.js'
import { ConnectionError, defaultConnectionConfig } from '../src/connection/types.js'
import type { ConnectionConfig, DelegationHost, HistoryCursor, HistoryPage, HostObservation } from '../src/connection/types.js'
import { ConnectionHost, connectionSessionFacts } from '../src/dsh/connection-host.js'
import { connectionHistoryPage } from '../src/dsh/connection-history.js'
import { invokeConnectionTool } from '../src/connection/client.js'
import { ConnectionHttp } from '../src/connection/http.js'

const log = (rows: [string, object][]): SessionEvent[] => rows.map(([type, data], seq) => ({ type, seq, data, time: Date.now() })) as SessionEvent[]
class Host implements DelegationHost {
  created = 0; prompts = 0; cancellations = 0
  observation: HostObservation = { status: 'running', output: '', detail: 'Running' }
  events = log([['tool/call', { name: 'bash', arguments: '{"command":"test"}' }]])
  async preset(): Promise<string> { return 'super-code' }
  async create(): Promise<void> { this.created++ }
  async prompt(): Promise<void> { this.prompts++ }
  async cancel(): Promise<void> { this.cancellations++ }
  async observe(): Promise<HostObservation> { return this.observation }
  async history(_id: string, cursor: HistoryCursor, limit: number): Promise<HistoryPage> { return connectionHistoryPage(this.events, cursor, limit) }
}
async function port(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port unavailable')
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port
}
async function fixture(t: test.TestContext, expectedCloseFailure?: RegExp) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-reliability-')), host = new Host()
  const store = new ConnectionStore(join(root, 'profile')), service = new ConnectionService(store, host)
  await service.initialize()
  assert.equal((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, maxConnections: 1, port: await port(), allowedDirectories: [root] }), '0')).ok, true)
  t.after(async () => {
    try { await service.close() }
    catch (error) { if (!expectedCloseFailure?.test(String(error))) throw error }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const call = (tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => invokeConnectionTool({ url: service.read().url, token: service.reveal().token, tool, arguments: args }, signal)
  return { root, host, store, service, call }
}

test('public history pages retain complete Unicode text across both tool-result layouts and exclude private events', () => {
  for (const legacy of [true, false]) {
    const text = 'a'.repeat(3999) + '🧪' + 'b'.repeat(18000), tool = { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text }], isError: true }
    const events = log([
      ['request/header', { secret: 'PRIVATE-HEADER' }], ['assistant/attempt', { stream: 'PRIVATE-STREAM' }],
      ['assistant/message', { message: { content: [{ type: 'reasoning', text: 'PRIVATE-REASONING' }, { type: 'text', text: 'Public answer' }] }, stream: 'PRIVATE-STREAM' }],
      ['tool/call', { name: 'bash', arguments: '{"command":"run tests"}' }],
      ['tool/result', { message: legacy ? { role: 'tool', ...tool } : { role: 'user', content: [tool] } }],
      ['turn/end', { reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'PRIVATE-ERROR-DETAIL' } } }],
    ])
    let cursor = { seq: 0, offset: 0 }, result = '', seen = '', count = 0, error = false
    do {
      const page = connectionHistoryPage(events, cursor, 2)
      assert.ok(page.entries.reduce((sum, row) => sum + row.text.length, 0) <= 16000)
      assert.notDeepEqual(page.nextCursor, cursor)
      for (const row of page.entries) { if (row.type === 'tool/result') { result += row.text; error ||= row.isError === true }; seen += row.text }
      cursor = page.nextCursor
      if (!page.hasMore) break
      assert.ok(++count < 20)
    } while (true)
    assert.equal(result, text)
    assert.ok(error); assert.match(seen, /Public answer/); assert.match(seen, /RATE_LIMIT/)
    assert.doesNotMatch(seen, /PRIVATE/)
    assert.throws(() => connectionHistoryPage(events, { seq: 4, offset: 4000 }, 1), /invalid-history-cursor/)
    assert.throws(() => connectionHistoryPage(events, { seq: 99, offset: 1 }, 1), /invalid-history-cursor/)
  }
})

test('active tool events advance progress even without assistant text and failed turns report a public error code', () => {
  const events = log([['user/message', { source: { rpcId: 'request' } }], ['tool/call', { name: 'bash', arguments: '{}' }]])
  const running = connectionSessionFacts(events, 'running', 'request')
  assert.equal(running.output, ''); assert.equal(running.observation.lastEventSeq, 1)
  assert.equal(running.observation.lastEventType, 'tool/call')
  const failed = connectionSessionFacts([...events, ...log([['turn/end', { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } }]]).map(row => ({ ...row, seq: row.seq + 2 }))] as SessionEvent[], 'idle', 'request')
  assert.equal(failed.status, 'failed'); assert.equal(failed.observation.errorCode, 'RATE_LIMIT')
  const long = connectionSessionFacts(log([['user/message', { source: { rpcId: 'r' } }], ['assistant/message', { content: [{ type: 'text', text: 'x'.repeat(13000) }] }]]), 'running', 'r')
  assert.equal(long.output.length, 12000); assert.equal(long.observation.outputTruncated, true)
})

test('history traversal stays bounded across private event runs without dropping the next public result', () => {
  const events = log(Array.from({ length: 2005 }, () => ['assistant/attempt', { stream: 'PRIVATE' }] as [string, object]))
  events.push(...log([['assistant/message', { content: [{ type: 'text', text: 'Public result' }] }]]).map(event => ({ ...event, seq: events.length })))
  const first = connectionHistoryPage(events, { seq: 0, offset: 0 }, 10)
  assert.equal(first.entries.length, 0); assert.equal(first.hasMore, true)
  const second = connectionHistoryPage(events, first.nextCursor, 10)
  assert.equal(second.entries[0]!.text, 'Public result'); assert.equal(second.hasMore, false)
})

test('host history excludes inherited events and failed descendants cannot produce a finished task state', async () => {
  const root = log([['assistant/message', { content: [{ type: 'text', text: 'INHERITED' }] }], ['user/message', { source: { rpcId: 'r' } }], ['turn/end', { reason: { kind: 'completed' } }]])
  let disposed = 0
  const host = new ConnectionHost({ presets: { status: async () => ({ state: 'available', id: 'super-code' }) as any },
    controller: { create: async row => ({ sessionId: row.sessionId }), prompt: async () => ({ accepted: true }) },
    agents: { get: () => ({ status: 'idle', cancel: () => {} }) },
    query: { observeSession: async id => ({ events: id === 'root' ? root : log([['turn/end', { reason: { kind: 'error' } }]]), inheritedEventCount: id === 'root' ? 1 : 0, [Symbol.dispose]: () => { disposed++ } }) },
    subagents: { listDescendants: async () => [{ id: 'child', parentId: 'root', kind: 'child' }], interrupt: async () => ({}) } })
  assert.equal((await host.observe('root', 'r')).status, 'failed')
  assert.doesNotMatch(JSON.stringify(await host.history('root', { seq: 0, offset: 0 }, 10)), /INHERITED/)
  const child = await host.history('root', { seq: 0, offset: 0 }, 10, 'child')
  assert.equal(child.sessionId, 'child'); assert.match(child.entries[0]!.text, /error/)
  await assert.rejects(host.history('root', { seq: 0, offset: 0 }, 10, 'unrelated-session'), /history-session-not-owned/)
  assert.equal(disposed, 4)
})

test('failed historical children do not poison a later continuation in the same conversation', async () => {
  const root = log([['user/message', { source: { rpcId: 'new-request' } }], ['turn/end', { reason: { kind: 'completed' } }]]).map(event => ({ ...event, time: 500 }))
  let childTime = 100
  const host = new ConnectionHost({ presets: { status: async () => ({ state: 'available', id: 'super-code' }) as any },
    controller: { create: async row => ({ sessionId: row.sessionId }), prompt: async () => ({ accepted: true }) },
    agents: { get: () => ({ status: 'idle', cancel: () => {} }) },
    query: { observeSession: async id => ({ events: id === 'root' ? root : log([['turn/end', { reason: { kind: 'error' } }]]).map(event => ({ ...event, time: childTime })), inheritedEventCount: 0, [Symbol.dispose]: () => {} }) },
    subagents: { listDescendants: async () => [{ id: 'child', parentId: 'root', kind: 'child' }], interrupt: async () => ({}) } })
  assert.equal((await host.observe('root', 'new-request')).status, 'finished')
  childTime = 600
  assert.equal((await host.observe('root', 'new-request')).status, 'failed')
})

test('capacity refresh frees settled tasks, preserves uncertain blockers and cross-route retries never redispatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-capacity-')), store = new ConnectionStore(join(root, 'profile')), host = new Host()
  await store.initialize()
  const config: ConnectionConfig = { ...defaultConnectionConfig, enabled: true, maxConnections: 1, allowedDirectories: [join(root, 'missing-grant'), root] }
  const tasks = new DelegatedTasks(store, host, () => config); await tasks.initialize()
  t.after(async () => { await tasks.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const input = { requestId: 'initial', cwd: root, prompt: 'First', client: 'test' }, first = await tasks.run(input)
  await tasks.send({ taskId: first.taskId, requestId: input.requestId, prompt: input.prompt })
  assert.equal(host.prompts, 1)
  await assert.rejects(tasks.send({ taskId: first.taskId, requestId: input.requestId, prompt: 'Different' }), /request-conflict/)
  host.observation = { status: 'finished', output: 'done', detail: 'Finished' }
  const create = host.create.bind(host)
  host.create = async () => { await create(); host.observation = { status: 'running', output: 'latest output', detail: 'Running' } }
  const second = await tasks.run({ ...input, requestId: 'next' })
  assert.notEqual(second.taskId, first.taskId); assert.equal(host.created, 2)
  host.observation = { status: 'unavailable', output: '', detail: 'Cannot establish completion' }
  await assert.rejects(tasks.run({ ...input, requestId: 'blocked' }), error => error instanceof ConnectionError && error.code === 'concurrency-limit' && (error.details.blockingTasks as any)[0].taskId === second.taskId)
  const status = await tasks.status({ connections: 1, maxConnections: 1 })
  assert.equal(status.activeTasks, 1); assert.equal(status.availableTasks, 0)
  assert.equal((await tasks.wait(second.taskId, 0, 0)).output, 'latest output', 'temporary observation failure retains last known public output')
  config.allowedDirectories = []
  await assert.rejects(tasks.history(first.taskId, { seq: 0, offset: 0 }, 10), /directory-not-allowed/)
  await assert.rejects(tasks.history('other-session', { seq: 0, offset: 0 }, 10), /task-not-found/)
})

test('SDK close alone leaks a quota slot; DELETE and packaged calls release only their own session', async t => {
  const f = await fixture(t), client = new Client({ name: 'lifecycle-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(f.service.read().url), { requestInit: { headers: { authorization: `Bearer ${f.service.reveal().token}` } } })
  await client.connect(transport)
  assert.match(client.getInstructions()!, /delegation executor/)
  const id = transport.sessionId!
  await client.close()
  assert.equal(f.service.overview().connections.length, 1)
  await assert.rejects(f.call('dsh_status'), /Maximum MCP connections reached/)
  assert.equal((await fetch(f.service.read().url, { method: 'DELETE', headers: { authorization: `Bearer ${f.service.reveal().token}`, 'mcp-session-id': id } })).status, 200)
  assert.equal(f.service.overview().connections.length, 0)
  for (let index = 0; index < 12; index++) {
    const result = await f.call('dsh_status')
    assert.equal(result.isError, undefined)
    assert.equal(JSON.parse((result.content as any)[0].text).role, 'delegation-executor')
    assert.equal(f.service.overview().connections.length, 0)
  }
  const unknown = await f.call('dsh_read', { taskId: 'unknown' })
  assert.equal(unknown.isError, true)
  assert.equal(f.service.overview().connections.length, 0)
  assert.equal((await f.call('dsh_nonexistent')).isError, true)
  assert.equal(f.service.overview().connections.length, 0)
  assert.equal(f.host.cancellations, 0)
})

test('closing MCP during connection admission cannot leave a late client behind', { timeout: 5000 }, async t => {
  const f = await fixture(t), http = (f.service as unknown as { http: ConnectionHttp }).http
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const internal = http as unknown as { prune(): Promise<void>; requests: number }
  const prune = internal.prune
  internal.prune = async function () { entered.resolve(); await gate.promise; await prune.call(this) }
  t.after(() => { gate.resolve(); internal.prune = prune })
  const call = f.call('dsh_status').then(() => 'finished', () => 'closed')
  await entered.promise
  await f.service.close()
  gate.resolve()
  await call
  for (let i = 0; internal.requests && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(internal.requests, 0)
  assert.equal(http.connections().length, 0)
  assert.equal(f.host.prompts, 0)
})

test('an abandoned MCP initialization releases its quota without closing the listener', { timeout: 5000 }, async t => {
  const f = await fixture(t), http = (f.service as unknown as { http: ConnectionHttp }).http
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), controller = new AbortController()
  const internal = http as unknown as { prune(): Promise<void>; requests: number; pending: Set<AbortController> }, prune = internal.prune
  internal.prune = async function () { entered.resolve(); await gate.promise; await prune.call(this) }
  t.after(() => { gate.resolve(); internal.prune = prune })
  const call = f.call('dsh_status', {}, controller.signal).then(() => 'finished', () => 'cancelled')
  await entered.promise
  controller.abort()
  assert.equal(await call, 'cancelled')
  for (let i = 0; ![...internal.pending].some(pending => pending.signal.aborted) && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.ok([...internal.pending].some(pending => pending.signal.aborted), 'the server observed the client disconnect before admission resumed')
  gate.resolve()
  for (let i = 0; internal.requests && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(internal.requests, 0)
  assert.equal(http.connections().length, 0)
  assert.equal((await f.call('dsh_status')).isError, undefined)
  assert.equal(f.host.prompts, 0)
})

test('restarting the MCP listener rejects an old admission and accepts a fresh connection', { timeout: 5000 }, async t => {
  const f = await fixture(t), http = (f.service as unknown as { http: ConnectionHttp }).http
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const internal = http as unknown as { prune(): Promise<void>; requests: number }, prune = internal.prune
  internal.prune = async function () { entered.resolve(); await gate.promise; await prune.call(this) }
  t.after(() => { gate.resolve(); internal.prune = prune })
  const old = f.call('dsh_status').then(() => 'finished', () => 'restarted')
  await entered.promise
  const snapshot = f.service.read()
  assert.equal((await f.service.save(JSON.stringify({ ...snapshot.configuration, port: await port() }), String(snapshot.revision))).ok, true)
  assert.equal(f.service.read().state, 'listening')
  gate.resolve()
  assert.equal(await old, 'restarted')
  for (let i = 0; internal.requests && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(internal.requests, 0)
  assert.equal(http.connections().length, 0)
  assert.equal((await f.call('dsh_status')).isError, undefined)
})

test('repeated MCP shutdown is safe and never rewrites already closed storage', async t => {
  const f = await fixture(t)
  await Promise.all([f.service.close(), f.service.close()])
  await f.service.close()
  await assert.rejects(access(join(f.root, 'profile/owner.lock')))
})

test('failed task persistence during MCP shutdown still releases the profile lock', async t => {
  const failure = new Error('fixture task persistence failure'), f = await fixture(t, /fixture task persistence failure/)
  const save = f.store.saveTasks
  f.store.saveTasks = async () => { throw failure }
  try {
    await assert.rejects(f.service.close(), error => error === failure)
    await assert.rejects(access(join(f.root, 'profile/owner.lock')))
    await assert.rejects(fetch(f.service.read().url))
  } finally { f.store.saveTasks = save }
})

test('a client teardown failure still closes the MCP listener and releases storage', async t => {
  const failure = new Error('fixture transport close failure'), f = await fixture(t, /fixture transport close failure/)
  const client = new Client({ name: 'shutdown-failure', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(f.service.read().url), {
    requestInit: { headers: { authorization: `Bearer ${f.service.reveal().token}` } },
  })
  await client.connect(transport)
  const http = (f.service as unknown as { http: ConnectionHttp }).http
  const internal = http as unknown as { server: Server; clients: Map<string, { mcp: { close(): Promise<void> } }> }
  const server = internal.server, mcp = internal.clients.get(transport.sessionId!)!.mcp, close = mcp.close
  mcp.close = async function () { await close.call(this); throw failure }
  try {
    await assert.rejects(f.service.close(), error => error === failure)
    await assert.rejects(fetch(f.service.read().url))
    await assert.rejects(access(join(f.root, 'profile/owner.lock')))
  } finally {
    mcp.close = close
    await client.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('multiple MCP shutdown errors are reported together after the remaining resources are released', async t => {
  const f = await fixture(t, /MCP resource cleanup failed|fixture task shutdown failure/)
  const http = (f.service as unknown as { http: ConnectionHttp }).http, close = http.close, save = f.store.saveTasks
  const transportFailure = new Error('fixture HTTP shutdown failure'), persistenceFailure = new Error('fixture task shutdown failure')
  http.close = async function () { await close.call(this); throw transportFailure }
  f.store.saveTasks = async () => { throw persistenceFailure }
  try {
    await assert.rejects(f.service.close(), error => error instanceof AggregateError
      && error.errors.length === 2 && error.errors[0] === transportFailure && error.errors[1] === persistenceFailure)
    await assert.rejects(access(join(f.root, 'profile/owner.lock')))
    await assert.rejects(fetch(f.service.read().url))
  } finally { http.close = close; f.store.saveTasks = save }
  // Retrying released resources must still report the unrecoverable task save,
  // without repeating that save after the store has closed.
  await assert.rejects(f.service.close(), error => error === persistenceFailure)
})

test('a rejected initialization releases HTTP request counters even when its teardown fails', async t => {
  const f = await fixture(t), http = (f.service as unknown as { http: ConnectionHttp }).http, disconnect = http.disconnect
  const internal = http as unknown as { requests: number; pending: Set<AbortController> }
  http.disconnect = async function (id) { await disconnect.call(this, id); throw new Error('fixture admission teardown failure') }
  try {
    const response = await fetch(f.service.read().url, { method: 'POST', headers: {
      authorization: `Bearer ${f.service.reveal().token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })
    await response.arrayBuffer()
    for (let i = 0; internal.requests && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(http.connections().length, 0)
    assert.equal(internal.requests, 0)
    assert.equal(internal.pending.size, 0)
  } finally { http.disconnect = disconnect }
  assert.equal((await f.call('dsh_status')).isError, undefined)
})

test('HTTP recovery identifies blockers; public history and cancellation of a wait need no UI or new prompt', async t => {
  const f = await fixture(t), first = await f.call('dsh_run', { requestId: 'first', cwd: f.root, prompt: 'Do the work' })
  const task = JSON.parse((first.content as any)[0].text)
  const busy = await f.call('dsh_run', { requestId: 'second', cwd: f.root, prompt: 'Next work' })
  assert.equal(busy.isError, true); assert.equal((busy.content as any)[0].text, 'concurrency-limit')
  const recovery = JSON.parse((busy.content as any)[1].text)
  assert.equal(recovery.blockingTasks[0].taskId, task.taskId); assert.equal(recovery.recovery.action, 'inspect-capacity')
  const page = await f.call('dsh_read', { taskId: task.taskId })
  assert.equal(JSON.parse((page.content as any)[0].text).entries[0].type, 'tool/call')
  const controller = new AbortController()
  const waiting = f.call('dsh_wait', { taskId: task.taskId, cursor: task.cursor, waitMs: 30000 }, controller.signal)
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(waiting)
  assert.equal(f.service.overview().connections.length, 0)
  assert.equal(f.host.prompts, 1); assert.equal(f.host.cancellations, 0)
})

test('a stalled remote DELETE cannot hang a completed packaged call indefinitely', async t => {
  const f = await fixture(t)
  let deleteSeen = false
  const proxy = createHttpServer(async (request, response) => {
    if (request.method === 'DELETE') { deleteSeen = true; return }
    const body: Buffer[] = []
    for await (const chunk of request) body.push(Buffer.from(chunk))
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string' && !['host', 'connection', 'content-length'].includes(name)) headers.set(name, value)
    const upstream = await fetch(f.service.read().url, { method: request.method, headers, ...(request.method === 'POST' ? { body: Buffer.concat(body) } : {}) })
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers))
    response.end(Buffer.from(await upstream.arrayBuffer()))
  })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(async () => { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())) })
  const address = proxy.address(); assert.ok(address && typeof address !== 'string')
  const start = Date.now()
  await assert.rejects(invokeConnectionTool({ url: `http://127.0.0.1:${address.port}/mcp`, token: f.service.reveal().token, tool: 'dsh_status', arguments: {} }))
  assert.equal(deleteSeen, true); assert.ok(Date.now() - start < 12000)
  assert.equal(f.host.cancellations, 0)
})

test('CLI stdin calls use private environment credentials and release the connection after tool errors', async t => {
  const f = await fixture(t)
  const run = (tool: string, args: object, token = f.service.reveal().token): Promise<{ code: number | null; output: string; error: string }> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/connection-cli.ts', tool], { cwd: new URL('..', import.meta.url), env: { ...process.env, DSH_MCP_URL: f.service.read().url, DSH_MCP_TOKEN: token } })
    let output = '', error = ''
    child.on('error', reject); child.stdout.on('data', part => { output += part }); child.stderr.on('data', part => { error += part })
    child.on('close', code => resolve({ code, output, error })); child.stdin.end(JSON.stringify(args))
  })
  const status = await run('dsh_status', {})
  assert.equal(status.code, 0); assert.equal(JSON.parse(status.output).isError, undefined)
  const failed = await run('dsh_read', { taskId: 'unknown' })
  assert.equal(failed.code, 1); assert.equal(JSON.parse(failed.output).isError, true)
  const invalid = await run('dsh_status', {}, 'invalid-secret')
  assert.equal(invalid.code, 2); assert.doesNotMatch(invalid.output + invalid.error, /invalid-secret/)
  assert.equal(f.service.overview().connections.length, 0)
})
