import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import harnessPlugin from '../../src/index.js'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

test('a failed usage projection does not remove task and feedback projections or configuration', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SessionStore(ctx)
  const projections = new SessionProjectionRegistry(ctx)
  const register = projections.register.bind(projections)
  projections.register = ((definition: Parameters<typeof register>[0]) => {
    if ((definition.key as string) === 'superAgentUsage') throw new Error('unsupported usage projection')
    return register(definition)
  }) as typeof projections.register
  await ctx.plugin(harnessPlugin)
  const session = ctx.sessions.create(SessionId('isolated-projection'))
  assert.ok(ctx.get('superCodeConfiguration'))
  assert.ok(projections.stateOf(session, 'superCodeTasks'))
  assert.ok(projections.stateOf(session, 'superCodeFeedback'))
  assert.ok(projections.stateOf(session, 'superCodeMemoryUsage'))
})

test('task storage becomes available while the independent long-memory domain is still opening', async t => {
  const ctx = new Context(), gate = Promise.withResolvers<void>(), taskOpened = Promise.withResolvers<void>()
  t.after(async () => { gate.resolve(); await ctx.fiber.dispose() })
  new SessionStore(ctx)
  ctx.provide('storageDomain', { open: async (spec: { name: string }) => {
    if (spec.name === 'super_code_tasks') taskOpened.resolve()
    else await gate.promise
    return { table: () => new Map(), close: async () => {} }
  } } as never)
  const plugin = ctx.plugin(harnessPlugin)
  await Promise.race([taskOpened.promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('task storage waited for long memory')), 2000)
    timer.unref()
  })])
  gate.resolve(); await plugin
  assert.ok(ctx.get('superCodeTaskMemory'))
  assert.ok(ctx.get('superCodeLongMemory'))
})

test('strict command protection fails closed after initialization failure and recovers on plugin restart', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SessionStore(ctx)
  const prompt = new (await import('@deepseek-ai/dsh-system-prompt')).SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  const section = prompt.section.bind(prompt)
  prompt.section = ((value: any) => {
    if (value.name === 'super-code:deletion-protection') throw new Error('Prompt registration unavailable')
    return section(value)
  }) as typeof prompt.section
  const plugin = ctx.plugin(harnessPlugin, { deletionProtection: 'strict' })
  await plugin
  const agent = { id: 'protected', session: ctx.sessions.create(SessionId('protected')) } as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  let executions = 0
  for (const name of ['super_code_task', 'bash']) scope.ctx.get('tools')!.register(defineTool({
    name, description: name, parameters: { command: { type: 'string' } },
    output: { schema: { type: 'string' }, render: () => [] }, execute: async () => { executions++; return 'done' },
  }))
  const call = (command: string) => ctx.tools.execute({ agent, name: 'bash', arguments: { command },
    callId: ToolCallId('isolated-guard'), signal: new AbortController().signal })
  assert.equal((await call('echo ready')).isError, true)
  assert.equal(executions, 0)
  prompt.section = section
  await plugin.restart()
  for (let attempt = 0; attempt < 100 && !executions; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    await call('echo ready')
  }
  assert.equal(executions, 1)
  assert.equal((await call('rm -rf important')).isError, true)
  assert.equal(executions, 1)
  await plugin.dispose()
  assert.equal((await call('echo ready')).isError, false)
  assert.equal(executions, 2)
})

test('thirty plugin load and unload cycles release domains, projections and event subscriptions', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SessionStore(ctx)
  const projections = new SessionProjectionRegistry(ctx)
  const session = ctx.sessions.create(SessionId('lifecycle'))
  let opened = 0, closed = 0, live = 0
  ctx.provide('storageDomain', { open: async () => {
    opened++; live++
    return { table: () => new Map(), close: async () => { closed++; live-- } }
  } } as never)
  await new Promise(resolve => setImmediate(resolve))
  const listeners = () => Object.values(ctx.events._hooks).reduce((count, hooks) => count + hooks.length, 0)
  const before = listeners()
  for (let cycle = 1; cycle <= 30; cycle++) {
    const plugin = ctx.plugin(harnessPlugin)
    await plugin
    assert.equal(live, 2)
    assert.ok(projections.snapshot(session).values.superCodeFeedback)
    assert.ok(ctx.get('superCodeConfiguration'))
    await plugin.dispose()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(live, 0, `domain leak after cycle ${cycle}`)
    assert.equal(opened, cycle * 2)
    assert.equal(closed, opened)
    assert.equal(ctx.get('superCodeConfiguration'), undefined)
    assert.equal(ctx.get('superCodeLongMemory'), undefined)
    assert.equal(ctx.get('superCodeTaskMemory'), undefined)
    assert.deepEqual(projections.snapshot(session).values, {})
    assert.equal(listeners(), before, `event subscription leak after cycle ${cycle}`)
  }
})
