import type { MetricSnapshot, MetricComparison, JsonObject } from './protocol.js';
import type { OptimizationTarget } from './scenario.js';
/** Lifecycle decision for one optimization candidate. */
export type OptimizationDecision = 'continue' | 'stop' | 'branch' | 'rejected' | 'inconclusive';
/** Baseline/candidate pair with the context needed for reproducibility. */
export interface ExperimentRecord {
    readonly experimentId: string;
    readonly hypothesis: string;
    readonly baseline: MetricSnapshot;
    readonly candidate?: MetricSnapshot;
    readonly changedFactor?: string;
    readonly workloadId: string;
    readonly rollbackRef?: string;
    readonly decision: OptimizationDecision;
    /** Whether this experiment targets speed/cost, quality, or both. */
    readonly target: OptimizationTarget;
    readonly comparison?: MetricComparison;
    readonly notes: readonly string[];
}
/** Optimization ledger report. */
export interface OptimizationReport {
    readonly experiments: readonly ExperimentRecord[];
    readonly best?: ExperimentRecord;
    readonly next: OptimizationDecision;
    readonly summary: string;
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
export declare function decideOptimization(baseline: MetricSnapshot, candidate: MetricSnapshot | undefined, options?: {
    readonly changedFactor?: string;
    readonly workloadId?: string;
    readonly rollbackRef?: string;
    readonly minimumScoreDelta?: number;
    readonly requireTokenReduction?: boolean;
    readonly target?: OptimizationTarget;
}): {
    readonly decision: OptimizationDecision;
    readonly comparison?: MetricComparison;
    readonly notes: readonly string[];
};
/** In-memory baseline/candidate ledger with one changed factor per experiment. */
export declare class OptimizationLedger {
    private readonly experiments;
    /** Record one experiment and derive its decision. */
    record(input: {
        readonly experimentId: string;
        readonly hypothesis: string;
        readonly baseline: MetricSnapshot;
        readonly candidate?: MetricSnapshot;
        readonly changedFactor?: string;
        readonly workloadId: string;
        readonly rollbackRef?: string;
        readonly minimumScoreDelta?: number;
        readonly requireTokenReduction?: boolean;
        readonly target?: OptimizationTarget;
    }): ExperimentRecord;
    /** Produce a report and identify the best accepted candidate. */
    report(maxChars?: number): OptimizationReport;
    /** Return JSON objects suitable for task evidence records. */
    evidence(): readonly JsonObject[];
}
export default OptimizationLedger;
//# sourceMappingURL=optimization.d.ts.map