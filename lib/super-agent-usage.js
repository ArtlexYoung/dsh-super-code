/**
 * Host-side durable token accounting for super-agent conversations.
 *
 * Harness's generic `tokenUsage` projection intentionally exposes only an
 * aggregate. This projection keeps the same disjoint buckets while retaining
 * the provider/model route, so the browser can explain which model consumed
 * the current session's tokens without scanning or replaying the log.
 */
import { z } from 'zod';
const bucketsSchema = z.object({
    uncachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
}).strict();
const modelSchema = bucketsSchema.extend({ provider: z.string(), model: z.string() }).strict();
const projectionSchema = z.object({
    totals: bucketsSchema,
    models: z.record(z.string(), modelSchema),
}).strict();
const stateSchema = z.object({
    totals: z.record(z.string(), modelSchema),
    last: z.object({
        turn: z.number().int().nonnegative(),
        step: z.number().int().nonnegative(),
        key: z.string(),
        buckets: bucketsSchema,
    }).nullable(),
    route: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
}).strict();
const zero = () => ({
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
});
const fromUsage = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});
const sameBuckets = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
function modelKey(provider, model) {
    return `${provider}/${model}`;
}
function addModel(totals, key, provider, model, delta) {
    const previous = totals[key];
    const next = {
        provider,
        model,
        uncachedInputTokens: (previous?.uncachedInputTokens ?? 0) + delta.uncachedInputTokens,
        outputTokens: (previous?.outputTokens ?? 0) + delta.outputTokens,
        cacheReadTokens: (previous?.cacheReadTokens ?? 0) + delta.cacheReadTokens,
        cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + delta.cacheWriteTokens,
    };
    // A replacement can only subtract a sample that was previously added. The
    // guard keeps malformed/foreign events from creating negative durable data.
    if (next.uncachedInputTokens < 0 || next.outputTokens < 0 || next.cacheReadTokens < 0 || next.cacheWriteTokens < 0) {
        return totals;
    }
    return { ...totals, [key]: next };
}
function delta(left, right) {
    return {
        uncachedInputTokens: left.uncachedInputTokens - right.uncachedInputTokens,
        outputTokens: left.outputTokens - right.outputTokens,
        cacheReadTokens: left.cacheReadTokens - right.cacheReadTokens,
        cacheWriteTokens: left.cacheWriteTokens - right.cacheWriteTokens,
    };
}
function sourceOf(event) {
    const source = event.data.message.source;
    // Old or third-party adapters may omit one route field. Preserve their
    // billed usage under an explicit bucket instead of silently dropping it.
    const provider = source.kind === 'model' && source.provider.trim() !== '' ? source.provider.trim() : 'unknown';
    const model = source.kind === 'model' && source.model.trim() !== '' ? source.model.trim() : 'unknown';
    return { provider, model };
}
function routeOf(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const candidate = value;
    if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string')
        return undefined;
    const provider = candidate.provider.trim();
    const model = candidate.model.trim();
    return provider !== '' && model !== '' ? { provider, model } : undefined;
}
/** Read the final usage chunk without importing the optional newer stream helper. */
function streamUsageOf(stream) {
    if (!Array.isArray(stream))
        return undefined;
    for (let index = stream.length - 1; index >= 0; index -= 1) {
        const chunk = stream[index];
        if (typeof chunk !== 'object' || chunk === null)
            continue;
        const candidate = chunk;
        const payload = candidate.chunk ?? candidate;
        if (typeof payload !== 'object' || payload === null)
            continue;
        const usage = payload.type === 'usage'
            ? payload.usage
            : candidate.type === 'usage' ? candidate.usage : undefined;
        if (typeof usage !== 'object' || usage === null)
            continue;
        const value = usage;
        if (typeof value.inputTokens === 'number' && typeof value.outputTokens === 'number')
            return value;
    }
    return undefined;
}
function isAttemptEvent(event) {
    return event.type === 'assistant/attempt';
}
function usageOf(event) {
    if (event.type === 'assistant/message') {
        return event.data.usage ?? streamUsageOf(event.data.stream);
    }
    if (isAttemptEvent(event))
        return streamUsageOf(event.data.stream);
    return undefined;
}
function eventRoute(event, fallback) {
    if (event.type === 'assistant/message')
        return sourceOf(event);
    if (event.type === 'request/context')
        return routeOf(event.data);
    if (event.type === 'request/header')
        return routeOf(event.data.header?.config);
    return fallback;
}
function totalsOf(models) {
    const result = zero();
    for (const model of Object.values(models)) {
        result.uncachedInputTokens += model.uncachedInputTokens;
        result.outputTokens += model.outputTokens;
        result.cacheReadTokens += model.cacheReadTokens;
        result.cacheWriteTokens += model.cacheWriteTokens;
    }
    return result;
}
/** Durable per-model projection; retries replace the same step's sample. */
export const superAgentUsageProjectionDefinition = {
    key: 'superAgentUsage',
    stateVersion: 1,
    stateSchema,
    init: (_header, _inheritedEventCount) => ({ totals: {}, last: null }),
    apply: (state, event) => {
        // Retry boundaries end the replacement slot. The event is supplied by the
        // optional retry package, so use a string guard to keep this plugin usable
        // with Harness profiles that do not compose that package's type merge.
        if (event.type === 'llm/retry-started') {
            const data = event.data;
            return state.last !== null
                && state.last.turn === data?.turn
                && state.last.step === data?.step
                ? { ...state, last: null }
                : state;
        }
        const route = eventRoute(event, state.route);
        if (event.type === 'request/context' || event.type === 'request/header') {
            if (route === undefined)
                return state;
            if (state.route?.provider === route.provider && state.route.model === route.model)
                return state;
            return { ...state, route };
        }
        if (event.type !== 'assistant/message' && !isAttemptEvent(event))
            return state;
        const usage = usageOf(event);
        if (usage === undefined)
            return state;
        const source = event.type === 'assistant/message'
            ? sourceOf(event)
            : route ?? { provider: 'unknown', model: 'unknown' };
        const buckets = fromUsage(usage);
        const key = modelKey(source.provider, source.model);
        const coordinates = event.type === 'assistant/message'
            ? event.data
            : event.data;
        if (state.last !== null && state.last.turn === coordinates.turn && state.last.step === coordinates.step
            && state.last.key === key && sameBuckets(state.last.buckets, buckets))
            return state;
        let totals = state.totals;
        if (state.last !== null && state.last.turn === coordinates.turn && state.last.step === coordinates.step) {
            const previous = totals[state.last.key];
            if (previous !== undefined) {
                totals = addModel(totals, state.last.key, previous.provider, previous.model, delta(zero(), state.last.buckets));
            }
        }
        totals = addModel(totals, key, source.provider, source.model, buckets);
        return { ...state, totals, last: { turn: coordinates.turn, step: coordinates.step, key, buckets } };
    },
    wire: {
        viewSchema: projectionSchema,
        view: state => ({ totals: totalsOf(state.totals), models: state.totals }),
    },
};
//# sourceMappingURL=super-agent-usage.js.map