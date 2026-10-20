import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, LlmAdapter, createSystemMessage, createUserMessage, createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import Projection from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { AgentBudgetCompaction, BudgetCompactionEngine, compactableRange } from '../src/dsh/compaction.js'
import { configurationOf, validateConfiguration } from '../src/dsh/budgets.js'
import type { Configuration } from '../src/dsh/budgets.js'
import { applyOfficialBudgets } from '../src/dsh/official-budgets.js'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { applyPtcBudget } from '../src/dsh/ptc-budget.js'
import { applyBudgetSettings } from '../src/dsh/budget-settings.js'

test('budget validation rejects invalid and contradictory overrides without adding defaults', () => {
  assert.deepEqual(validateConfiguration({}), {})
  for (const budgets of [{ thresholdRatio: NaN }, { summaryMaxTokens: -1 }, { retainRatio: 0.9 },
    { ptcTimeoutMs: 500, ptcMaxTimeoutMs: 100 }, { compactionRetries: 1.5 }, { unknown: true }]) {
    assert.throws(() => validateConfiguration({ budgets }))
  }
})

class Adapter extends LlmAdapter {
  calls: number[] = []
  fail = false
  async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 100_000 }, defaultMaxTokens: 38_400 }
  }
  async *stream(options: any) {
    this.calls.push(options.maxTokens)
    options.signal?.throwIfAborted()
    if (this.fail) throw new Error('summary fixture failure')
    yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
    yield { type: 'text-delta' as const, index: 0, text: 'Keep the accepted decision and pending work.' }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
}

function conversation(chars: number) {
  const session = Session.create(SessionId(`budget-${Math.random()}`))
  const text = 'x'.repeat(chars)
  for (let turn = 1; turn <= 32; turn++) {
    session.append('turn/start', { turn })
    if (turn === 1) session.append('system/message', { turn, step: 1, message: createSystemMessage('SYSTEM PREFIX', 'fixture') }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `user ${turn} ${text}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) session.append('request/header', { header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 38_400 } }, reason: 'initial' })
    const callId = ToolCallId(`call-${turn}`)
    session.append('assistant/message', { stream: [], turn, step: 1, message: createMessage({ role: 'assistant', content: [{ type: 'text', text }, { type: 'tool-call', id: callId, name: 'echo', arguments: '{}' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, callId, name: 'echo', arguments: '{}' })
    session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: 33 })
  return session
}

test('window policy preserves legacy pressure, retention and summary cap using host transactions', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Projection)
  new TokenMeter(ctx)
  const hostDefault = new BasicCompactionEngine(ctx.isolate('compaction'), { auto: false })
  const unchanged = new BudgetCompactionEngine(ctx.isolate('compaction'))
  assert.deepEqual(unchanged.config, { ...hostDefault.config, auto: true })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const engine = new BudgetCompactionEngine(ctx.isolate('compaction'), { pressureBasis: 'window', thresholdRatio: 0.8, retainRatio: 0.16, summaryMaxTokens: 8192 })
  const priced = (target: number) => {
    const base = ctx.tokenMeter.measure(conversation(100)).totalTokens
    const increment = ctx.tokenMeter.measure(conversation(200)).totalTokens - base
    return conversation(Math.round(100 + (target - base) * 100 / increment))
  }
  const signal = new AbortController().signal
  const owner = (session: Session) => ({ session, options: { provider: 'fixture', model: 'fixture' } }) as Agent
  const below = priced(79_900)
  assert.equal(await engine.compactIfNeeded(owner(below), 'pressure', signal), null)
  assert.equal(adapter.calls.length, 0)
  const above = priced(85_000)
  const result = await engine.compactIfNeeded(owner(above), 'pressure', signal)
  assert.ok(result)
  assert.equal(adapter.calls.at(-1), 8192)
  assert.deepEqual(above.deriveMessages().filter(m => m.content.some(b => b.type === 'text' && b.text.startsWith('user ')))
    .map(m => (m.content[0] as { text: string }).text.split(' ')[1]), ['27', '28', '29', '30', '31', '32'])
  const retained = ctx.tokenMeter.measure(above).surfaceTokens
  assert.ok(retained >= 16_000 && retained < 20_000)
  assert.equal(above.deriveMessages()[0]?.content[0]?.type, 'text')
  const failed = priced(85_000), nodes = [...failed.surface.nodes]
  adapter.fail = true
  await assert.rejects(engine.compactIfNeeded(owner(failed), 'pressure', signal), /summary fixture failure/)
  assert.deepEqual([...failed.surface.nodes], nodes)
  adapter.fail = false
  assert.ok(await engine.compactIfNeeded(owner(failed), 'pressure', signal))
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(engine.compactIfNeeded(owner(priced(85_000)), 'pressure', aborted.signal), /abort/i)
  const empty = Session.create(SessionId('empty'))
  assert.deepEqual(compactableRange(empty, ctx.tokenMeter.measure(empty), 100), { kind: 'none' })
  const noRoute = Session.create(SessionId('no-route'))
  assert.equal(await engine.compactIfNeeded(owner(noRoute), 'pressure', signal), null)
  const incompatible = ctx.tokenMeter.measure(above)
  assert.throws(() => compactableRange(above, { ...incompatible, nodes: [] }, 100), /surface/)
  const auto = priced(85_000), before = adapter.calls.length
  await agentEvents(engine['ctx'], owner(auto)).waterfall('agent/pre-step', { messages: [], turn: 33, step: 1, signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(adapter.calls.length, before + 1)
})

test('PTC policy isolates concurrent scopes, preserves explicit deadlines and restores the provider', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const runtime = { timeout: { defaultMs: 120, maxMs: 600 }, resolve: (request: any) => ({ timeoutMs: request.timeoutMs ?? 120 }) }
  const original = runtime.resolve
  ctx.provide('ptcRuntime', runtime)
  const a = {} as Agent, b = {} as Agent
  const sa = createScope(ctx, a), sb = createScope(ctx, b)
  await sa.ctx.plugin({ apply(owner: Context) { applyPtcBudget(owner, { ptcTimeoutMs: 600, ptcMaxTimeoutMs: 600 }) } })
  await sb.ctx.plugin({ apply(owner: Context) { applyPtcBudget(owner, { ptcTimeoutMs: 300, ptcMaxTimeoutMs: 400 }) } })
  const call = (agent?: Agent, args = {}) => ctx.waterfall(scopeTarget({}, agent), 'tools/execute', { agent, name: 'run_code' } as any, async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return { isError: false as const, value: runtime.resolve(args), content: [] }
  })
  const values = await Promise.all([call(a), call(b), call(), call(a, { timeoutMs: 50 }), call(b, { timeoutMs: 500 })])
  assert.deepEqual(values.map(r => r.value), [{ timeoutMs: 600 }, { timeoutMs: 300 }, { timeoutMs: 120 }, { timeoutMs: 50 }, { timeoutMs: 400 }])
  await sa.dispose()
  assert.deepEqual((await call(b)).value, { timeoutMs: 300 })
  await sb.dispose()
  assert.equal(runtime.resolve, original)
})

test('an unconfigured plugin applies legacy compaction and elapsed budgets to a real Agent', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Projection)
  ctx.provide('sessions', { flush: async () => true })
  new TokenMeter(ctx)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const runtime = { timeout: { defaultMs: 120000, maxMs: 600000 }, resolve: (request: any) => ({ timeoutMs: request.timeoutMs ?? 120000 }) }
  ctx.provide('ptcRuntime', runtime)
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, {}) } })
  const agent = { session: conversation(5000), options: { provider: 'fixture', model: 'fixture' } } as Agent
  const scope = createScope(ctx, agent)
  await scope.ctx.plugin({ apply(owner: Context) {
    applyPtcBudget(owner, callingAgent => configurationOf(owner, callingAgent).budgets ?? {})
  } })
  const router = new AgentBudgetCompaction(ctx.isolate('compaction'))
  const engine = await router.forAgent(agent)
  assert.equal(engine.config.maxTokens, 8192)
  assert.equal(engine.config.thresholdRatio, 0.8)
  assert.equal(engine.config.retainRatio, 0.16)
  assert.ok(await router.compactIfNeeded(agent, 'pressure', new AbortController().signal))
  assert.equal(adapter.calls.at(-1), 8192)
  const execute = (request = {}) => ctx.waterfall(scopeTarget({}, agent), 'tools/execute', { agent, name: 'run_code' } as any,
    async () => ({ isError: false, content: [], value: runtime.resolve(request) }))
  assert.equal((await execute()).value.timeoutMs, 600000)
  assert.equal((await execute({ timeoutMs: 5000 })).value.timeoutMs, 5000)
})

test('a retained preset creates independent host compaction engines for concurrent Agents', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Projection)
  ctx.provide('sessions', { flush: async () => true })
  new TokenMeter(ctx)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  let summaryMaxTokens = 2048
  ctx.provide('superCodeConfiguration', { forAgent: () => ({ budgets: { pressureBasis: 'window', summaryMaxTokens } }), get: () => ({}) })
  const router = new AgentBudgetCompaction(ctx.isolate('compaction'))
  const a = { session: conversation(5000), options: { provider: 'fixture', model: 'fixture' } } as Agent
  const b = { session: conversation(5000), options: { provider: 'fixture', model: 'fixture' } } as Agent
  const first = await router.forAgent(a)
  summaryMaxTokens = 4096
  const second = await router.forAgent(b)
  assert.notEqual(first, second)
  assert.equal(first.config.maxTokens, 2048)
  assert.equal(second.config.maxTokens, 4096)
  await Promise.all([a, b].map(agent => router.compactIfNeeded(agent, 'pressure', new AbortController().signal)))
  assert.deepEqual(adapter.calls.toSorted(), [2048, 4096])
  assert.equal(await router.forAgent(a), first)
})

test('a retained PTC listener resolves the calling Agent budget at execution time', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const runtime = { timeout: { defaultMs: 120, maxMs: 600 }, resolve: (request: any) => ({ timeoutMs: request.timeoutMs ?? 120 }) }
  ctx.provide('ptcRuntime', runtime)
  const values = new WeakMap<Agent, { ptcTimeoutMs: number }>()
  await ctx.plugin({ apply(owner: Context) { applyPtcBudget(owner, agent => agent ? values.get(agent) ?? {} : {}) } })
  const a = {} as Agent, b = {} as Agent
  values.set(a, { ptcTimeoutMs: 300 }); values.set(b, { ptcTimeoutMs: 500 })
  const call = (agent?: Agent) => ctx.waterfall(scopeTarget({}, agent), 'tools/execute', { name: 'run_code', agent } as any,
    async () => ({ isError: false, content: [], value: runtime.resolve({}) }))
  const results = await Promise.all([call(a), call(b), call()])
  assert.deepEqual(results.map(r => r.value), [{ timeoutMs: 300 }, { timeoutMs: 500 }, { timeoutMs: 120 }])
})

test('the first pressure check preserves host failure recovery while an Agent engine is starting', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Projection)
  ctx.provide('sessions', { flush: async () => true })
  new TokenMeter(ctx)
  const adapter = new Adapter()
  adapter.fail = true
  ctx.llm.registerAdapter(['fixture'], adapter)
  ctx.provide('superCodeConfiguration', { forAgent: () => ({ budgets: { pressureBasis: 'window' } }), get: () => ({}) })
  const owner = ctx.isolate('compaction')
  new AgentBudgetCompaction(owner)
  const session = conversation(5000), nodes = [...session.surface.nodes]
  const agent = { session, options: { provider: 'fixture', model: 'fixture' } } as Agent
  const result = await agentEvents(owner, agent).waterfall('agent/pre-step',
    { messages: [], turn: 33, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(result.kind, 'enter')
  assert.ok(adapter.calls.length > 0)
  assert.deepEqual([...session.surface.nodes], nodes)
})

async function officialFixture(t: test.TestContext, foreignModule = false) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Projection)
  ctx.provide('sessions', { flush: async () => true })
  new TokenMeter(ctx)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const Engine = foreignModule
    ? (await import(import.meta.resolve('@deepseek-ai/dsh-compaction-basic') + '?foreign-module')).BasicCompactionEngine
    : BasicCompactionEngine
  const engine: BasicCompactionEngine = new Engine(ctx.isolate('compaction'))
  const nativeConfig = engine.config, original = engine.compactIfNeeded
  const presets = new WeakMap<Context, string>(), snapshots = new WeakMap<Agent, Configuration>()
  let config: Configuration = {}
  ctx.provide('superCodeConfiguration', { get: () => config, forAgent: (agent: Agent) => {
    if (!snapshots.has(agent)) snapshots.set(agent, structuredClone(config))
    return snapshots.get(agent)!
  } })
  ctx.provide('agentPresets', { composedPreset: (scope: Context) => presets.get(scope), serviceFor: () => engine })
  const runtime = { timeout: { defaultMs: 120, maxMs: 600 }, resolve: (request: any) => ({ timeoutMs: request.timeoutMs ?? 120 }) }
  const originalResolve = runtime.resolve
  ctx.provide('ptcRuntime', runtime)
  const fiber = await ctx.plugin({ apply: applyOfficialBudgets })
  await ctx.inject(['agentPresets', 'ptcRuntime'], () => {})
  const agent = (preset: string, configuration: Configuration) => {
    config = configuration
    const value = { session: conversation(5000), options: { provider: 'fixture', model: 'fixture' } } as Agent
    Object.assign(value, { runMaintenance: (work: (signal: AbortSignal) => Promise<unknown>) => work(new AbortController().signal) })
    const scope = createScope(ctx, value)
    Object.assign(value, { ctx: scope.ctx })
    presets.set(scope.ctx, preset)
    // Snapshot is normally supplied by applyBudgetSettings on this same event.
    snapshots.set(value, structuredClone(config))
    ctx.emit(scopeTarget(value, value), 'agent/created', { agent: value })
    return value
  }
  const deadline = (agent: Agent) => ctx.waterfall(scopeTarget({}, agent), 'tools/execute', { name: 'run_code', agent } as any, async () => {
    await new Promise(resolve => setTimeout(resolve, 2))
    return { isError: false, content: [], value: runtime.resolve({}) }
  })
  return { ctx, engine, adapter, nativeConfig, original, originalResolve, runtime, fiber, agent, deadline }
}

test('official budgets are opt-in for all four presets and leave custom and Super Code policies alone', async t => {
  const f = await officialFixture(t)
  const off = f.agent('standard', { budgets: { summaryMaxTokens: 2048, ptcTimeoutMs: 500 } })
  assert.equal(f.engine.compactIfNeeded, f.original)
  assert.equal((await f.deadline(off)).value.timeoutMs, 120)
  const limits: Configuration = { applyToOfficialPresets: true, maxTasks: 1, maxContextBytes: 1024,
    budgets: { pressureBasis: 'window', summaryMaxTokens: 2048, ptcTimeoutMs: 500 } }
  for (const preset of ['standard', 'ptc', 'minimal', 'cordis']) {
    const agent = f.agent(preset, limits)
    const result = await f.engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    assert.ok(result)
    assert.equal(f.adapter.calls.at(-1), 2048)
    assert.equal((await f.deadline(agent)).value.timeoutMs, 500)
    assert.deepEqual(f.engine.config, f.nativeConfig, 'shared engine config is not mutated')
  }
  for (const preset of ['custom', 'super-code']) {
    assert.equal((await f.deadline(f.agent(preset, limits))).value.timeoutMs, 120)
  }
  assert.equal((await f.deadline(off)).value.timeoutMs, 120, 'the earlier disabled Agent remains disabled')
})

test('official shared engines isolate concurrent snapshots, manual compaction and unload cleanly', async t => {
  const f = await officialFixture(t)
  const make = (summaryMaxTokens: number, ptcTimeoutMs: number) => f.agent('ptc', { applyToOfficialPresets: true,
    budgets: { pressureBasis: 'window', summaryMaxTokens, ptcTimeoutMs } })
  const a = make(2048, 300), b = make(4096, 500)
  const off = f.agent('ptc', { applyToOfficialPresets: false, budgets: { summaryMaxTokens: 1024, ptcTimeoutMs: 200 } })
  const results = await Promise.all([a, b, off].map(agent => f.deadline(agent)))
  assert.deepEqual(results.map(r => r.value.timeoutMs), [300, 500, 120])
  for (const agent of [a, b]) agent.session.append('turn/end', { turn: 33, reason: { kind: 'completed' } })
  await Promise.all([a, b].map(agent => f.engine.compactNow(agent, new AbortController().signal)))
  assert.deepEqual(f.adapter.calls.toSorted(), [2048, 4096])
  assert.equal((await f.deadline(a)).value.timeoutMs, 300)
  assert.deepEqual(f.engine.config, f.nativeConfig)
  await f.fiber.dispose()
  assert.equal(f.engine.compactIfNeeded, f.original)
  assert.equal(f.runtime.resolve, f.originalResolve)
  assert.deepEqual(f.engine.config, f.nativeConfig)
})

test('official overflow retry limits are read in the calling Agent policy before compaction', async t => {
  const f = await officialFixture(t)
  const zero = f.agent('standard', { applyToOfficialPresets: true, budgets: { maxOverflowRetries: 0 } })
  const one = f.agent('standard', { applyToOfficialPresets: true, budgets: { maxOverflowRetries: 1, summaryMaxTokens: 2048 } })
  const overflow = (agent: Agent) => agentEvents(f.ctx, agent).waterfall('agent/request-error', {
    failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE }, signal: new AbortController().signal,
  } as any, async () => ({ kind: 'throw' as const }))
  assert.deepEqual(await overflow(zero), { kind: 'throw' })
  assert.equal(f.adapter.calls.length, 0)
  assert.deepEqual(await overflow(one), { kind: 'retry' })
  assert.equal(f.adapter.calls.at(-1), 2048)
  assert.deepEqual(await overflow(one), { kind: 'throw' })
})

test('official budgets work when the host loads a separate instance of the same engine package', async t => {
  const f = await officialFixture(t, true)
  assert.equal(f.engine instanceof BasicCompactionEngine, false)
  const agent = f.agent('standard', { applyToOfficialPresets: true, budgets: { pressureBasis: 'window', summaryMaxTokens: 2048 } })
  assert.ok(await f.engine.compactIfNeeded(agent, 'pressure', new AbortController().signal))
  assert.equal(f.adapter.calls.at(-1), 2048)
})
