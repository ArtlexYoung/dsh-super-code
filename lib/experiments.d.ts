export type Verdict = {
    kind: 'pass';
} | {
    kind: 'fail';
    signature: string;
    detail?: unknown;
} | {
    kind: 'unknown';
    reason: string;
};
export type Probe<T> = (input: T, signal?: AbortSignal) => Verdict | Promise<Verdict>;
export interface ExperimentLimits {
    maxChecks: number;
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface ExperimentStats {
    checks: number;
    maxChecks: number;
    elapsedMs: number;
    timeoutMs: number;
}
/** Shared callback budget; hard interruption belongs to the outer shell timeout. */
export declare class ExperimentBudget {
    private checks;
    private readonly started;
    private readonly maxChecks;
    private readonly timeoutMs;
    private readonly signal?;
    constructor(limits: ExperimentLimits);
    private checkTime;
    check<T>(probe: Probe<T>, input: T): Promise<Verdict>;
    stats(): ExperimentStats;
}
export interface Reduction<T> {
    status: 'reduced' | 'not-reproduced' | 'inconclusive' | 'stopped';
    input: T[];
    reproduced: boolean;
    minimality: 'one-removal' | 'not-established';
    reason: string;
    stats: ExperimentStats;
}
/** Chunk deletion followed by single deletion; no global-minimum claim. */
export declare function reduceFailure<T>(input: readonly T[], signature: string, probe: Probe<T[]>, budget: ExperimentBudget): Promise<Reduction<T>>;
export type SearchResult<T> = {
    status: 'counterexample';
    index: number;
    input: T;
    verdict: Extract<Verdict, {
        kind: 'fail';
    }>;
    stats: ExperimentStats;
} | {
    status: 'checked' | 'inconclusive' | 'stopped';
    checkedCases: number;
    unknownCases: number;
    reason: string;
    stats: ExperimentStats;
};
/** Consumes cases lazily and stops at the first explicit counterexample. */
export declare function findCounterexample<T>(cases: Iterable<T>, probe: Probe<T>, budget: ExperimentBudget): Promise<SearchResult<T>>;
export type Observation<T, O> = (input: T, signal?: AbortSignal) => O | Promise<O>;
/** Exceptions propagate; behavior-difference identifies any mismatch, not a specific fault. */
export declare function differential<T, O>(reference: Observation<T, O>, candidate: Observation<T, O>, equal?: (left: O, right: O) => boolean): Probe<T>;
/** The caller supplies a contract-backed transform and relation, not a guessed oracle. */
export declare function metamorphic<T, O>(contract: string, observe: Observation<T, O>, transform: (input: T) => T, holds: (original: O, transformed: O) => boolean): Probe<T>;
export interface ScheduleStep {
    lane: 0 | 1;
    index: number;
}
export interface ScheduleSet extends Iterable<ScheduleStep[]> {
    readonly coverage: 'complete' | 'limited';
    readonly count: number;
}
/** Enumerate two ordered lanes, bounded before allocation; not a runtime scheduler. */
export declare function interleavings(leftLength: number, rightLength: number, maxSchedules: number): ScheduleSet;
//# sourceMappingURL=experiments.d.ts.map