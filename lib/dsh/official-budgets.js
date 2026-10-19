/** Apply common budgets to existing official engines, scoped to each Agent. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { symbols } from '@deepseek-ai/cordis';
import { configurationOf } from './budgets.js';
import { compactByWindow } from './compaction.js';
import { applyPtcBudget } from './ptc-budget.js';
const current = new AsyncLocalStorage();
const officialPresets = new Set(['standard', 'ptc', 'minimal', 'cordis']);
// Profile plugins can load the same package in separate module graphs. Match the
// public engine contract rather than constructor identity across those graphs.
function isBasicEngine(value) {
    if (!value || typeof value !== 'object')
        return false;
    const engine = value;
    return typeof engine.compactIfNeeded === 'function' && typeof engine.compactRegion === 'function'
        && typeof engine.compactNow === 'function' && !!engine.config && Array.isArray(engine.config.modelPolicies);
}
function restoreOnDispose(ctx, reference, descriptors) {
    ctx.effect(() => () => {
        const target = reference.deref();
        if (!target)
            return;
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (descriptor)
                Object.defineProperty(target, key, descriptor);
            else
                Reflect.deleteProperty(target, key);
        }
    });
}
function mergedConfig(base, budgets) {
    const overrides = Object.fromEntries(Object.entries({ thresholdRatio: budgets.thresholdRatio,
        retainRatio: budgets.retainRatio, maxTokens: budgets.summaryMaxTokens,
        compactionRetries: budgets.compactionRetries, maxOverflowRetries: budgets.maxOverflowRetries,
    }).filter(([, value]) => value !== undefined));
    const merge = (value) => {
        const config = { ...value, ...overrides };
        if (budgets.retainRatio !== undefined)
            delete config.retainTokens;
        return config;
    };
    return { ...merge(base), modelPolicies: base.modelPolicies.map(merge) };
}
function bridge(ctx, engine, select) {
    const base = engine.config;
    const cached = new WeakMap();
    const policy = (agent) => {
        const budgets = select(agent);
        if (!budgets)
            return false;
        let value = cached.get(agent);
        if (!value) {
            value = { engine, budgets, config: mergedConfig(base, budgets) };
            cached.set(agent, value);
        }
        return value;
    };
    const descriptors = Object.fromEntries(['config', 'compactIfNeeded', 'compactRegion', 'compactNow']
        .map(key => [key, Object.getOwnPropertyDescriptor(engine, key)]));
    Object.defineProperty(engine, 'config', { configurable: true, get: () => {
            const active = current.getStore();
            return active && active.engine === engine ? active.config : base;
        } });
    const pressure = engine.compactIfNeeded, region = engine.compactRegion, now = engine.compactNow;
    const run = (agent, action) => {
        const selected = policy(agent);
        return selected ? current.run(selected, () => action(selected.budgets)) : current.run(false, () => action(false));
    };
    engine.compactIfNeeded = (agent, trigger, signal) => run(agent, budgets => budgets && budgets.pressureBasis === 'window' && trigger === 'pressure'
        ? compactByWindow(engine, budgets, agent, signal) : pressure.call(engine, agent, trigger, signal));
    engine.compactRegion = (start, end, agent, signal) => run(agent, () => region.call(engine, start, end, agent, signal));
    engine.compactNow = (agent, signal, command) => run(agent, () => now.call(engine, agent, signal, command));
    // Weak ownership avoids retaining obsolete preset generations for a long conversation.
    restoreOnDispose(ctx, new WeakRef(engine), descriptors);
    return run;
}
export function applyOfficialBudgets(ctx) {
    ctx.inject(['agentPresets'], owner => {
        const registry = owner.get('agentPresets');
        const select = (agent) => {
            if (!agent || !officialPresets.has(registry.composedPreset(agent.ctx) ?? ''))
                return false;
            const config = configurationOf(owner, agent);
            return config.applyToOfficialPresets ? config.budgets ?? {} : false;
        };
        const engines = new WeakMap();
        const install = (agent) => {
            if (!select(agent))
                return false;
            let service = registry.serviceFor(agent, 'compaction');
            while (service && service[symbols.original]) {
                service = service[symbols.original];
            }
            if (!isBasicEngine(service))
                return false;
            let run = engines.get(service);
            if (!run) {
                run = bridge(owner, service, select);
                engines.set(service, run);
            }
            return run;
        };
        owner.on('agent/created', ({ agent }) => { install(agent); });
        // Also covers changing the preset of a blank conversation before its first step.
        owner.on('agent/pre-step', ({ agent }, next) => { install(agent); return next(); }, true);
        // Overflow retry limits are read by the host listener before compactIfNeeded.
        owner.on('agent/request-error', ({ agent }, next) => {
            const run = install(agent);
            return run ? run(agent, () => next()) : current.run(false, () => next());
        }, true);
        applyPtcBudget(owner, agent => select(agent) || {});
    });
}
//# sourceMappingURL=official-budgets.js.map