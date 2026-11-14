import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset, Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { taskMemoryProjection, taskMemoryView } from '../src/task-memory-projection.js'
import { taskMemorySchema } from '../src/core/task-memory.js'
import { scanSessionPage } from '../src/core/session-scan.js'
import { installTaskMemory } from './task-memory-fixture.js'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'

const task = taskMemorySchema.parse({ id: 'a', title: 'A', team: 'develop', depth: 'complex', workspace: '/w', sourceVersion: 'v', goal: 'Build',
  createdAtSeq: 0, source: { seq: 0, quote: 'private source' }, requirements: [], acceptance: ['pass'], decisions: [],
  evidence: [], next: 'Check', status: 'active', revision: 1, requirementsRevision: 1, delegationRevision: 1 })

test('read barriers retain a confirmed snapshot and independent scans do not block writes', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(taskMemoryProjection)
  t.after(() => ctx.fiber.dispose())
  const { memory, table } = await installTaskMemory(ctx), session = ctx.sessions.create(SessionId('memory-store'))
  const options = { maxContextBytes: 32768, callId: 'task-call' }
  const signal = new AbortController().signal
  const flushEntered = Promise.withResolvers<void>(), finishFlush = Promise.withResolvers<void>()
  ctx.on('session/flush', async () => { flushEntered.resolve(); await finishFlush.promise })
  const write = memory.write(session, signal, () => ({ kind: 'save', task }), options)
  await flushEntered.promise
  let readFinished = false
  const read = memory.read(session, signal).then(value => { readFinished = true; return value })
  await Promise.resolve()
  assert.equal(table.size, 0, 'Task data must wait for durable source messages')
  assert.equal(readFinished, false)
  finishFlush.resolve(); await write
  const snapshot = await read
  assert.equal(snapshot.state.tasks.a?.revision, 1)
  assert.equal(memory.isPending(session), false)
  let writeStarted = false
  let scanFinished = false
  const scan = scanSessionPage(4096, 4096, () => undefined, () => false, signal).then(page => { scanFinished = true; return page })
  await memory.write(session, signal, state => {
    writeStarted = true
    assert.equal(scanFinished, false, 'Write must enter while the independent scan is still pending')
    return { kind: 'save', task: { ...state.tasks.a!, revision: 2, next: 'Done' } }
  }, options)
  assert.equal(writeStarted, true)
  assert.equal(snapshot.state.tasks.a?.revision, 1)
  await scan
  assert.equal((await memory.read(session, signal)).state.tasks.a?.revision, 2)
})

test('wire summaries do not transmit source, requirements or historical evidence', () => {
  const state = { tasks: { a: task }, recentSources: [0], focus: { kind: 'task' as const, id: 'a' } }
  const view = taskMemoryView(state)
  assert.deepEqual(view, { tasks: [{ id: 'a', title: 'A', status: 'active' }], current: { kind: 'task', id: 'a', title: 'A', goal: 'Build', status: 'active', next: 'Check' } })
  assert.doesNotMatch(JSON.stringify(view), /private source|sourceVersion|requirements|evidence/)
  assert.equal(state.tasks.a.source.quote, 'private source')
  assert.deepEqual(taskMemoryView({ ...state, focus: { kind: 'none' } }).current, { kind: 'none' })
})

test('cold v4 replay replaces stale task checkpoints and preserves saves, archives and focus', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(taskMemoryProjection)
  t.after(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('v4-task-replay'))
  const completed = { ...task, status: 'completed', revision: 2 }
  const active = { ...task, id: 'b', title: 'B' }
  const events = [
    { kind: 'save', task }, { kind: 'save', task: completed }, { kind: 'archive', task: completed },
    { kind: 'save', task: active }, { kind: 'focus', id: 'b' },
  ].map((change, seq) => ({
    type: 'user/message', seq, time: seq, surfaceOp: 'append',
    data: { id: `m${seq}`, role: 'user', source: { kind: `plugin:dsh-super-${seq % 2 ? 'agent' : 'code'}/task-memory/v1` },
      content: [{ type: 'text', text: JSON.stringify(change) }] },
  })) as SessionEvent[]
  const stale = { superCodeTasks: { ver: 1, seq: (events.length - 1) as SessionSeqCursor,
    val: { tasks: {}, recentSources: [], focus: { kind: 'none' } } } }
  assert.equal(ctx.sessionProjections.restoreFloor(stale), 0)
  assert.deepEqual(ctx.sessionProjections.viewCheckpoint(stale), {})
  const replay = ctx.sessionProjections.restore(stale, events, SessionLogOffset(0), session.header, SessionLogOffset(0))
  assert.deepEqual(replay.snapshot.values.superCodeTasks, {
    tasks: [{ id: 'b', title: 'B', status: 'active' }],
    current: { kind: 'task', id: 'b', title: 'B', goal: 'Build', status: 'active', next: 'Check' },
  })
  const tail = ctx.sessionProjections.restore(replay.checkpoint, events.slice(-1), SessionLogOffset(events.length - 1), session.header, SessionLogOffset(0))
  assert.deepEqual(tail.snapshot.values, replay.snapshot.values)
})

test('durable task writes leave conversation and model messages unchanged, including cold recovery', async t => {
  const ctx = new Context(); new SessionStore(ctx)
  const f = await installTaskMemory(ctx), session = ctx.sessions.create(SessionId('independent-tasks'))
  t.after(() => ctx.fiber.dispose())
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Build' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  ctx.on('session/flush', () => {})
  const messages = session.deriveMessages(), events = session.snapshotEvents(), signal = new AbortController().signal
  const receipt = await f.memory.write(session, signal, () => ({ kind: 'save', task }), { maxContextBytes: 32768, callId: 'save' })
  assert.equal(session.seq, events.length)
  assert.deepEqual(session.deriveMessages(), messages)
  assert.equal(f.table.size, 1)
  assert.equal(f.memory.history(session, receipt.recordId!).change.kind, 'save')
  assert.throws(() => f.memory.history(ctx.sessions.create(SessionId('another')), receipt.recordId!), /Unknown task record/)
  await ctx.fiber.dispose()
  const cold = new Context(); new SessionStore(cold); t.after(() => cold.fiber.dispose())
  const restored = await installTaskMemory(cold, f.root)
  const replay = Session.create(session.id, JSON.parse(JSON.stringify(events)))
  assert.deepEqual(restored.memory.current(replay).tasks.a, task)
  assert.deepEqual(replay.deriveMessages(), messages)
})

test('source failures and cancellation save no task; lost write acknowledgement retries the same record', async t => {
  const ctx = new Context(); new SessionStore(ctx); t.after(() => ctx.fiber.dispose())
  const f = await installTaskMemory(ctx), session = ctx.sessions.create(SessionId('failed-task-write'))
  const controller = new AbortController(), options = { maxContextBytes: 32768, callId: 'save' }
  let failSource = true
  ctx.on('session/flush', () => { if (failSource) throw new Error('Source disk unavailable') })
  await assert.rejects(f.memory.write(session, controller.signal, () => ({ kind: 'save', task }), options), /Source disk unavailable/)
  assert.equal(f.table.size, 0)
  assert.equal(f.memory.isPending(session), false)
  failSource = false; f.failTaskWrite('after')
  await assert.rejects(f.memory.write(session, controller.signal, () => ({ kind: 'save', task }), options), /persistence is unconfirmed/)
  assert.equal(f.table.size, 1)
  const identity = [...f.table.keys()][0]
  controller.abort()
  await assert.rejects(f.memory.read(session, controller.signal), /abort/i)
  assert.equal(f.memory.isPending(session), true)
  f.failTaskWrite()
  assert.equal((await f.memory.read(session, new AbortController().signal)).state.tasks.a?.revision, 1)
  assert.deepEqual([...f.table.keys()], [identity])
  assert.equal(f.memory.isPending(session), false)
  assert.equal(session.seq, 0)
})

test('cold recovery keeps write order when an earlier confirmed write has no successful tool receipt', async t => {
  const ctx = new Context(); new SessionStore(ctx); t.after(() => ctx.fiber.dispose())
  const f = await installTaskMemory(ctx), session = ctx.sessions.create(SessionId('cancelled-task-receipt'))
  ctx.on('session/flush', () => {})
  const signal = new AbortController().signal
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Build' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  await f.memory.write(session, signal, () => ({ kind: 'save', task }), { maxContextBytes: 32768, callId: 'cancelled-save' })
  const callId = ToolCallId('second-save')
  session.append('tool/call', { turn: 2, step: 1, callId, name: 'super_code_task', arguments: '{}' })
  const updated = { ...task, revision: 2, next: 'Latest' }
  const receipt = await f.memory.write(session, signal, () => ({ kind: 'save', task: updated }), { maxContextBytes: 32768, callId })
  session.append('tool/result', { turn: 2, step: 1, message: createToolResultMessage({ callId, isError: false,
    content: [{ type: 'text', text: JSON.stringify({ action: 'update', ...receipt, taskView: taskMemoryView(f.memory.current(session)) }) }],
  }) }, { surfaceOp: 'append' })
  const events = JSON.parse(JSON.stringify(session.snapshotEvents()))
  await ctx.fiber.dispose()
  const cold = new Context(); new SessionStore(cold); t.after(() => cold.fiber.dispose())
  const restored = await installTaskMemory(cold, f.root)
  assert.deepEqual(restored.memory.current(Session.create(session.id, events)).tasks.a, updated)
})

test('forks inherit only referenced task writes and keep later parent, child and grandchild changes separate', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(taskMemoryProjection); t.after(() => ctx.fiber.dispose())
  const f = await installTaskMemory(ctx), parent = ctx.sessions.create(SessionId('task-parent'))
  const signal = new AbortController().signal
  ctx.on('session/flush', () => {})
  const save = async (session: Session, next: string, revision: number, ptc = false) => {
    const callId = ToolCallId(`${session.id}-${revision}`)
    if (!ptc) session.append('tool/call', { turn: 1, step: revision, callId, name: 'super_code_task', arguments: '{}' })
    const receipt = await f.memory.write(session, signal, () => ({ kind: 'save', task: { ...task, revision, next } }), { maxContextBytes: 32768, callId })
    const content = [{ type: 'text' as const, text: JSON.stringify({ action: 'update', ...receipt, taskView: taskMemoryView(f.memory.current(session)) }) }]
    if (ptc) session.append('tool/ptc-dispatch', { rootCallId: callId, parentCallId: callId, subCallId: callId, name: 'super_code_task', arguments: {}, isError: false, content })
    else session.append('tool/result', { turn: 1, step: revision, message: createToolResultMessage({ callId, content, isError: false }) }, { surfaceOp: 'append' })
    return receipt.recordId!
  }
  parent.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Build' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const first = await save(parent, 'parent-one', 1)
  const child = ctx.sessions.fork(parent, undefined, SessionId('task-child'))
  assert.equal(f.memory.current(child).tasks.a?.next, 'parent-one')
  await save(parent, 'parent-two', 2)
  assert.equal(f.memory.current(child).tasks.a?.next, 'parent-one')
  await save(child, 'child-two', 2, true)
  const grandchild = ctx.sessions.fork(child, undefined, SessionId('task-grandchild'))
  assert.equal(f.memory.current(grandchild).tasks.a?.next, 'child-two')
  await save(child, 'child-three', 3, true)
  assert.equal(f.memory.current(grandchild).tasks.a?.next, 'child-two')
  assert.equal(f.memory.current(parent).tasks.a?.next, 'parent-two')
  assert.equal(f.memory.history(child, first).change.kind, 'save')
  assert.equal(ctx.sessionProjections.snapshot(child).values.superCodeTasks?.current.kind, 'task')
})

test('task archive cursors page independently of conversation events and reject unknown history', async t => {
  const ctx = new Context(); new SessionStore(ctx); t.after(() => ctx.fiber.dispose())
  const f = await installTaskMemory(ctx), session = ctx.sessions.create(SessionId('task-archives'))
  ctx.on('session/flush', () => {})
  const signal = new AbortController().signal, options = { maxContextBytes: 32768, callId: 'archive' }
  for (let i = 0; i < 12; i++) {
    const completed = { ...task, id: `task-${i}`, status: 'completed' }
    await f.memory.write(session, signal, () => ({ kind: 'save', task: completed }), options)
    await f.memory.write(session, signal, () => ({ kind: 'archive', task: completed }), options)
  }
  const first = await f.memory.archives(session, signal)
  assert.equal(first.records.length, 10); assert.equal(first.done, false)
  const second = await f.memory.archives(session, signal, undefined, first.nextBeforeRecordId)
  assert.equal(second.records.length, 2); assert.equal(second.done, true)
  assert.equal(new Set([...first.records, ...second.records].map(row => row.recordId)).size, 12)
  await assert.rejects(f.memory.archives(session, signal, undefined, 'unknown'), /Invalid task archive cursor/)
  assert.equal(session.seq, 0)
})
