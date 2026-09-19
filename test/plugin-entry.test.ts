import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import harnessPlugin from '../src/index.js'

test('package-root mounts durable projections without an alternative executor', async () => {
  const ctx = new Context()
  try {
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    await ctx.plugin(harnessPlugin)
    const session = ctx.sessions.create(SessionId('plugin-entry'))
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superCodeTasks')?.tasks, {})
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superAgentUsage')?.totals, {})
    assert.equal(Reflect.has(ctx, 'superAgent'), false)
  } finally { await ctx.fiber.dispose() }
})
