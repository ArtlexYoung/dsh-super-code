import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { taskFeedbackProjection as projection, foldTaskFeedback as fold } from '../src/task-feedback-projection.js'

const header = { cwd: '/project' } as SessionHeader
const initial = () => projection.init(header, 0 as SessionLogOffset)
const event = (seq: number, type: string, data: object): SessionEvent => ({ seq, time: seq, type, data }) as SessionEvent
const user = (seq: number, text: string) => event(seq, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
function prefix(value: string, limit: number): string {
  let result = ''
  for (const point of value.trim()) { if (result.length + point.length > limit) break; result += point }
  return result
}

for (const [field, limit] of [['request', 4000], ['goal', 4000], ['goal-status', 40], ['todo', 800], ['activity', 240]] as const) {
  test(`${field} summary keeps complete Unicode at its ${limit}-unit boundary`, () => {
    for (const point of ['😀', '𠮷']) for (const offset of [-2, -1, 0]) {
      const raw = `  ${'中'.repeat(limit + offset)}${point}末尾  `
      const input = field === 'request' ? user(0, raw)
        : field === 'goal' ? event(0, 'goal/change', { goal: { objective: raw, phase: 'active' } })
        : field === 'goal-status' ? event(0, 'goal/change', { goal: { objective: 'Goal', phase: raw } })
        : field === 'todo' ? event(0, 'todo/write', { todos: [{ content: raw, status: 'pending' }] })
        : event(0, 'tool/call', { turn: 1, step: 1, callId: 'unicode', name: 'bash', arguments: JSON.stringify({ command: raw }) })
      const before = structuredClone(input), state = fold(initial(), input)
      const text = field === 'request' ? state.latestRequest
        : field === 'goal' ? state.goal.kind === 'recorded' ? state.goal.text : ''
        : field === 'goal-status' ? state.goal.kind === 'recorded' ? state.goal.status : ''
        : field === 'todo' ? state.todos[0]!.content : state.activities[0]!.description
      assert.equal(text, prefix(raw, limit))
      assert.ok(text.isWellFormed())
      assert.ok(text.length <= limit)
      assert.deepEqual(input, before, 'display clipping must not alter original journal content')
      assert.doesNotThrow(() => projection.stateSchema.parse(state))
    }
  })
}

test('a v7 checkpoint rebuilds clipped Unicode and preserves history across a current checkpoint', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(projection)
  const raw = '中'.repeat(3999) + '😀尾', events = [user(0, raw)]
  const damaged = { ...fold(initial(), events[0]!), request: raw.slice(0, 4000), latestRequest: raw.slice(0, 4000) }
  const old = { superCodeFeedback: { ver: 7, seq: 0, val: damaged } }
  assert.equal(ctx.sessionProjections.restoreFloor(old), 0)
  const restored = ctx.sessionProjections.restore(old, events, 0 as SessionLogOffset, header, 0 as SessionLogOffset)
  assert.equal(restored.snapshot.values.superCodeFeedback?.latestRequest, prefix(raw, 4000))
  assert.equal(restored.checkpoint.superCodeFeedback?.ver, projection.stateVersion)
  const cold = ctx.sessionProjections.restore(JSON.parse(JSON.stringify(restored.checkpoint)), [user(1, '继续😀')],
    1 as SessionLogOffset, header, 0 as SessionLogOffset)
  assert.equal(cold.snapshot.values.superCodeFeedback?.history[0]?.request, prefix(raw, 4000))
  assert.equal(cold.snapshot.values.superCodeFeedback?.latestRequest, '继续😀')
})
