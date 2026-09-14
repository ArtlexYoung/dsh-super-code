export interface EvaluationSnapshot {
    readonly successRate: number;
    readonly totalTokens: number;
    readonly latencyMs: number;
}
export interface EvaluationThresholds {
    readonly minAccuracyUplift?: number;
    readonly minTokenReduction?: number;
    readonly minLatencyReduction?: number;
}
export interface EvaluationGateResult {
    readonly delta: {
        readonly successRate: number;
        readonly totalTokens: number;
        readonly latencyMs: number;
    };
    readonly reduction: {
        readonly totalTokens: number | null;
        readonly latency: number | null;
    };
    readonly thresholds: Required<EvaluationThresholds>;
    readonly checks: {
        readonly accuracyUplift: boolean;
        readonly tokenReduction: boolean;
        readonly latencyReduction: boolean;
    };
    readonly accepted: boolean;
}
export interface EvaluationRun {
    readonly baseline: EvaluationSnapshot;
    readonly candidate: EvaluationSnapshot;
}
export interface EvaluationAggregate {
    readonly runs: number;
    readonly baseline: EvaluationSnapshot;
    readonly candidate: EvaluationSnapshot;
    readonly deltas: {
        readonly successRate: number;
        readonly totalTokens: number;
        readonly latencyMs: number;
    };
    readonly tokenReduction: number | null;
    readonly latencyReduction: number | null;
}
/** Apply the release criteria without coupling them to a dataset or runner. */
export declare function evaluateReleaseGate(baseline: EvaluationSnapshot, candidate: EvaluationSnapshot, thresholds?: EvaluationThresholds): EvaluationGateResult;
/** Aggregate independent matched runs before applying a release gate. */
export declare function aggregateEvaluationRuns(runs: readonly EvaluationRun[]): EvaluationAggregate;
export default evaluateReleaseGate;
//# sourceMappingURL=evaluation.d.ts.map