/** Bridge a scoped default to the host's shared PTC provider without rewriting logged tool arguments. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { symbols } from '@deepseek-ai/cordis';
const current = new AsyncLocalStorage();
const bridges = new WeakMap();
/** One reference-counted adapter per provider, removed when its last scope unloads. */
function retainBridge(service) {
    let runtime = service;
    while (runtime[symbols.original])
        runtime = runtime[symbols.original];
    let bridge = bridges.get(runtime);
    if (!bridge) {
        const original = runtime.resolve;
        const wrapped = function (request) {
            const budget = current.getStore();
            if (!budget)
                return original.call(this, request);
            const limits = this.timeout;
            if (!limits)
                throw new Error('This PTC provider does not support configured elapsed budgets');
            const cap = Math.min(budget.ptcMaxTimeoutMs ?? limits.maxMs, limits.maxMs);
            const timeout = request.timeoutMs ?? budget.ptcTimeoutMs ?? limits.defaultMs;
            // Explicit no-deadline calls remain no-deadline unless the plugin configured a ceiling.
            const selected = request.timeoutMs === null && budget.ptcMaxTimeoutMs === undefined ? null : Math.min(timeout, cap);
            return original.call(this, { ...request, timeoutMs: selected });
        };
        bridge = { users: 0, original, wrapped };
        runtime.resolve = wrapped;
        bridges.set(runtime, bridge);
    }
    bridge.users++;
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        if (--bridge.users !== 0)
            return;
        if (runtime.resolve === bridge.wrapped)
            runtime.resolve = bridge.original;
        bridges.delete(runtime);
    };
}
export function applyPtcBudget(ctx, policy) {
    if (typeof policy !== 'function' && policy.ptcTimeoutMs === undefined && policy.ptcMaxTimeoutMs === undefined)
        return;
    ctx.inject(['ptcRuntime'], owner => {
        const runtime = owner.get('ptcRuntime');
        const release = retainBridge(runtime);
        owner.effect(() => release);
        owner.on('tools/execute', (exec, next) => {
            if (exec.name !== 'run_code')
                return next();
            const budgets = typeof policy === 'function' ? policy(exec.agent) : policy;
            if (budgets.ptcTimeoutMs === undefined && budgets.ptcMaxTimeoutMs === undefined)
                return next();
            if (!runtime.timeout)
                throw new Error('This PTC provider does not support configured elapsed budgets');
            if ((budgets.ptcTimeoutMs ?? 0) > runtime.timeout.maxMs || (budgets.ptcMaxTimeoutMs ?? 0) > runtime.timeout.maxMs)
                throw new Error('Configured PTC budget exceeds the host provider ceiling');
            return current.run(budgets, next);
        });
    });
}
//# sourceMappingURL=ptc-budget.js.map