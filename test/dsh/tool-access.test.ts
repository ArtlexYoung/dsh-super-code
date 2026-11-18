import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf, bindScopeParent } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { builtinToolProfiles } from '../../src/dsh/tool-profiles.js'
import { installToolRuntime, toolRuntime, registerManagedTool } from '../../src/dsh/tool-access.js'
import type { ToolRegistration } from '../../src/dsh/tool-access.js'
import { ToolSelections } from '../../src/dsh/tool-runtime.js'

test('preset runtime stays scoped without publishing a host service and preserves the host activation condition', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  let registration!: ToolRegistration, hostEnabled = false, hostChecks = 0
  ctx.provide('tools', { resolve() {}, register(_definition: ToolDefinition, options: ToolRegistration) { registration = options; return () => {} } } as any)
  const preset = createScope(ctx, {}), other = createScope(ctx, {})
  let profile = structuredClone(builtinToolProfiles[0]!)
  const runtime = new ToolSelections(() => profile, () => {})
  installToolRuntime(preset.ctx, runtime)
  const agent = { id: 'test' } as Agent
  createScope(ctx, agent); bindScopeParent(agent, scopeOf(preset.ctx)); runtime.add(agent)
  assert.equal(toolRuntime(preset.ctx), runtime)
  assert.equal(toolRuntime(ctx, agent), runtime)
  assert.equal(toolRuntime(other.ctx), undefined)
  registerManagedTool(preset.ctx, { name: 'ask_user_question' } as ToolDefinition,
    { when: () => { hostChecks++; return hostEnabled } })
  const context = { agent, signal: new AbortController().signal }
  assert.equal(await registration.when!(context), false)
  hostEnabled = true
  assert.equal(await registration.when!(context), true)
  profile = structuredClone(builtinToolProfiles[2]!)
  const second = { id: 'disabled' } as Agent
  createScope(ctx, second); bindScopeParent(second, scopeOf(preset.ctx)); runtime.add(second)
  assert.equal(await registration.when!({ ...context, agent: second }), false)
  assert.equal(hostChecks, 2, 'profile rejection must not bypass or invoke the host condition')
  await preset.ctx.fiber.dispose()
  assert.equal(toolRuntime(ctx, agent), undefined)
})
