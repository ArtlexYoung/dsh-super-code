/** Optional Cordis adapter for the pure dsh-super-agent domain services. */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TaskGraph } from '../core/task-graph.js';
import { Dispatcher } from '../core/dispatcher.js';
import { runProgrammingWorkflow } from '../core/programming.js';
import { runConversationWorkflow } from '../core/conversation.js';
import { validateBudget } from '../core/protocol.js';
import { selectModel, summarizeTokens } from '../ui.js';
import { defaultPlanningForProfile, resolveScenarioProfile } from '../core/scenario.js';
import { SUPER_AGENT_SETTINGS_NAMESPACE, SuperAgentSettingsSchema } from '../settings.js';
import { superAgentUsageProjectionDefinition } from '../super-agent-usage.js';
/** Cordis plugin name. */
export const name = 'super-agent';
/** This adapter has no mandatory host service; callers opt into graphs explicitly. */
export const inject = [];
const MAX_TIMER_MS = 2_147_000_000;
/** Schemastery config schema; cross-field checks happen in {@link resolveConfig}. */
export const Config = z.object({
    modelPools: z.any(),
    tokenStats: z.boolean(),
    maxTasks: z.number().step(1),
    maxDepth: z.number().step(1),
    maxConcurrent: z.number().step(1),
    timeoutMs: z.number().step(1),
    stopGraceMs: z.number().step(1),
    maxRepairAttempts: z.number().step(1),
    maxFeedbackChars: z.number().step(1),
    maxInputTokens: z.number().step(1),
    maxOutputTokens: z.number().step(1),
    maxTotalTokens: z.number().step(1),
    maxToolCalls: z.number().step(1),
    planning: z.union([z.const('separate'), z.const('skip'), z.const('auto')]),
    stopOnRepeatedFeedback: z.boolean(),
    executionMode: z.union([z.const('solo'), z.const('team'), z.const('auto')]),
    workScenario: z.union([z.const('delivery'), z.const('research'), z.const('optimization')]),
    optimizationTarget: z.union([z.const('performance'), z.const('quality'), z.const('both')]),
});
function positive(name, value) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`super-agent: ${name} must be a positive safe integer`);
    return value;
}
function nonNegative(name, value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`super-agent: ${name} must be a non-negative safe integer`);
    return value;
}
function timer(name, value) {
    const normalized = nonNegative(name, value);
    if (normalized > MAX_TIMER_MS)
        throw new Error(`super-agent: ${name} must be no greater than ${MAX_TIMER_MS}`);
    return normalized;
}
/** Materialize and validate deployment defaults once at load. */
export function resolveConfig(config = {}) {
    const programmingBudget = validateBudget({
        ...config.maxInputTokens === undefined ? {} : { maxInputTokens: nonNegative('maxInputTokens', config.maxInputTokens) },
        ...config.maxOutputTokens === undefined ? {} : { maxOutputTokens: nonNegative('maxOutputTokens', config.maxOutputTokens) },
        ...config.maxTotalTokens === undefined ? {} : { maxTotalTokens: nonNegative('maxTotalTokens', config.maxTotalTokens) },
        ...config.maxToolCalls === undefined ? {} : { maxToolCalls: nonNegative('maxToolCalls', config.maxToolCalls) },
        timeoutMs: timer('timeoutMs', config.timeoutMs ?? 0),
    });
    const planning = config.planning ?? 'auto';
    if (planning !== 'separate' && planning !== 'skip' && planning !== 'auto')
        throw new Error('super-agent: planning must be separate, skip, or auto');
    const profile = resolveScenarioProfile({
        executionMode: config.executionMode,
        workScenario: config.workScenario,
        optimizationTarget: config.optimizationTarget,
    });
    return {
        modelPools: config.modelPools ?? { high: [], normal: [], low: [] },
        tokenStats: config.tokenStats ?? true,
        maxTasks: positive('maxTasks', config.maxTasks ?? 256),
        maxDepth: positive('maxDepth', config.maxDepth ?? 32),
        maxConcurrent: positive('maxConcurrent', config.maxConcurrent ?? 8),
        timeoutMs: timer('timeoutMs', config.timeoutMs ?? 0),
        stopGraceMs: timer('stopGraceMs', config.stopGraceMs ?? 100),
        maxRepairAttempts: positive('maxRepairAttempts', config.maxRepairAttempts ?? 2),
        maxFeedbackChars: positive('maxFeedbackChars', config.maxFeedbackChars ?? 2_000),
        programmingBudget,
        planning,
        stopOnRepeatedFeedback: config.stopOnRepeatedFeedback ?? true,
        profile,
    };
}
/**
 * Host-plane service that owns optional task graphs. It intentionally does not
 * create agents, run models, or grant tools; those remain Harness capabilities.
 */
export class SuperAgentService extends Service {
    resolved;
    workspaces = new Map();
    closing = false;
    usage = [];
    /**
     * @param ctx - Cordis context receiving `ctx.superAgent`.
     * @param config - deployment limits.
     */
    constructor(ctx, config = {}) {
        super(ctx, 'superAgent');
        this.resolved = resolveConfig(config);
        ctx.inject(['sessionProjections'], (projectionCtx) => {
            projectionCtx.sessionProjections.register(superAgentUsageProjectionDefinition);
        });
        ctx.inject(['settings'], (settingsCtx) => {
            const scope = settingsCtx.settings.register(SUPER_AGENT_SETTINGS_NAMESPACE, SuperAgentSettingsSchema, {
                base: { modelPools: {
                        high: this.resolved.modelPools.high.map(m => ({ id: m.id, ...m.provider === undefined ? {} : { provider: m.provider }, strengths: [...(m.strengths ?? [])], available: m.available !== false })),
                        normal: this.resolved.modelPools.normal.map(m => ({ id: m.id, ...m.provider === undefined ? {} : { provider: m.provider }, strengths: [...(m.strengths ?? [])], available: m.available !== false })),
                        low: this.resolved.modelPools.low.map(m => ({ id: m.id, ...m.provider === undefined ? {} : { provider: m.provider }, strengths: [...(m.strengths ?? [])], available: m.available !== false })),
                    }, tokenStats: this.resolved.tokenStats },
            });
            this.resolved = { ...this.resolved, ...scope.get() };
            scope.watch((next) => { this.resolved = { ...this.resolved, ...next }; });
        });
        ctx.effect(() => () => {
            this.closing = true;
            this.workspaces.clear();
        }, 'super-agent.workspaces()');
    }
    /**
     * Create or return one scope-local workspace. Scope names are explicit and
     * never inferred from ambient agent state.
     * @param scope - caller-selected workspace identity.
     * @param inputs - optional initial task definitions.
     * @returns the owned graph and dispatcher.
     */
    workspace(scope = 'default', inputs = []) {
        if (this.closing)
            throw new Error('super-agent service is disposed');
        if (typeof scope !== 'string' || scope.trim() === '')
            throw new Error('workspace scope must be a non-empty string');
        const key = scope.trim();
        const existing = this.workspaces.get(key);
        if (existing !== undefined) {
            if (inputs.length > 0)
                throw new Error(`workspace ${key} already exists; use its graph to add tasks`);
            return existing;
        }
        const graphOptions = {
            scope: key,
            maxTasks: this.resolved.maxTasks,
            maxDepth: this.resolved.maxDepth,
        };
        const graph = new TaskGraph(inputs, graphOptions);
        const dispatcher = new Dispatcher(graph, {
            maxConcurrent: this.resolved.maxConcurrent,
            timeoutMs: this.resolved.timeoutMs,
            stopGraceMs: this.resolved.stopGraceMs,
        });
        const workspace = { scope: key, graph, dispatcher };
        this.workspaces.set(key, workspace);
        return workspace;
    }
    /** List currently owned workspaces by creation order. */
    listWorkspaces() {
        return [...this.workspaces.keys()];
    }
    /** Resolve a model from configured pools and record provider usage. */
    selectModel(tier, difficulty = 0.5) {
        return selectModel(this.resolved.modelPools, tier, difficulty);
    }
    recordTokenUsage(usage) { if (this.resolved.tokenStats)
        this.usage.push({ ...usage }); }
    tokenSummary() { return summarizeTokens(this.usage); }
    /** Remove one workspace and its in-memory event log. */
    removeWorkspace(scope) {
        const key = scope.trim();
        if (!this.workspaces.delete(key))
            throw new Error(`workspace ${key} does not exist`);
    }
    /**
     * Run the provider-neutral programming loop inside this service scope. The
     * caller supplies model generation and local verification callbacks.
     */
    programmingWorkflow(task, callbacks, options = {}, signal) {
        const mergedBudget = { ...this.resolved.programmingBudget, ...options.budget };
        const profile = resolveScenarioProfile(options.profile ?? this.resolved.profile);
        const planning = options.planning ?? (this.resolved.planning === 'auto' ? defaultPlanningForProfile(profile) : this.resolved.planning);
        const generate = async (context) => {
            const generation = await callbacks.generate(context);
            const usage = generation.usage;
            if (usage !== undefined) {
                const input = usage.inputTokens ?? 0;
                const cached = Math.min(input, usage.cachedTokens ?? 0);
                this.recordTokenUsage({
                    model: context.model === undefined
                        ? 'host-default'
                        : context.model.provider === undefined ? context.model.id : `${context.model.provider}/${context.model.id}`,
                    cacheHit: cached,
                    uncachedInput: Math.max(0, input - cached),
                    cacheRead: cached,
                    output: usage.outputTokens ?? 0,
                });
            }
            return generation;
        };
        return runProgrammingWorkflow(task, { ...callbacks, generate }, {
            ...options,
            maxRepairAttempts: options.maxRepairAttempts ?? this.resolved.maxRepairAttempts,
            maxFeedbackChars: options.maxFeedbackChars ?? this.resolved.maxFeedbackChars,
            planning,
            stopOnRepeatedFeedback: options.stopOnRepeatedFeedback ?? this.resolved.stopOnRepeatedFeedback,
            profile,
            budget: mergedBudget,
            modelSelector: options.modelSelector ?? ((phase, difficulty) => {
                const tier = phase === 'analysis' ? 'high' : 'normal';
                return this.selectModel(tier, difficulty);
            }),
        }, signal);
    }
    /**
     * Run a bounded multi-turn conversation with the configured model pools.
     * Usage from every turn is recorded in the same token projection as coding
     * workflows, while the host retains ownership of transport and tools.
     */
    conversationWorkflow(turns, callbacks, options = {}, signal) {
        const generate = async (context) => {
            const generation = await callbacks.generate(context);
            const usage = generation.usage;
            if (usage !== undefined) {
                const input = usage.inputTokens ?? 0;
                const cached = Math.min(input, usage.cachedTokens ?? 0);
                this.recordTokenUsage({
                    model: context.model === undefined
                        ? 'host-default'
                        : context.model.provider === undefined ? context.model.id : `${context.model.provider}/${context.model.id}`,
                    cacheHit: cached,
                    uncachedInput: Math.max(0, input - cached),
                    cacheRead: cached,
                    output: usage.outputTokens ?? 0,
                });
            }
            return generation;
        };
        const profile = options.profile ?? this.resolved.profile;
        return runConversationWorkflow(turns, { ...callbacks, generate }, {
            ...options,
            profile,
            modelSelector: options.modelSelector ?? ((turn) => {
                const difficulty = turn === 1 ? 0.65 : 0.5;
                const tier = profile.executionMode === 'team' && turn === 1 ? 'high' : profile.workScenario === 'delivery' ? 'low' : 'normal';
                return this.selectModel(tier, difficulty);
            }),
        }, signal);
    }
}
/** Cordis function-plugin entry. */
export function apply(ctx, config = {}) {
    new SuperAgentService(ctx, config);
}
export default apply;
//# sourceMappingURL=index.js.map