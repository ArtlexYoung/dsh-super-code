import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SUPER_CODE_INSTRUCTIONS } from '../src/core/teams.js'
import { batchSafety, classifyMemoryAction, classifyTaskAction } from '../src/core/batch-policy.js'
import superCodePlugin from '../src/dsh/super-code.js'

const root = fileURLToPath(new URL('..', import.meta.url))

test('batch preset uses the host PTC presentation and keeps the scheduler host-owned', async () => {
  const preset = await readFile(join(root, 'presets/super-code/agent.cordis.yml'), 'utf8')
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  for (const text of [preset, patch]) {
    assert.match(text, /name: '@deepseek-ai\/dsh-agent-tool-presentation'/)
    assert.match(text, /mode: ptc/)
  }
  assert.match(SUPER_CODE_INSTRUCTIONS, /one run_code program/)
  assert.match(SUPER_CODE_INSTRUCTIONS, /never replay successes, writes, tests or unknown side effects/)
  assert.match(SUPER_CODE_INSTRUCTIONS, /permissions, cancellation, result links and partial failures/)
})

test('batch policy keeps only proven reads parallel and fails closed for new actions', () => {
  for (const action of ['list', 'read', 'delegate', 'validate_member', 'source', 'history', 'archives', 'evidence']) {
    assert.equal(classifyTaskAction(action), 'read', action)
    assert.equal(batchSafety(classifyTaskAction(action)), 'parallel', action)
  }
  for (const action of ['create', 'update', 'focus', 'archive', 'restore']) {
    assert.equal(classifyTaskAction(action), 'write', action)
    assert.equal(batchSafety(classifyTaskAction(action)), 'exclusive', action)
  }
  for (const action of ['topics', 'read']) {
    assert.equal(classifyMemoryAction(action), 'read', `memory:${action}`)
    assert.equal(batchSafety(classifyMemoryAction(action)), 'parallel', `memory:${action}`)
  }
  for (const action of ['remember', 'forget']) {
    assert.equal(classifyMemoryAction(action), 'write', `memory:${action}`)
    assert.equal(batchSafety(classifyMemoryAction(action)), 'exclusive', `memory:${action}`)
  }
  for (const [classify, action] of [[classifyTaskAction, 'new_action'], [classifyMemoryAction, 'test_record']] as const) {
    assert.equal(classify(action), action.startsWith('test') ? 'test' : 'unknown')
    assert.equal(batchSafety(classify(action)), 'exclusive')
  }
})

test('installed tools expose the same fail-closed policy to the host scheduler', async t => {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  // The mode collapse rejects model-direct calls before classification. Native
  // mode lets this test inspect the same classifier the PTC scheduler invokes
  // for nested SDK dispatches.
  new ToolRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  const agent = {} as Agent
  const scope = createScope(ctx, agent)
  const fiber = scope.ctx.plugin(superCodePlugin)
  await fiber.inertia
  t.after(async () => { await scope.dispose(); await ctx.fiber.dispose() })
  Object.assign(agent, { id: 'batch-policy-test', session: ctx.sessions.create(SessionId('batch-policy-test')), ctx: scope.ctx })
  const mode = (name: string, action: string) => ctx.tools.executionMode({ name, arguments: { action }, agent })
  for (const action of ['list', 'read', 'archives', 'evidence']) assert.deepEqual(mode('super_code_task', action), { kind: 'parallel' })
  for (const action of ['create', 'update', 'restore', 'invented']) assert.deepEqual(mode('super_code_task', action), { kind: 'exclusive' })
  for (const action of ['topics', 'read']) assert.deepEqual(mode('super_code_memory', action), { kind: 'parallel' })
  for (const action of ['remember', 'forget', 'invented']) assert.deepEqual(mode('super_code_memory', action), { kind: 'exclusive' })
  assert.deepEqual(mode('missing-tool', 'read'), { kind: 'exclusive' })
})
