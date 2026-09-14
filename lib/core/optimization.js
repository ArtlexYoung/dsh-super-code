import { ProtocolError, compareMetrics, stableStringify } from './protocol.js';
function text(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
    return value.trim();
}
function metric(value, field) {
    if (!value || typeof value !== 'object')
        throw new ProtocolError(`${field} must be an object`, 'INVALID_METRIC');
    if (!['real', 'mock', 'replay'].includes(value.mode))
        throw new ProtocolError(`${field}.mode is invalid`, 'INVALID_METRIC');
    for (const key of ['score', 'inputTokens', 'outputTokens', 'latencyMs', 'toolCalls']) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)
            throw new ProtocolError(`${field}.${key} must be non-negative and finite`, 'INVALID_METRIC');
    }
    return { ...value };
}
/**
 * Decide whether a candidate should continue, stop, branch, or remain
 * inconclusive. A real candidate can be accepted only when it passes the same
 * score/token gate used by {@link compareMetrics}; mock/replay is evidence for
 * debugging and never a release signal. `quality` uses score as its objective,
 * `performance` requires a non-lower score plus an improvement in latency,
 * tokens, or tool calls, and `both` preserves the legacy score-plus-token gate.
 * Set `minimumScoreDelta` when a quality experiment must improve by a strict
 * amount rather than merely avoid regression.
 */
export function decideOptimization(baseline, candidate, options = {}) {
    const base = metric(baseline, 'baseline');
    const target = options.target ?? 'both';
    if (!['performance', 'quality', 'both'].includes(target))
        throw new ProtocolError('target must be performance, quality, or both', 'INVALID_ARGUMENT');
    text(options.workloadId ?? base.workloadId ?? 'workload', 'workloadId');
    if (candidate === undefined)
        return { decision: 'continue', notes: ['candidate measurement is not available'] };
    const next = metric(candidate, 'candidate');
    if (base.workloadId !== undefined && next.workloadId !== undefined && base.workloadId !== next.workloadId)
        throw new ProtocolError('baseline and candidate workloadId must match', 'METRIC_MISMATCH');
    if (options.changedFactor === undefined || options.changedFactor.trim() === '')
        return { decision: 'inconclusive', notes: ['changedFactor is required to attribute a candidate'] };
    if (options.rollbackRef === undefined || options.rollbackRef.trim() === '')
        return { decision: 'inconclusive', notes: ['rollbackRef is required for a reversible experiment'] };
    if (base.mode !== 'real' || next.mode !== 'real')
        return { decision: 'inconclusive', notes: ['real measurements are required for optimization release decisions'] };
    const comparison = compareMetrics(base, next);
    const minimumScoreDelta = options.minimumScoreDelta ?? 0;
    if (!Number.isFinite(minimumScoreDelta))
        throw new ProtocolError('minimumScoreDelta must be finite', 'INVALID_ARGUMENT');
    const requireTokenReduction = options.requireTokenReduction ?? (target === 'both');
    const qualityPass = comparison.scoreDelta >= minimumScoreDelta;
    if ((target === 'quality' || target === 'both') && !qualityPass)
        return { decision: 'rejected', comparison, notes: ['candidate score did not meet the minimum delta'] };
    if (target === 'performance' && comparison.scoreDelta < 0)
        return { decision: 'rejected', comparison, notes: ['candidate quality score is lower than baseline'] };
    const tokenPass = !requireTokenReduction || comparison.totalTokensDelta < 0;
    const efficiencyPass = comparison.totalTokensDelta < 0 || comparison.latencyDelta < 0 || comparison.toolCallsDelta < 0;
    if (!tokenPass)
        return { decision: target === 'quality' ? 'continue' : 'branch', comparison, notes: ['candidate did not reduce token cost'] };
    if (target === 'performance' && !efficiencyPass)
        return { decision: 'branch', comparison, notes: ['candidate did not reduce latency, token, or tool-call cost'] };
    if (target === 'quality')
        return { decision: 'stop', comparison, notes: ['candidate satisfies the quality gate'] };
    if (target === 'performance')
        return { decision: 'stop', comparison, notes: ['candidate preserves quality and improves token or latency cost'] };
    if (comparison.accepted)
        return { decision: 'stop', comparison, notes: ['candidate satisfies the quality and token gate'] };
    return { decision: 'continue', comparison, notes: ['candidate needs another controlled experiment'] };
}
/** In-memory baseline/candidate ledger with one changed factor per experiment. */
export class OptimizationLedger {
    experiments = new Map();
    /** Record one experiment and derive its decision. */
    record(input) {
        const experimentId = text(input.experimentId, 'experimentId');
        if (this.experiments.has(experimentId))
            throw new ProtocolError(`experiment ${experimentId} already exists`, 'EXPERIMENT_DUPLICATE');
        const baseline = metric(input.baseline, 'baseline');
        const candidate = input.candidate === undefined ? undefined : metric(input.candidate, 'candidate');
        const decision = decideOptimization(baseline, candidate, {
            changedFactor: input.changedFactor,
            workloadId: input.workloadId,
            rollbackRef: input.rollbackRef,
            minimumScoreDelta: input.minimumScoreDelta,
            requireTokenReduction: input.requireTokenReduction,
            target: input.target,
        });
        const record = {
            experimentId,
            hypothesis: text(input.hypothesis, 'hypothesis'),
            baseline,
            ...candidate === undefined ? {} : { candidate },
            ...input.changedFactor === undefined ? {} : { changedFactor: text(input.changedFactor, 'changedFactor') },
            workloadId: text(input.workloadId, 'workloadId'),
            ...input.rollbackRef === undefined ? {} : { rollbackRef: text(input.rollbackRef, 'rollbackRef') },
            decision: decision.decision,
            target: input.target ?? 'both',
            ...decision.comparison === undefined ? {} : { comparison: decision.comparison },
            notes: decision.notes,
        };
        this.experiments.set(experimentId, record);
        return { ...record, notes: [...record.notes] };
    }
    /** Produce a report and identify the best accepted candidate. */
    report(maxChars = 4_000) {
        if (!Number.isSafeInteger(maxChars) || maxChars < 1)
            throw new ProtocolError('maxChars must be a positive safe integer', 'INVALID_ARGUMENT');
        const experiments = [...this.experiments.values()].map(record => ({ ...record, notes: [...record.notes] }));
        const ranked = experiments.filter(record => record.decision === 'stop' && record.comparison !== undefined).sort((left, right) => (right.comparison?.scoreDelta ?? -Infinity) - (left.comparison?.scoreDelta ?? -Infinity));
        const best = ranked[0];
        const next = best === undefined
            ? experiments.some(record => record.decision === 'continue')
                ? 'continue'
                : experiments.length === 0
                    ? 'inconclusive'
                    : 'branch'
            : 'stop';
        const summary = stableStringify({ next, experiments, best: best?.experimentId ?? null });
        return { experiments, ...best === undefined ? {} : { best }, next, summary: summary.length <= maxChars ? summary : `${summary.slice(0, maxChars - 1)}…` };
    }
    /** Return JSON objects suitable for task evidence records. */
    evidence() {
        return [...this.experiments.values()].map(record => ({
            evidenceId: `experiment-${record.experimentId}`,
            kind: 'metric',
            summary: `${record.hypothesis}: ${record.decision}`,
            ref: record.rollbackRef ?? record.experimentId,
        }));
    }
}
export default OptimizationLedger;
//# sourceMappingURL=optimization.js.map