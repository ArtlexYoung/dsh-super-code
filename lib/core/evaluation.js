import { ProtocolError } from './protocol.js';
function rate(value, field) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new ProtocolError(`${field} must be between 0 and 1`, 'INVALID_ARGUMENT');
    return value;
}
function nonNegative(value, field) {
    if (!Number.isFinite(value) || value < 0)
        throw new ProtocolError(`${field} must be non-negative`, 'INVALID_ARGUMENT');
    return value;
}
/** Apply the release criteria without coupling them to a dataset or runner. */
export function evaluateReleaseGate(baseline, candidate, thresholds = {}) {
    const base = { successRate: rate(baseline.successRate, 'baseline.successRate'), totalTokens: nonNegative(baseline.totalTokens, 'baseline.totalTokens'), latencyMs: nonNegative(baseline.latencyMs, 'baseline.latencyMs') };
    const next = { successRate: rate(candidate.successRate, 'candidate.successRate'), totalTokens: nonNegative(candidate.totalTokens, 'candidate.totalTokens'), latencyMs: nonNegative(candidate.latencyMs, 'candidate.latencyMs') };
    const resolved = { minAccuracyUplift: thresholds.minAccuracyUplift ?? 0.1, minTokenReduction: thresholds.minTokenReduction ?? 0.1, minLatencyReduction: thresholds.minLatencyReduction ?? 0 };
    if (!Number.isFinite(resolved.minAccuracyUplift) || resolved.minAccuracyUplift < 0 || !Number.isFinite(resolved.minTokenReduction) || resolved.minTokenReduction < 0 || !Number.isFinite(resolved.minLatencyReduction))
        throw new ProtocolError('evaluation thresholds must be finite and non-negative', 'INVALID_ARGUMENT');
    const delta = { successRate: next.successRate - base.successRate, totalTokens: next.totalTokens - base.totalTokens, latencyMs: next.latencyMs - base.latencyMs };
    const reduction = { totalTokens: base.totalTokens > 0 ? (base.totalTokens - next.totalTokens) / base.totalTokens : null, latency: base.latencyMs > 0 ? (base.latencyMs - next.latencyMs) / base.latencyMs : null };
    const checks = { accuracyUplift: delta.successRate >= resolved.minAccuracyUplift, tokenReduction: reduction.totalTokens !== null && reduction.totalTokens >= resolved.minTokenReduction, latencyReduction: reduction.latency !== null && reduction.latency >= resolved.minLatencyReduction };
    return { delta, reduction, thresholds: resolved, checks, accepted: Object.values(checks).every(Boolean) };
}
export default evaluateReleaseGate;
//# sourceMappingURL=evaluation.js.map