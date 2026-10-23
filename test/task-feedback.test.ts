import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { taskFeedbackProjection as projection, foldTaskFeedback as fold } from '../src/task-feedback-projection.js'
const initial = (inherited = 0, cwd = '/project') => projection.init({ cwd } as SessionHeader, inherited as SessionLogOffset)
const event = (seq: number, type: string, data: any): SessionEvent => ({ seq, time: seq * 1000, type, data }) as SessionEvent
const call = (seq: number, id: string, name: string, args: object | string) => event(seq, 'tool/call', { turn: 1, step: 1, callId: id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) })
const result = (seq: number, id: string, failed = false, modern = true, meta = {}) => event(seq, 'tool/result', { turn: 1, step: 1, meta,
  message: modern ? { role: 'tool', toolCallId: id, isError: failed, content: [{ type: 'text', text: 'result' }] }
    : { content: [{ type: 'tool-result', toolCallId: id, isError: failed, content: [{ type: 'text', text: 'result' }] }] } })

test('feedback reads user text and explicit goals/todos without creating a plan or altering events', () => {
  const e = event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement the sidebar' }] })
  const original = structuredClone(e)
  let state = fold(initial(), e)
  assert.equal(state.request, 'Implement the sidebar')
  assert.deepEqual(state.todos, [])
  assert.deepEqual(state.goal, { kind: 'none' })
  state = fold(state, event(2, 'user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Not a user goal' }] }))
  assert.equal(state.request, 'Implement the sidebar')
  state = fold(state, event(3, 'goal/change', { goal: { objective: 'Explicit goal', phase: 'active' } }))
  assert.deepEqual(state.goal, { kind: 'recorded', text: 'Explicit goal', status: 'active' })
  state = fold(state, event(4, 'todo/write', { todos: [{ content: 'Verify', status: 'in_progress' }] }))
  assert.equal(state.todos[0]?.status, 'in_progress')
  state = fold(state, event(5, 'turn/end', { reason: { kind: 'completed' } }))
  assert.equal(state.phase, 'idle')
  assert.equal(state.todos[0]?.status, 'in_progress', 'an ended turn does not complete a task')
  state = fold(state, event(6, 'goal/change', { operation: 'clear' }))
  assert.deepEqual(state.goal, { kind: 'none' })
  assert.deepEqual(e, original)
})

test('unknown tools remain visible and unrelated events keep the same projection reference', () => {
  const state = initial()
  assert.equal(fold(state, event(0, 'future/optimization', { change: 'new optimization' })), state)
  assert.equal(fold(state, event(1, 'assistant/attempt', { stream: [] })), state)
  const next = fold(state, call(2, 'custom', 'new_agent_tool', { description: 'Run a new tool' }))
  assert.equal(next.activities[0]?.description, 'Run a new tool')
  assert.equal(next.activities[0]?.status, 'running')
  assert.equal(fold(next, result(3, 'custom')).activities[0]?.status, 'succeeded')
  assert.equal(next.files.length, 0)
})

test('both published result layouts require matching successful completion for file attribution', () => {
  for (const modern of [true, false]) {
    const before = fold(initial(), call(1, 'edit', 'edit', { file_path: './src/app.ts' }))
    assert.equal(before.files.length, 0)
    assert.equal(fold(before, result(2, 'wrong', false, modern)).files.length, 0)
    assert.equal(fold(before, result(2, 'edit', true, modern)).files.length, 0)
    const after = fold(before, result(2, 'edit', false, modern))
    assert.equal(after.files[0]?.path, '/project/src/app.ts')
    assert.equal(after.activities[0]?.status, 'succeeded')
    assert.equal(fold(after, result(2, 'edit', false, modern)), after)
    assert.equal(fold(after, result(3, 'edit', false, modern)).files.length, 1)
  }
})

test('pending native calls match turn and step and parallel results may finish out of order', () => {
  let state = fold(initial(), call(1, 'a', 'write', { file_path: 'a.ts' }))
  state = fold(state, call(2, 'b', 'edit', { file_path: 'b.ts' }))
  assert.equal(fold(state, { ...result(3, 'a'), data: { ...result(3, 'a').data, step: 9 } } as SessionEvent), state)
  state = fold(state, result(4, 'b'))
  state = fold(state, result(5, 'a'))
  assert.deepEqual(state.files.map(file => file.path).sort(), ['/project/a.ts', '/project/b.ts'])
  assert.equal(state.pending.length, 0)
})

test('PTC nested activity and file results work with and without dispatch-start and do not duplicate the outer call', () => {
  const data = { subCallId: 'nested', rootCallId: 'outer', parentCallId: 'outer', name: 'str_replace_editor', arguments: { command: 'create', path: 'hello.ts' } }
  let state = fold(initial(), call(1, 'outer', 'run_code', { description: 'Create file' }))
  state = fold(state, event(2, 'tool/ptc-dispatch-start', data))
  assert.equal(state.activities[1]?.parent, 'outer')
  assert.equal(state.files.length, 0)
  state = fold(state, event(3, 'tool/ptc-dispatch', { ...data, isError: false }))
  state = fold(state, result(4, 'outer'))
  assert.equal(state.files.length, 1)
  assert.equal(state.files[0]?.operation, 'create')
  assert.equal(state.activities.length, 2)
  assert.equal(state.pending.length, 0)
  const withoutStart = fold(initial(), event(1, 'tool/ptc-dispatch', { ...data, isError: false }))
  assert.equal(withoutStart.files.length, 1)
})

test('generic successful applied diff metadata supports new tools without name-specific code', () => {
  const state = fold(initial(), call(1, 'future', 'future_editor', {}))
  const meta = { diffs: [{ path: 'new-tool.ts', oldText: 'before', newText: 'after' }] }
  assert.equal(fold(state, result(2, 'future', false, true, meta)).files[0]?.path, '/project/new-tool.ts')
  assert.equal(fold(state, result(2, 'future', true, true, meta)).files.length, 0)
  for (const meta of [{ diffs: [{ path: 'a', oldText: 'same', newText: 'same' }] }, { diffs: 'invalid' }, { diffs: [{ path: 'a' }] }]) {
    assert.equal(fold(state, result(2, 'future', false, true, meta)).files.length, 0)
  }
})

test('future todo fields and malformed optional blocks preserve usable facts and disclose partial progress', () => {
  let state = fold(initial(), event(1, 'user/message', { source: { kind: 'user' }, content: [null, 1,
    { type: 'text', text: 'Original request' }, { type: 'text', text: {} }, { type: 'future', data: {} }] }))
  assert.equal(state.request, 'Original request')
  state = fold(state, event(2, 'todo/write', { todos: [
    { content: 'Existing task', status: 'completed', futurePriority: 'high' },
    { content: 'Future task', status: 'future-state' }, null,
  ] }))
  assert.deepEqual(state.todos, [{ content: 'Existing task', status: 'completed' }])
  assert.equal(state.omittedTodos, 2)
  assert.equal(projection.stateSchema.safeParse(state).success, true)
})

test('read operations, shell prose and failed calls never invent changed files', () => {
  for (const [name, args] of [['read', { file_path: 'a' }], ['str_replace_editor', { command: 'view', path: 'a' }],
    ['bash', { command: "printf x > a.ts; echo 'edit b.ts'" }], ['run_code', { code: 'write("a")' }]] as const) {
    const state = fold(fold(initial(), call(1, 'read', name, args)), result(2, 'read'))
    assert.equal(state.files.length, 0)
  }
})

test('fork history is skipped, paths are normalized by workspace, and distinct sessions stay separate', () => {
  assert.deepEqual(fold(initial(10), call(1, 'old', 'write', { file_path: 'a' })), initial(10))
  const state = fold(fold(initial(10), call(10, 'own', 'write', { file_path: 'a' })), result(11, 'own'))
  assert.equal(state.files.length, 1)
  const windows = fold(fold(initial(0, 'C:\\project'), call(1, 'win', 'edit', { file_path: '.\\src\\a.ts' })), result(2, 'win'))
  assert.equal(windows.files[0]?.path, 'C:\\project\\src\\a.ts')
  assert.deepEqual(initial().files, [])
})

test('approvals use request identities and wait for all outstanding decisions; interruption is distinct from success', () => {
  let state = fold(initial(), event(1, 'turn/start', { turn: 1 }))
  state = fold(state, event(2, 'approval/asked', { id: 'a', callId: 'c' }))
  state = fold(state, event(3, 'approval/asked', { id: 'b', callId: 'c' }))
  state = fold(state, event(4, 'approval/decided', { id: 'a', outcome: 'allowed-once' }))
  assert.equal(state.phase, 'waiting')
  state = fold(state, event(5, 'approval/decided', { id: 'b', outcome: 'rejected' }))
  assert.equal(state.phase, 'running')
  state = fold(state, call(6, 'pending', 'bash', {}))
  state = fold(state, event(7, 'turn/end', { reason: { kind: 'aborted' } }))
  assert.equal(state.phase, 'interrupted')
  assert.equal(state.activities[0]?.status, 'interrupted')
  assert.equal(state.pending.length, 0)
})

test('malformed/future payloads degrade, bounded windows and checkpoints remain valid', () => {
  const initialState = initial()
  const unknownTodos = fold(initialState, event(1, 'todo/write', { todos: [{ text: 'unknown shape' }] }))
  assert.deepEqual(unknownTodos.todos, [])
  assert.equal(unknownTodos.omittedTodos, 1)
  let state = initial()
  for (let i = 0; i < 210; i++) {
    state = fold(state, call(i * 2, 'c' + i, 'write', { file_path: 'f' + i }))
    state = fold(state, result(i * 2 + 1, 'c' + i))
  }
  assert.equal(state.activities.length, 80)
  assert.equal(state.files.length, 160)
  assert.equal(state.omittedActivities, 130)
  assert.equal(state.omittedFiles, 50)
  state = fold(state, event(500, 'todo/write', { todos: Array.from({ length: 210 }, (_, i) => ({ content: '' + i, status: 'pending' })) }))
  assert.equal(state.todos.length, 200)
  assert.equal(state.omittedTodos, 10)
  assert.doesNotThrow(() => projection.stateSchema.parse(state))
  const view = projection.wire.view(state)
  assert.doesNotThrow(() => projection.wire.viewSchema.parse(view))
  assert.equal('pending' in view, false)
  assert.equal('cwd' in view, false)
  assert.deepEqual(projection.wire.view(JSON.parse(JSON.stringify(state))), view)
})

test('registering, reading and replaying feedback leaves model inputs, tools and execution unchanged', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  ctx.systemPrompt.section({ name: 'fixture', order: 1, text: 'Existing instructions' })
  let executed = 0
  ctx.tools.register(defineTool({ name: 'observe_fixture', description: 'Existing tool', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { executed++; return 'unchanged' },
  }))
  const session = ctx.sessions.create(SessionId('feedback-noninterference'), { meta: { cwd: '/project' } })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Do the same work' }] }), { surfaceOp: 'append' })
  const agent = { session, ctx } as Agent
  const inputs = async () => ({ system: await ctx.systemPrompt.assemble({ agent, scope: agent }), messages: session.deriveMessages(), tools: ctx.tools.schemas(agent) })
  const before = await inputs(), journal = session.snapshotEvents(), cursor = session.seq
  ctx.sessionProjections.register(projection)
  const a = ctx.sessionProjections.snapshot(session).values.superCodeFeedback
  const b = ctx.sessionProjections.snapshot(session).values.superCodeFeedback
  assert.equal(a?.request, 'Do the same work')
  assert.deepEqual(a, b)
  assert.deepEqual(await inputs(), before)
  assert.deepEqual(session.snapshotEvents(), journal)
  assert.equal(session.seq, cursor)
  const value = await ctx.tools.execute({ agent, callId: ToolCallId('same-call'), name: 'observe_fixture', arguments: {}, signal: new AbortController().signal })
  assert.equal(value.isError, false)
  assert.equal(value.value, 'unchanged')
  assert.equal(executed, 1)
  assert.equal(session.seq, cursor, 'the UI projection writes no model messages or journal events')
  const resultEvent = session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('same-call'), content: [{ type: 'text', text: 'unchanged' }], isError: false }) }, { surfaceOp: 'append' })
  const messages = session.deriveMessages()
  ctx.sessionProjections.snapshot(session)
  assert.deepEqual(session.deriveMessages(), messages)
  assert.equal(session.seq, resultEvent.seq + 1)
})
