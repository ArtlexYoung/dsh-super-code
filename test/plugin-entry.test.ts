import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import harnessPlugin, { TaskGraph } from '../src/index.js'

test('package-root plugin mounts the host service while retaining named domain exports', async () => {
  assert.equal(new TaskGraph([]).all().length, 0)
  const ctx = new Context()
  try {
    await ctx.plugin(harnessPlugin, { maxTasks: 3 })
    assert.deepEqual(ctx.superAgent.listWorkspaces(), [])
    assert.ok(ctx.superAgent.workspace('root-entry'))
    assert.deepEqual(ctx.superAgent.listWorkspaces(), ['root-entry'])
  } finally {
    await ctx.fiber.dispose()
  }
})
