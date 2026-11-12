import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { getEventListeners } from 'node:events'
import { setTimeout as pause } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { ConnectionService } from '../../src/connection/service.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { DelegatedTasks } from '../../src/connection/tasks.js'
import type { ConnectionHttp } from '../../src/connection/http.js'

async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
async function eventually<T>(read: () => T, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000
  while (true) {
    const value = read()
    if (ready(value)) return value
    if (Date.now() >= deadline) throw new Error('Approval condition not reached')
    await pause(5)
  }
}
async function fixture(t: test.TestContext, form = false) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-approval-lifecycle-'))
  let prompts = 0, cancellations = 0, admittedRequest = ''
  const service = new ConnectionService(new ConnectionStore(join(root, 'profile')), {
    preset: async () => 'super-code', create: async () => {}, prompt: async (_session, requestId) => { prompts++; admittedRequest = requestId }, cancel: async () => { cancellations++ },
    observe: async () => ({ status: 'running', output: '', detail: 'Accepted fixture task' }),
  })
  await service.initialize()
  assert.ok((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: await port(),
    allowCallerApproval: true, allowedDirectories: [root] }), '0')).ok)
  const tasks = (service as unknown as { tasks: DelegatedTasks }).tasks
  const run = await tasks.run({ requestId: 'approval-root', cwd: root, prompt: 'Accepted task' })
  const client = new Client({ name: 'approval-lifecycle-test', version: '1' }, { capabilities: form ? { elicitation: { form: {} } } : {} })
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  let forms = 0, requestId: string | number | false = false
  if (form) client.setRequestHandler(ElicitRequestSchema, async () => {
    forms++; entered.resolve(); await released.promise
    return { action: 'accept', content: { approve: true } }
  })
  const transport = new StreamableHTTPClientTransport(new URL(service.read().url), {
    requestInit: { headers: { authorization: `Bearer ${service.reveal().token}` } },
  })
  await client.connect(transport)
  const send = transport.send.bind(transport)
  transport.send = async (message, options) => {
    if ('method' in message && message.method === 'tools/call' && 'id' in message) requestId = message.id
    await send(message, options)
  }
  t.after(async () => {
    released.resolve(); tasks.approvals.withdraw()
    await transport.terminateSession().catch(() => {}); await client.close()
    try { await service.close() } finally { await rm(root, { recursive: true, force: true }) }
  })
  const ask = () => service.requestApproval({ sessionId: run.sessionId, toolName: 'bash', arguments: '{"command":"trash build"}', reason: 'One exact operation' },
    [{ sessionId: run.sessionId, requestIds: [admittedRequest] }])
  const pending = () => tasks.approvals.pending(run.taskId)
  const notifyCancellation = async () => {
    assert.notEqual(requestId, false)
    await client.notification({ method: 'notifications/cancelled', params: { requestId: requestId as string | number } })
  }
  return { root, service, tasks, client, transport, run, ask, pending, entered: entered.promise, release: () => released.resolve(),
    forms: () => forms, prompts: () => prompts, cancellations: () => cancellations, notifyCancellation }
}

test('MCP cancellation of an eliciting wait never grants its late form answer or cancels the task', { timeout: 10000 }, async t => {
  const f = await fixture(t, true), decision = f.ask()
  await eventually(f.pending, rows => rows.length === 1)
  const waiting = f.client.callTool({ name: 'dsh_wait', arguments: { taskId: f.run.taskId, waitMs: 0 } }).catch(() => false)
  try {
    await f.entered
    await f.notifyCancellation()
    f.release()
    assert.equal(await decision, 'host')
    assert.equal(f.forms(), 1)
    assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
    assert.equal((await f.tasks.view(f.run.taskId, 0)).status, 'running')
  } finally { f.release(); await f.client.close(); await waiting }
})

type Authorization = (cwd: string, signal?: AbortSignal, creating?: boolean) => Promise<{ canonical: string; check(expected?: string): void }>
function pauseAuthorization(t: test.TestContext, tasks: DelegatedTasks) {
  const target = tasks as unknown as { authorization: Authorization }, original = target.authorization
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  target.authorization = async function (...args) {
    target.authorization = original
    const grant = await original.apply(this, args)
    entered.resolve(); await released.promise
    return grant
  }
  t.after(() => { released.resolve(); target.authorization = original })
  return { entered: entered.promise, release: () => released.resolve() }
}

test('MCP cancellation of explicit approval during directory validation leaves the approval undecided', { timeout: 10000 }, async t => {
  const f = await fixture(t), decision = f.ask()
  const item = (await eventually(f.pending, rows => rows.length === 1))[0]!, gate = pauseAuthorization(t, f.tasks)
  const original = f.tasks.approve, finished = Promise.withResolvers<void>()
  f.tasks.approve = async function (...args) { try { return await original.apply(this, args) } finally { finished.resolve() } }
  const approving = f.client.callTool({ name: 'dsh_approve', arguments: { taskId: f.run.taskId, approvalId: item.id, decision: 'approve' } }).catch(() => false)
  try {
    await gate.entered; await f.notifyCancellation(); gate.release(); await finished.promise
    assert.equal(f.pending().length, 1, 'a cancelled request cannot settle the exact approval')
    f.tasks.approve = original
    await f.client.callTool({ name: 'dsh_approve', arguments: { taskId: f.run.taskId, approvalId: item.id, decision: 'reject' } })
    assert.equal(await decision, 'rejected')
    assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
  } finally { gate.release(); f.tasks.approve = original; await f.client.close(); await approving }
})

for (const interruption of ['cancel-notification', 'disconnect'] as const) {
  test(`a form answer still awaiting final directory validation cannot grant after ${interruption}`, { timeout: 10000 }, async t => {
    const f = await fixture(t, true), decision = f.ask()
    await eventually(f.pending, rows => rows.length === 1)
    const waiting = f.client.callTool({ name: 'dsh_wait', arguments: { taskId: f.run.taskId, waitMs: 0 } }).catch(() => false)
    try {
      await f.entered
      const gate = pauseAuthorization(t, f.tasks)
      f.release(); await gate.entered
      if (interruption === 'disconnect') await f.service.disconnect(f.transport.sessionId!)
      else await f.notifyCancellation()
      gate.release()
      assert.equal(await decision, 'host')
      assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
    } finally { f.release(); await f.client.close(); await waiting }
  })
}

for (const change of ['disable-caller', 'revoke-directory', 'close'] as const) {
  test(`approval rechecks ${change} after asynchronous directory validation`, { timeout: 10000 }, async t => {
    const f = await fixture(t), decision = f.ask()
    const item = (await eventually(f.pending, rows => rows.length === 1))[0]!, gate = pauseAuthorization(t, f.tasks)
    const approving = f.tasks.approve(f.run.taskId, item.id, 'approve')
    const denied = assert.rejects(approving, change === 'disable-caller' ? /caller-approval-disabled/
      : change === 'revoke-directory' ? /directory-not-allowed/ : /connection-disabled/)
    await gate.entered
    try {
      if (change === 'close') await f.service.close()
      else {
        const before = f.service.read()
        const patch = change === 'disable-caller' ? { allowCallerApproval: false } : { allowedDirectories: [join(f.root, 'profile')] }
        assert.ok((await f.service.save(JSON.stringify({ ...before.configuration, ...patch }), String(before.revision))).ok)
      }
      gate.release(); await denied
      assert.equal(await decision, 'host')
      assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
    } finally { gate.release() }
  })
}

test('an already aborted approval cannot decide, while a later explicit rejection still works', { timeout: 10000 }, async t => {
  const f = await fixture(t), decision = f.ask()
  const item = (await eventually(f.pending, rows => rows.length === 1))[0]!, abort = new AbortController()
  abort.abort()
  await assert.rejects(f.tasks.approve(f.run.taskId, item.id, 'approve', abort.signal), /request-aborted/)
  assert.equal(f.pending().length, 1)
  await f.tasks.approve(f.run.taskId, item.id, 'reject')
  assert.equal(await decision, 'rejected')
})

test('cancellation after an exact approval was decided never undoes or repeats its grant', { timeout: 10000 }, async t => {
  const f = await fixture(t), decision = f.ask()
  const item = (await eventually(f.pending, rows => rows.length === 1))[0]!
  const args = { taskId: f.run.taskId, approvalId: item.id, decision: 'approve' }
  const granted = await f.client.callTool({ name: 'dsh_approve', arguments: args })
  assert.equal(granted.isError, undefined)
  assert.equal(await decision, 'allowed-once')
  await f.notifyCancellation()
  const repeated = await f.tasks.approve(f.run.taskId, item.id, 'approve')
  assert.deepEqual(repeated, { outcome: 'allowed-once', repeated: true })
  assert.equal(f.pending().length, 0)
  assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
})

test('MCP cancellation ends a long poll without terminating its SDK connection or the task', { timeout: 10000 }, async t => {
  const f = await fixture(t), view = await f.tasks.view(f.run.taskId, 0)
  const original = f.tasks.wait, entered = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>()
  f.tasks.wait = async function (...args) { entered.resolve(); try { return await original.apply(this, args) } finally { finished.resolve() } }
  const waiting = f.client.callTool({ name: 'dsh_wait', arguments: { taskId: f.run.taskId, cursor: view.cursor, waitMs: 30000 } }).catch(() => false)
  try {
    await entered.promise; await f.notifyCancellation()
    await Promise.race([finished.promise, pause(2000).then(() => assert.fail('Cancelled wait kept polling'))])
    assert.equal((await f.client.callTool({ name: 'dsh_status', arguments: {} })).isError, undefined)
    assert.equal((await f.tasks.view(f.run.taskId, 0)).status, 'running')
    assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
  } finally { f.tasks.wait = original; await f.client.close(); await waiting }
})

for (const form of [false, true]) for (const callerSignal of [false, true]) {
  test(`repeated ${callerSignal ? 'caller aborts' : 'cancellation notifications'} release HTTP request slots in ${form ? 'streaming' : 'JSON'} mode`, { timeout: 10000 }, async t => {
    const f = await fixture(t, form), original = f.tasks.wait
    const http = (f.service as unknown as { http: ConnectionHttp }).http as unknown as {
      requests: number; pending: Set<AbortController>;
      clients: Map<string, { active: number; calls: Map<string | number, AbortController> }>;
    }
    const waiting: Promise<unknown>[] = []
    try {
      const view = await f.tasks.view(f.run.taskId, 0)
      for (let index = 0; index < 15; index++) {
        const entered = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>(), controller = new AbortController()
        f.tasks.wait = async function (...args) {
          entered.resolve()
          try { return await original.apply(this, args) } finally { finished.resolve() }
        }
        waiting.push(f.client.callTool({ name: 'dsh_wait', arguments: { taskId: f.run.taskId, cursor: view.cursor, waitMs: 30000 } }, undefined,
          callerSignal ? { signal: controller.signal } : {}).catch(() => false))
        await entered.promise
        if (callerSignal) controller.abort()
        else await f.notifyCancellation()
        await finished.promise
        await eventually(() => http.requests, count => count === 0)
        assert.equal(http.pending.size, 0)
        const connection = http.clients.get(f.transport.sessionId!)!
        assert.equal(connection.active, 0)
        assert.equal(connection.calls.size, 0)
      }
      assert.equal((await f.client.callTool({ name: 'dsh_status', arguments: {} })).isError, undefined)
      assert.equal(f.service.overview().connections.length, 1)
      assert.equal((await f.tasks.view(f.run.taskId, 0)).status, 'running')
      assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
    } finally {
      f.tasks.wait = original
      await f.client.close()
      await Promise.allSettled(waiting)
    }
  })
}

test('a cancellation stays within its MCP connection when another client uses the same request ID', { timeout: 10000 }, async t => {
  const f = await fixture(t), client = new Client({ name: 'other-waiter', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(f.service.read().url), {
    requestInit: { headers: { authorization: `Bearer ${f.service.reveal().token}` } },
  })
  await client.connect(transport)
  t.after(async () => { await transport.terminateSession().catch(() => {}); await client.close() })
  const http = (f.service as unknown as { http: ConnectionHttp }).http as unknown as {
    requests: number; clients: Map<string, { calls: Map<string | number, AbortController> }>;
  }
  const view = await f.tasks.view(f.run.taskId, 0), original = f.tasks.wait
  const entered = Promise.withResolvers<void>(), otherAbort = new AbortController()
  let count = 0, otherSettled = false
  f.tasks.wait = async function (...args) { if (++count === 2) entered.resolve(); return original.apply(this, args) }
  const input = { name: 'dsh_wait', arguments: { taskId: f.run.taskId, cursor: view.cursor, waitMs: 30000 } }
  const first = f.client.callTool(input).catch(() => false)
  const other = client.callTool(input, undefined, { signal: otherAbort.signal }).then(() => { otherSettled = true }, () => { otherSettled = true })
  try {
    await entered.promise
    const own = http.clients.get(f.transport.sessionId!)!, foreign = http.clients.get(transport.sessionId!)!
    assert.deepEqual([...own.calls.keys()], [...foreign.calls.keys()])
    await f.notifyCancellation()
    assert.notEqual(await first, false)
    await eventually(() => own.calls.size, size => size === 0)
    assert.equal(foreign.calls.size, 1)
    assert.equal([...foreign.calls.values()][0]!.signal.aborted, false)
    assert.equal(otherSettled, false)
    assert.equal(http.requests, 1)
    otherAbort.abort(); await other
    await eventually(() => http.requests, value => value === 0)
    assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
  } finally {
    f.tasks.wait = original
    otherAbort.abort()
    await client.close(); await f.client.close()
    await Promise.allSettled([first, other])
  }
})

for (const form of [false, true]) for (const action of ['disconnect', 'rotate', 'restart', 'close'] as const) {
  test(`${action} releases an active ${form ? 'streaming' : 'JSON'} wait and its HTTP quota`, { timeout: 10000 }, async t => {
    const f = await fixture(t, form), original = f.tasks.wait, entered = Promise.withResolvers<void>()
    const http = (f.service as unknown as { http: ConnectionHttp }).http as unknown as {
      requests: number; pending: Set<AbortController>; clients: Map<string, unknown>;
    }
    const view = await f.tasks.view(f.run.taskId, 0)
    f.tasks.wait = async function (...args) { entered.resolve(); return original.apply(this, args) }
    const waiting = f.client.callTool({ name: 'dsh_wait', arguments: { taskId: f.run.taskId, cursor: view.cursor, waitMs: 30000 } }).catch(() => false)
    try {
      await entered.promise
      if (action === 'disconnect') await f.service.disconnect(f.transport.sessionId!)
      else if (action === 'rotate') assert.ok((await f.service.rotate(String(f.service.read().revision))).ok)
      else if (action === 'close') await f.service.close()
      else {
        const before = f.service.read()
        assert.ok((await f.service.save(JSON.stringify({ ...before.configuration, enabled: false }), String(before.revision))).ok)
        const disabled = f.service.read()
        assert.ok((await f.service.save(JSON.stringify({ ...disabled.configuration, enabled: true }), String(disabled.revision))).ok)
      }
      await f.client.close(); await waiting
      await eventually(() => http.requests, count => count === 0)
      assert.equal(http.pending.size, 0)
      assert.equal(http.clients.size, 0)
      assert.equal(f.prompts(), 1); assert.equal(f.cancellations(), 0)
      if (action !== 'close') {
        const client = new Client({ name: 'recovered-waiter', version: '1' })
        const transport = new StreamableHTTPClientTransport(new URL(f.service.read().url), {
          requestInit: { headers: { authorization: `Bearer ${f.service.reveal().token}` } },
        })
        try {
          await client.connect(transport)
          assert.equal((await client.callTool({ name: 'dsh_status', arguments: {} })).isError, undefined)
          assert.equal((await f.tasks.view(f.run.taskId, 0)).status, 'running')
        } finally { await transport.terminateSession().catch(() => {}); await client.close() }
      }
    } finally {
      f.tasks.wait = original
      await f.client.close(); await waiting
    }
  })
}

test('completed HTTP requests remove their connection-lifetime listeners', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const http = (f.service as unknown as { http: ConnectionHttp }).http as unknown as {
    requests: number; clients: Map<string, { lifetime: AbortController }>;
  }
  await eventually(() => http.requests, count => count === 0)
  const signal = http.clients.get(f.transport.sessionId!)!.lifetime.signal
  const baseline = getEventListeners(signal, 'abort').length
  for (let index = 0; index < 30; index++) {
    assert.equal((await f.client.callTool({ name: 'dsh_status', arguments: {} })).isError, undefined)
    await eventually(() => http.requests, count => count === 0)
    assert.equal(getEventListeners(signal, 'abort').length, baseline)
  }
})
