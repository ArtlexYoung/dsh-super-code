import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { taskFeedbackProjection as projection, foldTaskFeedback as fold } from '../src/task-feedback-projection.js'

const initial = () => projection.init({ cwd: '/project' } as SessionHeader, 0 as SessionLogOffset)
const event = (seq: number, type: string, data: object): SessionEvent => ({ seq, time: seq, type, data }) as SessionEvent
const call = (seq: number, turn: number, step: number, name = 'write') => event(seq, 'tool/call', {
  turn, step, callId: 'reused', name, arguments: JSON.stringify({ file_path: `file-${turn}-${step}.ts` }),
})
const result = (seq: number, turn: number, step: number, modern = true, failed = false) => event(seq, 'tool/result', {
  turn, step, message: modern ? { role: 'tool', toolCallId: 'reused', isError: failed, content: [] }
    : { content: [{ type: 'tool-result', toolCallId: 'reused', isError: failed, content: [] }] },
})

test('tool IDs reused across steps and turns retain each successful file change in both journal layouts', () => {
  for (const modern of [false, true]) {
    let state = initial(), seq = 0
    for (const [turn, step] of [[1, 1], [1, 2], [2, 1]]) {
      state = fold(state, call(seq++, turn!, step!))
      state = fold(state, result(seq++, turn!, step!, modern))
    }
    assert.deepEqual(state.files.map(file => file.path), ['/project/file-1-1.ts', '/project/file-1-2.ts', '/project/file-2-1.ts'])
    assert.deepEqual(state.activities.map(row => row.status), ['succeeded', 'succeeded', 'succeeded'])
    assert.deepEqual(state.pending, [])
  }
})

test('PTC parent and sub-call IDs can repeat without rewriting earlier outcomes', () => {
  for (const withStart of [false, true]) {
    let state = initial(), seq = 0
    for (const turn of [1, 2]) {
      state = fold(state, call(seq++, turn, 1, 'run_code'))
      const nested = { rootCallId: 'reused', parentCallId: 'reused', subCallId: 'reused:ptc:1', name: 'write',
        arguments: { file_path: `nested-${turn}.ts` } }
      if (withStart) state = fold(state, event(seq++, 'tool/ptc-dispatch-start', nested))
      state = fold(state, event(seq++, 'tool/ptc-dispatch', { ...nested, isError: turn === 2 }))
      state = fold(state, result(seq++, turn, 1, true, turn === 2))
    }
    assert.deepEqual(state.files.map(file => file.path), ['/project/nested-1.ts'])
    assert.deepEqual(state.activities.map(row => row.status), ['succeeded', 'succeeded', 'failed', 'failed'])
    assert.equal(state.activities[1]?.parent, 'reused')
    assert.deepEqual(state.pending, [])
  }
})

test('a result cannot settle a reused tool ID from another step', () => {
  let state = fold(initial(), call(0, 1, 1))
  state = fold(state, result(1, 1, 1))
  state = fold(state, call(2, 1, 2))
  const wrong = fold(state, result(3, 1, 1, true, true))
  assert.equal(wrong, state)
  const settled = fold(wrong, result(4, 1, 2))
  assert.deepEqual(settled.activities.map(row => row.status), ['succeeded', 'succeeded'])
  assert.equal(settled.files.length, 2)
})

test('completion status survives the bounded pending-file window without inventing file evidence', () => {
  let state = initial()
  for (let i = 0; i < 65; i++) state = fold(state, event(i, 'tool/call', {
    turn: 1, step: 1, callId: 'parallel-' + i, name: 'write', arguments: '{"file_path":"a.ts"}',
  }))
  assert.equal(state.pending.length, 64)
  state = fold(state, event(65, 'tool/result', { turn: 1, step: 1,
    message: { role: 'tool', toolCallId: 'parallel-0', content: [], isError: false } }))
  assert.equal(state.activities[0]?.status, 'succeeded')
  assert.deepEqual(state.files, [])
})

test('old cached feedback rebuilds reused IDs and current pending identity survives a checkpoint', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(projection)
  const events = [call(0, 1, 1), result(1, 1, 1), call(2, 1, 2)]
  const old = { superCodeFeedback: { ver: 6, seq: 2, val: {} } }
  assert.equal(ctx.sessionProjections.restoreFloor(old), 0)
  const restored = ctx.sessionProjections.restore(old, events, 0 as SessionLogOffset, { cwd: '/project' } as SessionHeader, 0 as SessionLogOffset)
  const cold = ctx.sessionProjections.restore(JSON.parse(JSON.stringify(restored.checkpoint)), [result(3, 1, 2)],
    3 as SessionLogOffset, { cwd: '/project' } as SessionHeader, 0 as SessionLogOffset)
  assert.deepEqual(cold.snapshot.values.superCodeFeedback?.files.map(file => file.path), ['/project/file-1-1.ts', '/project/file-1-2.ts'])
  assert.equal(cold.checkpoint.superCodeFeedback?.ver, projection.stateVersion)
})
