/** Bridge a scoped default to the host's shared PTC provider without rewriting logged tool arguments. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { symbols } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Budgets } from './budgets.js'

interface Request { readonly timeoutMs?: number | null; readonly [key: string]: unknown }
interface Runtime {
  readonly timeout?: { defaultMs: number; maxMs: number }
  resolve(request: Request): Request
}
interface Policy { readonly budgets: Budgets; readonly lifetime: { active: boolean }; readonly execution: object }
const current = new AsyncLocalStorage<Policy | false>()
const bridges = new WeakMap<Runtime, { users: number; original: Runtime['resolve']; wrapped: Runtime['resolve']; descriptor: PropertyDescriptor | undefined }>()

/** One reference-counted adapter per provider, removed when its last scope unloads. */
function retainBridge(service: Runtime): () => void {
  let runtime = service
  while ((runtime as unknown as Record<symbol, Runtime>)[symbols.original]) runtime = (runtime as unknown as Record<symbol, Runtime>)[symbols.original]!
  let bridge = bridges.get(runtime)
  if (!bridge) {
    const original = runtime.resolve
    const wrapped: Runtime['resolve'] = function (this: Runtime, request) {
      const policy = current.getStore()
      // A later provider wrapper may still hold this method after our last scope unloads.
      if (!bridge?.users || !policy || !policy.lifetime.active) return original.call(this, request)
      const budget = policy.budgets
      const limits = this.timeout
      if (!limits) throw new Error('This PTC provider does not support configured elapsed budgets')
      const cap = Math.min(budget.ptcMaxTimeoutMs ?? limits.maxMs, limits.maxMs)
      const timeout = request.timeoutMs ?? budget.ptcTimeoutMs ?? limits.defaultMs
      // Defaults apply only to omitted deadlines; an explicit null is bounded only by a configured ceiling.
      const selected = request.timeoutMs === null
        ? budget.ptcMaxTimeoutMs === undefined ? null : cap
        : Math.min(timeout, cap)
      return original.call(this, { ...request, timeoutMs: selected })
    }
    bridge = { users: 0, original, wrapped, descriptor: Object.getOwnPropertyDescriptor(runtime, 'resolve') }
    runtime.resolve = wrapped
    bridges.set(runtime, bridge)
  }
  bridge.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--bridge.users !== 0) return
    if (runtime.resolve === bridge.wrapped && Object.getOwnPropertyDescriptor(runtime, 'resolve')?.configurable) {
      if (bridge.descriptor) Object.defineProperty(runtime, 'resolve', bridge.descriptor)
      else Reflect.deleteProperty(runtime, 'resolve')
    }
    bridges.delete(runtime)
  }
}

export function applyPtcBudget(ctx: Context, policy: Budgets | ((agent?: Agent) => Budgets)): void {
  if (typeof policy !== 'function' && policy.ptcTimeoutMs === undefined && policy.ptcMaxTimeoutMs === undefined) return
  ctx.inject(['ptcRuntime'], owner => {
    const runtime = owner.get('ptcRuntime') as Runtime
    const lifetime = { active: true }
    const release = retainBridge(runtime)
    owner.effect(() => () => { lifetime.active = false; release() })
    owner.on('tools/execute', (exec, next) => {
      if (!lifetime.active || exec.name !== 'run_code') return next()
      const budgets = typeof policy === 'function' ? policy(exec.agent) : policy
      if (budgets.ptcTimeoutMs === undefined && budgets.ptcMaxTimeoutMs === undefined) {
        // Keep another listener's policy for this execution, but isolate nested calls.
        const inherited = current.getStore()
        return inherited && inherited.execution === exec ? next() : current.run(false, next)
      }
      if (!runtime.timeout) throw new Error('This PTC provider does not support configured elapsed budgets')
      if ((budgets.ptcTimeoutMs ?? 0) > runtime.timeout.maxMs || (budgets.ptcMaxTimeoutMs ?? 0) > runtime.timeout.maxMs) throw new Error('Configured PTC budget exceeds the host provider ceiling')
      return current.run({ budgets, lifetime, execution: exec }, next)
    })
  })
}
