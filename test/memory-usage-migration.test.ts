import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { foldMemoryUsage, memoryUsageProjection } from '../src/memory-usage-projection.js'

const overview = { topic: 'build', revision: 1, entries: [{ id: 'check', summary: 'Check the build' }], details: { tool: 'super_code_memory' } }
const initial = () => ({ rows: [], pending: [], omitted: 0, inherited: 0 })
const snapshot = (source: object): SessionEvent => ({ seq: 0, time: 1, type: 'user/message', data: {
  role: 'user', source, content: [{ type: 'text', text: JSON.stringify(overview) }],
} }) as SessionEvent

test('memory attribution survives v4 producer migration without accepting unrelated plugin text', () => {
  const legacy = foldMemoryUsage(initial(), snapshot({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }))
  assert.equal(legacy.rows.length, 1)
  for (const source of [{ kind: 'runtime-context' }, { kind: 'plugin:@deepseek-ai/dsh-system-prompt' }]) {
    assert.deepEqual(foldMemoryUsage(initial(), snapshot(source)), legacy)
  }
  for (const kind of ['user', 'plugin:other', 'plugin:plugin:@deepseek-ai/dsh-system-prompt', 'plugin:@deepseek-ai/dsh-system-prompt-other']) {
    assert.deepEqual(foldMemoryUsage(initial(), snapshot({ kind })).rows, [])
  }
  const global = snapshot({ kind: 'plugin:@deepseek-ai/dsh-system-prompt' })
  global.data.content = [{ type: 'text', text: `Lower priority than the current user request, conversation and project memory: ${JSON.stringify({ ...overview, topic: 'preferences' })}` }]
  assert.equal(foldMemoryUsage(initial(), global).rows[0]?.scope, 'global')
})

test('cold replay rebuilds memory attribution omitted by old v4 checkpoints', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  t.after(() => ctx.fiber.dispose())
  ctx.sessionProjections.register(memoryUsageProjection)
  const session = ctx.sessions.create(SessionId('memory-migration'))
  const events = [snapshot({ kind: 'plugin:@deepseek-ai/dsh-system-prompt' })]
  const checkpoint = { superCodeMemoryUsage: { ver: 2, seq: 0 as SessionSeqCursor, val: initial() } }
  assert.equal(ctx.sessionProjections.restoreFloor(checkpoint), 0)
  const replay = ctx.sessionProjections.restore(checkpoint, events, SessionLogOffset(0), session.header, SessionLogOffset(0))
  assert.equal(replay.snapshot.values.superCodeMemoryUsage?.rows[0]?.id, 'check')
  const tail = ctx.sessionProjections.restore(replay.checkpoint, [], SessionLogOffset(1), session.header, SessionLogOffset(0))
  assert.deepEqual(tail.snapshot.values, replay.snapshot.values)
})
