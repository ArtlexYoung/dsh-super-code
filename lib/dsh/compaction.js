import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { CompactionEngine, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction';
import { createScope } from '@deepseek-ai/dsh-scope';
import { budgetSchema, configurationOf, validateConfiguration } from './budgets.js';
export const name = 'super-code-compaction';
export const inject = ['llm', 'tokenMeter', 'sessions'];
export const Config = budgetSchema;
/** Preserve the system head and extend the retained tail to a balanced tool boundary. */
export function compactableRange(session, measurement, retainTokens) {
    const nodes = session.surface.nodes;
    if (!nodes.length)
        return { kind: 'none' };
    if (nodes.length !== measurement.nodes.length || nodes.some((seq, index) => seq !== measurement.nodes[index]?.seq))
        throw new Error('Compression measurement does not match the current surface');
    const first = session.eventAt(nodes[0])?.type === 'system/message' ? 1 : 0;
    let tokens = 0, keep = nodes.length;
    for (let index = nodes.length - 1; index >= 0; index--) {
        tokens += measurement.nodes[index].tokens;
        keep = index;
        if (tokens >= retainTokens)
            break;
    }
    while (keep > first && !toolPairingBalancedBefore(session, nodes[keep]))
        keep--;
    return keep <= first ? { kind: 'none' } : { start: nodes[first], end: nodes[keep - 1] };
}
export class BudgetCompactionEngine extends BasicCompactionEngine {
    budgets;
    constructor(ctx, budgets = {}) {
        validateConfiguration({ budgets });
        super(ctx, {
            thresholdRatio: budgets.thresholdRatio,
            retainRatio: budgets.retainRatio,
            maxTokens: budgets.summaryMaxTokens,
            compactionRetries: budgets.compactionRetries,
            maxOverflowRetries: budgets.maxOverflowRetries,
        });
        this.budgets = budgets;
    }
    async compactIfNeeded(agent, trigger, signal) {
        if (this.budgets.pressureBasis !== 'window' || trigger !== 'pressure')
            return super.compactIfNeeded(agent, trigger, signal);
        return compactByWindow(this, this.budgets, agent, signal);
    }
}
/** Share the window policy with an official engine without replacing its transaction or listeners. */
export async function compactByWindow(engine, budgets, agent, signal) {
    const ctx = engine['ctx'];
    signal.throwIfAborted();
    const config = agent.session.requestHeader()?.config;
    if (!config?.provider || !config.model)
        return null;
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal);
    const window = info.context?.contextWindow;
    if (!Number.isSafeInteger(window) || !window || window < 1)
        throw new Error('Compression requires the routed model context window');
    const threshold = Math.floor(window * (budgets.thresholdRatio ?? engine.config.thresholdRatio));
    const retain = Math.floor(window * (budgets.retainRatio ?? engine.config.retainRatio ?? 0.16));
    let measurement = ctx.tokenMeter.measure(agent.session);
    if (measurement.totalTokens < threshold)
        return null;
    const pruner = ctx.get('toolResultPruner');
    if (pruner) {
        pruner.pruneSession(agent.session);
        measurement = ctx.tokenMeter.measure(agent.session);
    }
    if (measurement.totalTokens < threshold)
        return null;
    let result = null;
    for (let attempt = 0; attempt <= (budgets.compactionRetries ?? engine.config.compactionRetries); attempt++) {
        signal.throwIfAborted();
        const range = compactableRange(agent.session, measurement, retain);
        if ('kind' in range)
            return result;
        result = await engine.compactRegion(range.start, range.end, agent, signal);
        measurement = ctx.tokenMeter.measure(agent.session);
        if (measurement.totalTokens < threshold)
            return result;
    }
    throw new Error('Compression remains above the configured window threshold after its retry budget');
}
/** Retained preset generations share this router, while each Agent owns its host engine. */
export class AgentBudgetCompaction extends CompactionEngine {
    overrides;
    engines = new WeakMap();
    constructor(ctx, overrides = {}) {
        super(ctx);
        this.overrides = overrides;
        validateConfiguration({ budgets: overrides });
        ctx.on('agent/created', async ({ agent }) => { await this.forAgent(agent); });
        ctx.on('agent/disposed', async ({ agent }) => {
            const entry = this.engines.get(agent);
            this.engines.delete(agent);
            await entry?.dispose();
        });
        // Older creation events do not await listeners; finish setup before the first pressure check.
        ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
            const ready = this.engines.get(agent)?.ready;
            const engine = await this.forAgent(agent);
            if (!ready && !signal.aborted) {
                try {
                    await engine.compactIfNeeded(agent, 'pressure', signal);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`);
                }
            }
            return next();
        });
    }
    forAgent(agent) {
        let entry = this.engines.get(agent);
        if (!entry) {
            const scope = createScope(this.ctx, agent);
            const budgets = { ...configurationOf(this.ctx, agent).budgets, ...this.overrides };
            const fiber = scope.ctx.isolate('compaction').plugin({ inject, apply(owner) { new BudgetCompactionEngine(owner, budgets); } });
            const created = {
                ready: false, dispose: scope.dispose,
                engine: fiber.await().then(() => {
                    const engine = fiber.ctx.get('compaction');
                    if (!engine)
                        throw new Error('Agent compression engine did not become available');
                    created.ready = true;
                    return engine;
                }).catch(async (error) => { await scope.dispose(); throw error; }),
            };
            entry = created;
            this.engines.set(agent, entry);
        }
        return entry.engine;
    }
    async compactIfNeeded(agent, trigger, signal) {
        return (await this.forAgent(agent)).compactIfNeeded(agent, trigger, signal);
    }
    async compactRegion(start, end, agent, signal) {
        return (await this.forAgent(agent)).compactRegion(start, end, agent, signal);
    }
    async compactNow(agent, signal, sourceCommandId) {
        return (await this.forAgent(agent)).compactNow(agent, signal, sourceCommandId);
    }
}
export function apply(ctx, config = {}) {
    new AgentBudgetCompaction(ctx, config);
}
//# sourceMappingURL=compaction.js.map