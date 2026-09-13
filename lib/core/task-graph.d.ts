import type { AcceptanceSpec, ArtifactRef, DependencyRef, JsonObject, ReviewFinding, ReviewRecord, TaskDefinition, TaskEvent, TaskRecord, TaskStage, TaskStatus } from './protocol.js';
/** Task input accepted by {@link TaskGraph.add}. */
export interface TaskInput extends TaskDefinition {
    readonly dependencies?: readonly (string | DependencyRef)[];
}
/** Deployment limits and deterministic seams for tests/replay. */
export interface TaskGraphOptions {
    readonly scope?: string;
    readonly maxTasks?: number;
    readonly maxDepth?: number;
    readonly clock?: () => string;
    readonly idFactory?: () => string;
}
/** Per-dependency readiness explanation. */
export interface DependencyStatus {
    readonly taskId: string;
    readonly satisfied: boolean;
    readonly reason: string;
    readonly stage: TaskStage;
    readonly status: TaskStatus;
    readonly acceptedSubmissionId?: string;
    readonly acceptedArtifactDigest?: string;
}
/** Result returned by an event wait. */
export interface WaitResult {
    readonly timedOut: boolean;
    readonly sequence: number;
    readonly events: readonly TaskEvent[];
}
/**
 * Event-sourced DAG for one Super Agent scope. All public mutations append a
 * complete post-command snapshot, so a fresh instance can be reconstructed
 * without re-running a model or tool.
 */
export declare class TaskGraph {
    private readonly records;
    private readonly log;
    private readonly requests;
    private readonly pendingRequests;
    private readonly waiters;
    private readonly options;
    private transactionDepth;
    private notifyPending;
    /** Scope label used by adapters for ownership checks. */
    readonly scope: string | undefined;
    /**
     * @param inputs - optional initial tasks.
     * @param options - graph limits, scope, and deterministic seams; a number is accepted as the legacy max depth.
     */
    constructor(inputs?: readonly TaskInput[], options?: TaskGraphOptions | number);
    /** Rebuild a graph from a contiguous event stream without side effects. */
    static fromEvents(events: readonly TaskEvent[], options?: TaskGraphOptions): TaskGraph;
    /** Current global event sequence. */
    get version(): number;
    /** Detached current task, including deleted tombstones when requested explicitly. */
    get(taskId: string): TaskRecord;
    /** Return all active tasks by insertion order. */
    all(includeDeleted?: boolean): readonly TaskRecord[];
    /** Return tasks whose dependencies are currently accepted. */
    ready(): readonly TaskRecord[];
    /** Return events after a sequence, detached for callers and persistence. */
    eventsSince(sequence?: number): readonly TaskEvent[];
    /** Return the complete JSONL event stream. */
    toJSONL(): string;
    /** Add a task and append `task.created`. */
    add(input: TaskInput, requestId?: string): TaskRecord;
    /** Assign and queue one task. Queueing does not start a model attempt. */
    assignTask(taskId: string, owner: string, expectedRevision?: number, requestId?: string, reason?: string): TaskRecord;
    /** Start one admitted task and create a fresh attempt. */
    startTask(taskId: string, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Atomically assign and start several independent ready tasks. */
    startBatch(assignments: readonly {
        readonly taskId: string;
        readonly owner: string;
        readonly expectedRevision?: number;
    }[]): readonly TaskRecord[];
    /** Mark an attempt as completed; submission and acceptance remain separate. */
    completeTask(taskId: string, attemptId: string, result?: unknown, artifacts?: readonly ArtifactRef[], expectedRevision?: number, requestId?: string): TaskRecord;
    /** Mark an attempt failed. A failed task is not implicitly requeued. */
    failTask(taskId: string, attemptId: string, error: unknown, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Submit the current attempt's artifact snapshot for review. */
    submitTaskResult(taskId: string, requestId: string, artifacts?: readonly ArtifactRef[], expectedRevision?: number): TaskRecord;
    /** Append one normalized finding to the current submission. */
    recordReviewFinding(taskId: string, finding: ReviewFinding, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Record an independent or host review conclusion without accepting it. */
    recordReview(taskId: string, review: ReviewRecord, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Accept a current submission after at least one passed review. */
    acceptTask(taskId: string, expectedRevision?: number, requestId?: string, minimumIndependentReviews?: number): TaskRecord;
    /** Explicitly close the current attempt and create a new pending attempt. */
    returnForRework(taskId: string, reason: string, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Request cancellation; running work remains stopping until confirmed. */
    requestCancellation(taskId: string, reason: string, requestId?: string, expectedRevision?: number): TaskRecord;
    /** Confirm that an executor actually stopped. */
    confirmCancellation(taskId: string, options?: {
        readonly evidence?: JsonObject;
        readonly reason?: string;
        readonly expectedRevision?: number;
    }, requestId?: string): TaskRecord;
    /** Mark a late result or timeout as unknown stop; this cannot be retried implicitly. */
    markStopUnknown(taskId: string, reason: string, evidence?: JsonObject, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Cancel every task that has not started; no model executor is called. */
    cancelUnstarted(reason?: string): readonly TaskRecord[];
    /** Deliver only the currently accepted submission. */
    deliverTask(taskId: string, requestId: string, expectedRevision?: number): TaskRecord;
    /** Add an evidence pointer without changing acceptance. */
    addEvidence(taskId: string, evidence: EvidenceLike, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Change criteria after explicit rework; old reviews then remain historical. */
    setAcceptance(taskId: string, criteria: AcceptanceSpec, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Delete a task while retaining a tombstone in the event stream. */
    deleteTask(taskId: string, expectedRevision?: number, requestId?: string): TaskRecord;
    /** Restore one persisted snapshot without replaying a model/tool side effect. */
    restoreTask(snapshot: TaskRecord, requestId?: string): TaskRecord;
    /** Explain every dependency and its accepted version binding. */
    dependencyStatus(taskId: string): readonly DependencyStatus[];
    /** Wait for a committed event rather than polling task state. */
    waitForChange(afterSequence?: number, timeoutMs?: number, signal?: AbortSignal): Promise<WaitResult>;
    /** Replay events into this graph; duplicate event IDs are idempotent. */
    replay(events: readonly TaskEvent[]): void;
    private appendInitial;
    /** Reject a forged replay snapshot that skips or revives a lifecycle stage. */
    private assertReplayTransition;
    private activeCount;
    private require;
    private expectRevision;
    private assertStartable;
    private assertAttemptRunning;
    private startFrom;
    private update;
    private commit;
    private beginRequest;
    /** Commit an idempotent no-op result without inventing a second event. */
    private noop;
    private transaction;
    private notifyWaiters;
    private validateGraph;
    private dependenciesSatisfied;
    private replaceSubmission;
    private confirmCancellationInternal;
    private markStopUnknownInternal;
    private normalizeFinding;
    private normalizeReview;
    private normalizeCriteria;
    private normalizeEvidence;
    private now;
    private makeId;
}
/** Input for {@link TaskGraph.addEvidence}. */
export interface EvidenceLike {
    readonly evidenceId: string;
    readonly kind: 'source' | 'test' | 'metric' | 'artifact' | 'review' | 'log';
    readonly summary: string;
    readonly ref?: string;
    readonly digest?: string;
    readonly recordedAt?: string;
}
export default TaskGraph;
//# sourceMappingURL=task-graph.d.ts.map