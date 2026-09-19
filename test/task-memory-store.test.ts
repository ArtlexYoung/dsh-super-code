import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
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
