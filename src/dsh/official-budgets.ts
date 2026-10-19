/** Apply common budgets to existing official engines, scoped to each Agent. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { symbols } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { configurationOf } from './budgets.js'
import type { Budgets } from './budgets.js'
import { compactByWindow } from './compaction.js'
import { applyPtcBudget } from './ptc-budget.js'

interface Registry {
  composedPreset(ctx: Context): string | undefined
  serviceFor(agent: Agent, name: string): unknown
}
type EngineConfig = BasicCompactionEngine['config']
interface Policy { readonly engine: BasicCompactionEngine; readonly config: EngineConfig; readonly budgets: Budgets }
const current = new AsyncLocalStorage<Policy | false>()
const officialPresets = new Set(['standard', 'ptc', 'minimal', 'cordis'])
type RunPolicy = <T>(agent: Agent, action: (budgets: Budgets | false) => T) => T

// Profile plugins can load the same package in separate module graphs. Match the
// public engine contract rather than constructor identity across those graphs.
function isBasicEngine(value: unknown): value is BasicCompactionEngine {
  if (!value || typeof value !== 'object') return false
  const engine = value as BasicCompactionEngine
  return typeof engine.compactIfNeeded === 'function' && typeof engine.compactRegion === 'function'
    && typeof engine.compactNow === 'function' && !!engine.config && Array.isArray(engine.config.modelPolicies)
}

function restoreOnDispose(ctx: Context, reference: WeakRef<BasicCompactionEngine>, descriptors: Record<string, PropertyDescriptor | undefined>): void {
  ctx.effect(() => () => {
    const target = reference.deref()
    if (!target) return
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else Reflect.deleteProperty(target, key)
    }
  })
}

function mergedConfig(base: EngineConfig, budgets: Budgets): EngineConfig {
  const overrides = Object.fromEntries(Object.entries({ thresholdRatio: budgets.thresholdRatio,
    retainRatio: budgets.retainRatio, maxTokens: budgets.summaryMaxTokens,
    compactionRetries: budgets.compactionRetries, maxOverflowRetries: budgets.maxOverflowRetries,
  }).filter(([, value]) => value !== undefined))
  const merge = (value: object) => {
    const config = { ...value, ...overrides } as Record<string, unknown>
    if (budgets.retainRatio !== undefined) delete config.retainTokens
    return config
  }
  return { ...merge(base), modelPolicies: base.modelPolicies.map(merge) } as unknown as EngineConfig
}

function bridge(ctx: Context, engine: BasicCompactionEngine, select: (agent: Agent) => Budgets | false): RunPolicy {
  const base = engine.config
  const cached = new WeakMap<Agent, Policy>()
  const policy = (agent: Agent): Policy | false => {
    const budgets = select(agent)
    if (!budgets) return false
    let value = cached.get(agent)
    if (!value) { value = { engine, budgets, config: mergedConfig(base, budgets) }; cached.set(agent, value) }
    return value
  }
  const descriptors = Object.fromEntries(['config', 'compactIfNeeded', 'compactRegion', 'compactNow']
    .map(key => [key, Object.getOwnPropertyDescriptor(engine, key)]))
  Object.defineProperty(engine, 'config', { configurable: true, get: () => {
    const active = current.getStore()
    return active && active.engine === engine ? active.config : base
  } })
  const pressure = engine.compactIfNeeded, region = engine.compactRegion, now = engine.compactNow
  const run: RunPolicy = (agent, action) => {
    const selected = policy(agent)
    return selected ? current.run(selected, () => action(selected.budgets)) : current.run(false, () => action(false))
  }
  engine.compactIfNeeded = (agent, trigger, signal) => run(agent, budgets => budgets && budgets.pressureBasis === 'window' && trigger === 'pressure'
    ? compactByWindow(engine, budgets, agent, signal) : pressure.call(engine, agent, trigger, signal))
  engine.compactRegion = (start, end, agent, signal) => run(agent, () => region.call(engine, start, end, agent, signal))
  engine.compactNow = (agent, signal, command) => run(agent, () => now.call(engine, agent, signal, command))
  // Weak ownership avoids retaining obsolete preset generations for a long conversation.
  restoreOnDispose(ctx, new WeakRef(engine), descriptors)
  return run
}

export function applyOfficialBudgets(ctx: Context): void {
  ctx.inject(['agentPresets'], owner => {
    const registry = owner.get('agentPresets') as Registry
    const select = (agent?: Agent): Budgets | false => {
      if (!agent || !officialPresets.has(registry.composedPreset(agent.ctx) ?? '')) return false
      const config = configurationOf(owner, agent)
      return config.applyToOfficialPresets ? config.budgets ?? {} : false
    }
    const engines = new WeakMap<BasicCompactionEngine, RunPolicy>()
    const install = (agent: Agent): RunPolicy | false => {
      if (!select(agent)) return false
      let service = registry.serviceFor(agent, 'compaction') as BasicCompactionEngine | undefined
      while (service && (service as unknown as Record<symbol, BasicCompactionEngine>)[symbols.original]) {
        service = (service as unknown as Record<symbol, BasicCompactionEngine>)[symbols.original]
      }
      if (!isBasicEngine(service)) return false
      let run = engines.get(service)
      if (!run) { run = bridge(owner, service, select); engines.set(service, run) }
      return run
    }
    owner.on('agent/created', ({ agent }) => { install(agent) })
    // Also covers changing the preset of a blank conversation before its first step.
    owner.on('agent/pre-step', ({ agent }, next) => { install(agent); return next() }, true)
    // Overflow retry limits are read by the host listener before compactIfNeeded.
    owner.on('agent/request-error', ({ agent }, next) => {
      const run = install(agent)
      return run ? run(agent, () => next()) : current.run(false, () => next())
    }, true)
    applyPtcBudget(owner, agent => select(agent) || {})
  })
}
