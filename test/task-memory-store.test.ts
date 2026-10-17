import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { TaskMemoryStore } from '../src/task-memory-store.js'
import { taskMemoryProjection, taskMemoryView } from '../src/task-memory-projection.js'
import { taskMemorySchema } from '../src/core/task-memory.js'
import { scanSessionPage } from '../src/core/session-scan.js'

const task = taskMemorySchema.parse({ id: 'a', title: 'A', team: 'develop', depth: 'complex', workspace: '/w', sourceVersion: 'v', goal: 'Build',
  createdAtSeq: 0, source: { seq: 0, quote: 'private source' }, requirements: [], acceptance: ['pass'], decisions: [],
  evidence: [], next: 'Check', status: 'active', revision: 1, requirementsRevision: 1, delegationRevision: 1 })

test('read barriers retain a confirmed snapshot and independent scans do not block writes', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(taskMemoryProjection)
  t.after(() => ctx.fiber.dispose())
  const memory = new TaskMemoryStore(ctx, 32768), session = ctx.sessions.create(SessionId('memory-store'))
  const signal = new AbortController().signal
  const flushEntered = Promise.withResolvers<void>(), finishFlush = Promise.withResolvers<void>()
  ctx.on('session/flush', async () => { flushEntered.resolve(); await finishFlush.promise })
  const write = memory.write(session, signal, () => ({ kind: 'save', task }))
  await flushEntered.promise
  let readFinished = false
  const read = memory.read(session, signal).then(value => { readFinished = true; return value })
  await Promise.resolve()
  assert.equal(memory.isPending(session), true)
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
  })
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
