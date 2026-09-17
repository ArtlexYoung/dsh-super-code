import type { TaskRecord } from './protocol.js';
import { TaskGraph } from './task-graph.js';
/** Result of one bounded dispatch pass. */
export interface DispatchResult {
    readonly started: readonly string[];
    readonly completed: readonly string[];
    readonly failed: readonly string[];
    readonly timedOut: readonly string[];
    readonly cancelled: readonly string[];
    readonly stopUnknown: readonly string[];
}
/** Executor receives a fresh attempt and must observe the abort signal. */
export type TaskExecutor = (task: TaskRecord, signal: AbortSignal) => Promise<TaskExecutionResult | void>;
/** Optional result/artifact payload returned by an executor. */
export interface TaskExecutionResult {
    readonly result?: unknown;
    readonly artifacts?: readonly import('./protocol.js').ArtifactRef[];
}
/** Dispatcher limits. No implicit retries are performed. */
export interface DispatcherOptions {
    readonly maxConcurrent?: number;
    readonly timeoutMs?: number;
    /**
     * Bounded window in which an executor can confirm a cancellation after its
     * AbortSignal fires. An executor that remains unresolved is classified as
     * `stop_unknown` when this window closes.
     */
    readonly stopGraceMs?: number;
}
export interface DispatchAvailableOptions {
    readonly signal?: AbortSignal;
    /** Bound total starts, including work added by an acceptance callback. */
    readonly maxStarted?: number;
    /** Explicit acceptance remains the caller's responsibility. */
    readonly afterEach?: (task: TaskRecord) => Promise<void>;
}
/**
 * Event-driven finite dispatcher over {@link TaskGraph}. It assigns and starts
 * a bounded batch atomically, waits on executor promises, and records each
 * outcome. A failed or timed-out attempt remains terminal until the caller
 * explicitly invokes `returnForRework`.
 */
export declare class Dispatcher {
    private readonly graph;
    private readonly options;
    private readonly liveExecutions;
    /**
     * @param graph - task graph owning all lifecycle mutations.
     * @param options - concurrency, timeout, and stop-confirmation limits.
     */
    constructor(graph: TaskGraph, options?: DispatcherOptions);
    /**
     * Start as many ready tasks as capacity allows. Assignment is evaluated for
     * every selected task before any task is started, so a missing owner leaves
     * the graph unchanged.
     */
    runReady(assign: (task: TaskRecord) => string | undefined, execute: TaskExecutor): Promise<DispatchResult>;
    /** Refill free slots on completion/acceptance events, without model-driven polling or retries. */
    runAvailable(assign: (task: TaskRecord) => string | undefined, execute: TaskExecutor, options?: DispatchAvailableOptions): Promise<DispatchResult>;
    private activeCount;
    /** Cancel tasks that have not acquired an attempt. */
    cancelPending(reason?: string): readonly TaskRecord[];
    private executeOne;
    private handleCancellation;
    private handleTimeout;
    private handleExecutionResult;
    private handleExecutionError;
    private failExecution;
    private handleCancellationAfterSettlement;
    private currentStopOutcome;
    private classifyCurrent;
    private waitForExecution;
    private watchCancellation;
}
export default Dispatcher;
//# sourceMappingURL=dispatcher.d.ts.map