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
const current = new AsyncLocalStorage<Budgets>()
const bridges = new WeakMap<Runtime, { users: number; original: Runtime['resolve']; wrapped: Runtime['resolve'] }>()

/** One reference-counted adapter per provider, removed when its last scope unloads. */
function retainBridge(service: Runtime): () => void {
  let runtime = service
  while ((runtime as unknown as Record<symbol, Runtime>)[symbols.original]) runtime = (runtime as unknown as Record<symbol, Runtime>)[symbols.original]!
  let bridge = bridges.get(runtime)
  if (!bridge) {
    const original = runtime.resolve
    const wrapped: Runtime['resolve'] = function (this: Runtime, request) {
      const budget = current.getStore()
      if (!budget) return original.call(this, request)
      const limits = this.timeout
      if (!limits) throw new Error('This PTC provider does not support configured elapsed budgets')
      const cap = Math.min(budget.ptcMaxTimeoutMs ?? limits.maxMs, limits.maxMs)
      const timeout = request.timeoutMs ?? budget.ptcTimeoutMs ?? limits.defaultMs
      // Explicit no-deadline calls remain no-deadline unless the plugin configured a ceiling.
      const selected = request.timeoutMs === null && budget.ptcMaxTimeoutMs === undefined ? null : Math.min(timeout, cap)
      return original.call(this, { ...request, timeoutMs: selected })
    }
    bridge = { users: 0, original, wrapped }
    runtime.resolve = wrapped
    bridges.set(runtime, bridge)
  }
  bridge.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--bridge.users !== 0) return
    if (runtime.resolve === bridge.wrapped) runtime.resolve = bridge.original
    bridges.delete(runtime)
  }
}

export function applyPtcBudget(ctx: Context, policy: Budgets | ((agent?: Agent) => Budgets)): void {
  if (typeof policy !== 'function' && policy.ptcTimeoutMs === undefined && policy.ptcMaxTimeoutMs === undefined) return
  ctx.inject(['ptcRuntime'], owner => {
    const runtime = owner.get('ptcRuntime') as Runtime
    const release = retainBridge(runtime)
    owner.effect(() => release)
    owner.on('tools/execute', (exec, next) => {
      if (exec.name !== 'run_code') return next()
      const budgets = typeof policy === 'function' ? policy(exec.agent) : policy
      if (budgets.ptcTimeoutMs === undefined && budgets.ptcMaxTimeoutMs === undefined) return next()
      if (!runtime.timeout) throw new Error('This PTC provider does not support configured elapsed budgets')
      if ((budgets.ptcTimeoutMs ?? 0) > runtime.timeout.maxMs || (budgets.ptcMaxTimeoutMs ?? 0) > runtime.timeout.maxMs) throw new Error('Configured PTC budget exceeds the host provider ceiling')
      return current.run(budgets, next)
    })
  })
}
