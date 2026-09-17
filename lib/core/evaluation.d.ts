/** Frozen v1 evaluation labels; these are not currently installed presets. */
declare const V1_SCENARIO_NAMES: readonly ["solo", "team", "research", "optimization"];
type V1ScenarioName = typeof V1_SCENARIO_NAMES[number];
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
/** One matched baseline/candidate run in the frozen v1 evaluation protocol. */
export interface ScenarioEvaluationRun extends EvaluationRun {
    readonly scenario: V1ScenarioName;
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
/** Per-scenario release result for a complete four-scenario batch. */
export interface ScenarioBatchGateResult {
    readonly accepted: boolean;
    readonly byScenario: Readonly<Record<V1ScenarioName, EvaluationGateResult>>;
}
/** Apply the release criteria without coupling them to a dataset or runner. */
export declare function evaluateReleaseGate(baseline: EvaluationSnapshot, candidate: EvaluationSnapshot, thresholds?: EvaluationThresholds): EvaluationGateResult;
/** Aggregate independent matched runs before applying a release gate. */
export declare function aggregateEvaluationRuns(runs: readonly EvaluationRun[]): EvaluationAggregate;
/**
 * Aggregate one matched batch and reject partial batches. Keeping this check
 * in the domain module prevents an evaluator from silently optimizing only
 * one preset while reporting a package-level result.
 */
export declare function aggregateScenarioEvaluationRuns(runs: readonly ScenarioEvaluationRun[]): Readonly<Record<V1ScenarioName, EvaluationAggregate>>;
/** Apply the release gate independently to all four scenarios. */
export declare function evaluateScenarioBatchRelease(runs: readonly ScenarioEvaluationRun[], thresholds?: EvaluationThresholds): ScenarioBatchGateResult;
export default evaluateReleaseGate;
//# sourceMappingURL=evaluation.d.ts.map