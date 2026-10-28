import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { invokeConnectionTool } from '../src/connection/client.js'
import { CallerApprovals } from '../src/connection/approvals.js'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionService } from '../src/connection/service.js'
import { defaultConnectionConfig } from '../src/connection/types.js'
import type { CallerApproval, DelegationHost, HostObservation } from '../src/connection/types.js'
import { applyConnectionApproval } from '../src/dsh/connection-approval.js'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000
  while (true) { const value = await read(); if (ready(value)) return value; if (Date.now() >= deadline) throw new Error('condition not reached'); await pause(10) }
}
class Host implements DelegationHost {
  async preset(): Promise<string> { return 'super-code' }
  async create(): Promise<void> {}
  async prompt(): Promise<void> {}
  async cancel(): Promise<void> {}
  async observe(): Promise<HostObservation> { return { status: 'running', output: '', detail: 'fixture; no model call' } }
}
async function fixture(t: test.TestContext, form = false, response: 'approve' | 'reject' | 'cancel' = 'approve') {
  const root = await mkdtemp(join(tmpdir(), 'super-code-approval-')), profile = join(root, 'profile')
  const ctx = new Context(); await ctx.plugin(ApprovalService, {})
  let service: ConnectionService | false = new ConnectionService(new ConnectionStore(profile), new Host())
  await service.initialize()
  let hostAnswers = 0
  ctx.on('approval/request', async () => { hostAnswers++; return 'rejected' })
  await ctx.plugin({ apply: (owner: Context) => applyConnectionApproval(owner, () => service) })
  const connection = service
  const configure = async (patch: object) => {
    assert.equal((await connection.save(JSON.stringify({ ...connection.read().configuration, ...patch }), String(connection.read().revision))).ok, true)
  }
  await configure({ ...defaultConnectionConfig, enabled: true, port: await freePort(), allowedDirectories: [root] })
  const client = new Client({ name: 'approval-test', version: '1' }, { capabilities: form ? { elicitation: { form: {} } } : {} })
  const prompts: string[] = []
  if (form) client.setRequestHandler(ElicitRequestSchema, async request => {
    prompts.push(request.params.message)
    return response === 'cancel' ? { action: 'cancel' as const } : { action: 'accept' as const, content: { approve: response === 'approve' } }
  })
  const transport = new StreamableHTTPClientTransport(new URL(connection.read().url), { requestInit: { headers: { authorization: `Bearer ${connection.reveal().token}` } } })
  await client.connect(transport)
  const call = async (name: string, args: object = {}): Promise<any> => client.callTool({ name, arguments: args as Record<string, unknown> })
  const value = (result: any): any => JSON.parse(result.content[0].text)
  const run = value(await call('dsh_run', { requestId: 'initial', cwd: root, prompt: 'test' }))
  const agent = { session: Session.create(SessionId(run.sessionId)) } as Agent
  const scope = createScope(ctx, agent); Object.assign(agent, { ctx: scope.ctx })
  agent.session.append('turn/start', { turn: 1 })
  let calls = 0
  const ask = (who = agent, signal?: AbortSignal) => {
    const callId = ToolCallId(`call-${++calls}`)
    who.session.append('tool/call', { turn: 1, step: 1, name: 'bash', callId, arguments: '{"command":"trash ./build"}' })
    return ctx.approval.request({ agent: who, toolName: 'bash', callId, reason: 'Specific operation', ...(signal ? { signal } : {}) })
  }
  const pending = async (): Promise<CallerApproval[]> => value(await call('dsh_wait', { taskId: run.taskId, waitMs: 0 })).callerApproval.pending
  t.after(async () => {
    await transport.terminateSession().catch(() => {}); await client.close()
    await connection.close(); service = false; await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  return { root, profile, ctx, connection, configure, call, value, run, agent, ask, pending, client, prompts, hostAnswers: () => hostAnswers }
}

test('legacy approval setting is off, invalid input is rejected and enabling persists in settings', async t => {
  const f = await fixture(t)
  assert.equal(f.connection.read().configuration.allowCallerApproval, false)
  const stored = JSON.parse(await readFile(join(f.profile, 'settings.json'), 'utf8'))
  delete stored.config.allowCallerApproval
  await writeFile(join(f.profile, 'settings.json'), JSON.stringify(stored))
  // A separate read verifies legacy normalization without taking over the live store.
  assert.equal((await new ConnectionStore(f.profile).settings()).config.allowCallerApproval, false)
  const invalid = await f.connection.save(JSON.stringify({ ...f.connection.read().configuration, allowCallerApproval: 'true' }), String(f.connection.read().revision))
  assert.equal(invalid.ok, false)
  await f.configure({ allowCallerApproval: true })
  assert.equal(JSON.parse(await readFile(join(f.profile, 'settings.json'), 'utf8')).config.allowCallerApproval, true)
})

test('real host approval audit routes only opted-in MCP calls, exact decisions are idempotent and denial remains denial', async t => {
  const f = await fixture(t)
  assert.equal(await f.ask(), 'rejected'); assert.equal(f.hostAnswers(), 1)
  assert.equal((await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: 'none', decision: 'approve' })).content[0].text, 'caller-approval-disabled')
  await f.configure({ allowCallerApproval: true })
  assert.equal(f.value(await f.call('dsh_status')).allowCallerApproval, true)
  const decision = f.ask()
  const pending = await eventually(f.pending, rows => rows.length === 1), item = pending[0]!
  assert.equal(item.sessionId, f.agent.session.id); assert.equal(item.cwd, f.run.cwd)
  assert.match(item.arguments, /trash/); assert.equal(item.reason, 'Specific operation')
  const args = { taskId: f.run.taskId, approvalId: item.id, decision: 'approve' }
  assert.equal(f.value(await f.call('dsh_approve', args)).outcome, 'allowed-once')
  assert.equal(await decision, 'allowed-once')
  assert.equal(f.value(await f.call('dsh_approve', args)).repeated, true)
  assert.equal((await f.call('dsh_approve', { ...args, decision: 'reject' })).content[0].text, 'approval-conflict')
  const rejected = f.ask(), next = (await eventually(f.pending, rows => rows.length === 1))[0]!
  await f.call('dsh_approve', { ...args, approvalId: next.id, decision: 'reject' })
  assert.equal(await rejected, 'rejected')
  const outcomes = f.agent.session.ownEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome)
  assert.deepEqual(outcomes, ['rejected', 'allowed-once', 'rejected'])
  assert.equal(f.hostAnswers(), 1)
})

test('live MCP descendants can ask; ordinary, seeded-but-unrelated and never-policy sessions cannot gain caller authority', async t => {
  const f = await fixture(t); await f.configure({ allowCallerApproval: true })
  const child = { session: Session.create(SessionId('managed-child')) } as Agent
  Object.assign(child, { ctx: createScope(f.ctx, child, { parent: f.agent }).ctx })
  child.session.append('turn/start', { turn: 1 })
  const result = f.ask(child), item = (await eventually(f.pending, rows => rows.length === 1))[0]!
  assert.equal(item.sessionId, child.session.id)
  await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: item.id, decision: 'approve' })
  assert.equal(await result, 'allowed-once')
  const ordinary = { session: Session.create(SessionId('ordinary'), [], { ...f.agent.session.header, id: SessionId('ordinary'), parentSession: f.agent.session.id }), ctx: f.ctx } as Agent
  ordinary.session.append('turn/start', { turn: 1 })
  assert.equal(await f.ask(ordinary), 'rejected')
  f.agent.session.append('approval/policy', { policy: 'never' })
  const before = f.hostAnswers()
  assert.equal(await f.ask(), 'rejected'); assert.equal(f.hostAnswers(), before)
  assert.equal((await f.pending()).length, 0)
})

test('disabling caller approval, withdrawing directory access and cancellation revoke pending requests', async t => {
  const f = await fixture(t)
  for (const patch of [{ allowCallerApproval: false }, { allowedDirectories: [join(f.root, 'profile')] }]) {
    await f.configure({ enabled: true, allowedDirectories: [f.root], allowCallerApproval: true })
    const result = f.ask(), pending = (await eventually(f.pending, rows => rows.length === 1))[0]!
    await f.configure(patch)
    assert.equal(await result, 'rejected', 'pending question returns to host answerer')
    assert.equal((await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: pending.id, decision: 'approve' })).isError, true)
  }
  await f.configure({ enabled: true, allowedDirectories: [f.root], allowCallerApproval: true })
  const abort = new AbortController(), result = f.ask(f.agent, abort.signal)
  const pending = (await eventually(f.pending, rows => rows.length === 1))[0]!
  abort.abort(); assert.equal(await result, 'cancelled')
  assert.equal((await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: pending.id, decision: 'approve' })).content[0].text, 'approval-not-found')
})

test('ephemeral approval broker expires, bounds and binds requests without persisting grants', async () => {
  let time = 100
  const broker = new CallerApprovals(() => time)
  const input = { taskId: 'task', sessionId: 'root', cwd: '/project', toolName: 'bash', reason: 'reason', arguments: '{}' }
  const expired = broker.request(input), row = broker.pending('task')[0]!
  assert.throws(() => broker.decide('other', row.id, 'approve'), /approval-not-found/)
  time += 300001; assert.equal(broker.pending('task').length, 0); assert.equal(await expired, 'host')
  assert.throws(() => broker.decide('task', row.id, 'approve'), /approval-not-found/)
  assert.equal(await broker.request({ ...input, arguments: 'x'.repeat(16001) }), 'host')
  const pending = Array.from({ length: 32 }, () => broker.request(input))
  assert.equal(await broker.request(input), 'host')
  broker.withdraw(); assert.deepEqual(await Promise.all(pending), Array(32).fill('host'))
  assert.equal(new CallerApprovals().pending('task').length, 0)
})

test('stopping and restarting the service preserves the switch but never recovers a pending approval', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-approval-restart-')), profile = join(root, 'profile')
  let service = new ConnectionService(new ConnectionStore(profile), new Host())
  await service.initialize()
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  assert.equal((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, allowCallerApproval: true,
    port: await freePort(), allowedDirectories: [root] }), '0')).ok, true)
  const call = async (name: string, args: object) => {
    const result = await invokeConnectionTool({ url: service.read().url, token: service.reveal().token, tool: name, arguments: args as Record<string, unknown> })
    return { result, value: result.isError ? (result.content as any)[0].text : JSON.parse((result.content as any)[0].text) }
  }
  const task = (await call('dsh_run', { requestId: 'restart', cwd: root, prompt: 'test' })).value
  const result = service.requestApproval({ sessionId: task.sessionId, toolName: 'bash', arguments: '{}', reason: 'restart test' }, [task.sessionId])
  const view = await eventually(() => call('dsh_wait', { taskId: task.taskId }), value => value.value.callerApproval.pending.length === 1)
  const item = view.value.callerApproval.pending[0]
  await service.close()
  assert.equal(await result, 'host')
  service = new ConnectionService(new ConnectionStore(profile), new Host()); await service.initialize()
  assert.equal(service.read().configuration.allowCallerApproval, true)
  assert.equal((await call('dsh_wait', { taskId: task.taskId })).value.callerApproval.pending.length, 0)
  assert.equal((await call('dsh_approve', { taskId: task.taskId, approvalId: item.id, decision: 'approve' })).result.isError, true)
})

test('a mismatched or missing tool call stays with the host and a second task cannot reuse another approval ID', async t => {
  const f = await fixture(t); await f.configure({ allowCallerApproval: true })
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'bash', callId: ToolCallId('missing') }), 'rejected')
  assert.equal((await f.pending()).length, 0)
  const result = f.ask(), item = (await eventually(f.pending, rows => rows.length === 1))[0]!
  assert.equal((await f.call('dsh_approve', { taskId: 'foreign', approvalId: item.id, decision: 'approve' })).content[0].text, 'task-not-found')
  assert.equal((await f.pending()).length, 1)
  await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: item.id, decision: 'reject' })
  assert.equal(await result, 'rejected')
})

for (const response of ['approve', 'reject', 'cancel'] as const) test(`form-capable MCP callers receive an actual approval request: ${response}`, async t => {
  const f = await fixture(t, true, response); await f.configure({ allowCallerApproval: true })
  const result = f.ask()
  await eventually(async () => f.agent.session.ownEvents().filter(event => event.type === 'approval/asked').length, count => count > 0)
  if (response === 'approve') (f.client as any)._requestMessageId = 0 // Force collision with the server's independent first request ID.
  const waited = await eventually(() => f.call('dsh_wait', { taskId: f.run.taskId, cursor: 0, waitMs: 0 }), () => f.prompts.length === 1)
  assert.equal(waited.isError, undefined)
  assert.equal(f.prompts.length, 1); assert.match(f.prompts[0]!, /trash/)
  if (response === 'cancel') {
    assert.equal(f.value(waited).callerApproval.pending.length, 0)
    assert.equal(await result, 'rejected')
  } else assert.equal(await result, response === 'approve' ? 'allowed-once' : 'rejected')
  assert.equal(f.hostAnswers(), response === 'cancel' ? 1 : 0)
})

async function executionFixture(t: test.TestContext) {
  const f = await fixture(t)
  await f.ctx.plugin(SystemPrompt)
  await f.ctx.plugin(Tools)
  let bodies = 0
  f.ctx.tools.register(defineTool({ name: 'bash', description: 'Approval fixture; never spawns a process',
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const answer = await f.ctx.approval.request({ agent: exec.agent!, toolName: exec.name, callId: exec.callId,
        reason: 'Exact nested operation', signal: exec.signal })
      if (answer !== 'allowed-once') throw new Error(`Approval: ${answer}`)
      bodies++
      return args.command
    },
  }))
  f.ctx.tools.register(defineTool({ name: 'nested_fixture', description: 'PTC-style dispatch with an opaque sub-call ID',
    parameters: { command: { type: 'string', required: true }, id: { type: 'string', required: true } },
    output: { schema: { type: 'boolean' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const result = await f.ctx.tools.execute({ parent: exec.token, rootCallId: exec.rootCallId, agent: exec.agent,
        name: 'bash', callId: ToolCallId(args.id), arguments: { command: args.command }, signal: exec.signal })
      return result.isError
    },
  }))
  const execute = (command: string, id: string, agent = f.agent, signal = new AbortController().signal) =>
    f.ctx.tools.execute({ name: 'nested_fixture', agent, callId: ToolCallId(`outer-${id}`),
      arguments: { command, id }, signal })
  return { ...f, execute, bodies: () => bodies }
}

for (const decision of ['approve', 'reject'] as const) test(`nested tool approval carries exact live arguments without a tool/call event: ${decision}`, async t => {
  const f = await executionFixture(t); await f.configure({ allowCallerApproval: true })
  const result = f.execute('trash -- "中文 build"', 'opaque-child')
  const item = (await eventually(f.pending, rows => rows.length === 1))[0]!
  assert.equal(item.callId, 'opaque-child'); assert.equal(item.toolName, 'bash')
  assert.deepEqual(JSON.parse(item.arguments), { command: 'trash -- "中文 build"' })
  assert.equal(item.reason, 'Exact nested operation')
  assert.equal(f.agent.session.ownEvents().some(event => event.type === 'tool/call'), false)
  await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: item.id, decision })
  const outcome = await result
  assert.equal(outcome.isError, false); assert.equal(outcome.value, decision === 'reject')
  assert.equal(f.bodies(), decision === 'approve' ? 1 : 0)
  assert.equal(f.hostAnswers(), 0)
  // The live dispatch has settled; its ID must not authorize a later request.
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'bash', callId: ToolCallId('opaque-child') }), 'rejected')
  assert.equal((await f.pending()).length, 0)
})

test('concurrent nested calls isolate arguments by Agent, call ID and tool name', async t => {
  const f = await executionFixture(t); await f.configure({ allowCallerApproval: true })
  const child = { session: Session.create(SessionId('nested-child')) } as Agent
  Object.assign(child, { ctx: createScope(f.ctx, child, { parent: f.agent }).ctx })
  child.session.append('turn/start', { turn: 1 })
  const rootResult = f.execute('trash root', 'same-id'), childResult = f.execute('trash child', 'same-id', child)
  const rows = await eventually(f.pending, items => items.length === 2)
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'other', callId: ToolCallId('same-id') }), 'rejected')
  for (const row of rows) {
    assert.equal(JSON.parse(row.arguments).command, row.sessionId === f.agent.session.id ? 'trash root' : 'trash child')
    await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: row.id, decision: row.sessionId === child.session.id ? 'reject' : 'approve' })
  }
  assert.equal((await rootResult).value, false); assert.equal((await childResult).value, true)
  assert.equal(f.bodies(), 1)
})

test('cancelled nested executions withdraw approval and discard live arguments', async t => {
  const f = await executionFixture(t); await f.configure({ allowCallerApproval: true })
  const abort = new AbortController(), result = f.execute('trash build', 'aborted-child', f.agent, abort.signal)
  const row = (await eventually(f.pending, rows => rows.length === 1))[0]!
  abort.abort(); await result
  assert.equal(f.bodies(), 0); assert.equal((await f.pending()).length, 0)
  assert.equal((await f.call('dsh_approve', { taskId: f.run.taskId, approvalId: row.id, decision: 'approve' })).isError, true)
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'bash', callId: ToolCallId('aborted-child') }), 'rejected')
})

test('disabled caller approval and oversized nested arguments stay with the host', async t => {
  const f = await executionFixture(t)
  assert.equal((await f.execute('trash build', 'disabled-child')).value, true)
  await f.configure({ allowCallerApproval: true })
  assert.equal((await f.execute('x'.repeat(16001), 'large-child')).value, true)
  assert.equal((await f.pending()).length, 0); assert.equal(f.bodies(), 0); assert.equal(f.hostAnswers(), 2)
})
