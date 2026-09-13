/** Lossless JSON values accepted at the durable protocol boundary. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type JsonObject = {
    readonly [key: string]: JsonValue;
};
/** Execution facts retained for compatibility with the first protocol draft. */
export declare const TASK_STATES: readonly ["pending", "ready", "running", "waiting", "succeeded", "failed", "cancelled"];
export type TaskState = typeof TASK_STATES[number];
/** Canonical execution status. A completed run still needs review and delivery. */
export declare const TASK_STATUSES: readonly ["created", "queued", "running", "completed", "failed", "cancelled"];
export type TaskStatus = typeof TASK_STATUSES[number];
/** Business stage kept separate from execution status. */
export declare const TASK_STAGES: readonly ["pending", "queued", "working", "awaiting_review", "needs_attention", "accepted", "delivered", "stopping", "stopped", "stop_unknown", "deleted"];
export type TaskStage = typeof TASK_STAGES[number];
/** Acceptance criteria are versioned so an old review cannot authorize new work. */
export interface AcceptanceSpec {
    readonly name: string;
    readonly version: string;
    readonly checks: readonly string[];
}
/** A task dependency can carry the accepted upstream revision it was bound to. */
export interface DependencyRef {
    readonly taskId: string;
    readonly acceptedSubmissionId?: string;
    readonly acceptedArtifactDigest?: string;
}
/** A named artifact snapshot. The digest is optional for references supplied by a host. */
export interface ArtifactRef {
    readonly artifactId: string;
    readonly uri: string;
    readonly digest?: string;
    readonly mediaType?: string;
    readonly sizeBytes?: number;
}
/** Resource ceilings are checked before an executor is admitted. */
export interface Budget {
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly maxTotalTokens?: number;
    readonly maxToolCalls?: number;
    readonly timeoutMs?: number;
}
/** Evidence is an append-only pointer, never an assertion that an artifact passed. */
export interface EvidenceRecord {
    readonly evidenceId: string;
    readonly taskId?: string;
    readonly kind: 'source' | 'test' | 'metric' | 'artifact' | 'review' | 'log';
    readonly summary: string;
    readonly ref?: string;
    readonly digest?: string;
    readonly recordedAt?: string;
}
/** One immutable execution attempt. A later retry always receives another id. */
export interface AttemptRecord {
    readonly attemptId: string;
    readonly number: number;
    readonly owner?: string;
    readonly startedAt: string;
    readonly endedAt?: string;
    readonly outcome: 'running' | 'completed' | 'failed' | 'cancelled' | 'stop_unknown';
    readonly error?: {
        readonly name: string;
        readonly message: string;
    };
}
/** An owner change is retained so delegation can be audited independently of execution. */
export interface AssignmentRecord {
    readonly owner: string;
    readonly assignedAt: string;
    readonly reason?: string;
}
/** A review finding is separate from the review conclusion. */
export interface ReviewFinding {
    readonly findingId: string;
    readonly reviewerId: string;
    readonly summary: string;
    readonly artifactId?: string;
    readonly location?: string;
    readonly severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
}
/** A conclusion is tied to one submission and one criteria version. */
export interface ReviewRecord {
    readonly reviewId: string;
    readonly reviewerId: string;
    readonly independent: boolean;
    readonly outcome: 'passed' | 'failed' | 'unverified' | 'stale';
    readonly report: JsonObject;
    readonly findings: readonly ReviewFinding[];
    readonly reviewedAt: string;
}
/** One immutable candidate submitted for review. */
export interface SubmissionRecord {
    readonly submissionId: string;
    readonly requestId: string;
    readonly attemptId: string;
    readonly criteria: AcceptanceSpec;
    readonly artifacts: readonly ArtifactRef[];
    readonly artifactDigest: string;
    readonly submittedAt: string;
    readonly findings: readonly ReviewFinding[];
    readonly reviews: readonly ReviewRecord[];
}
/** Delivery is a separate durable fact after acceptance. */
export interface DeliveryRecord {
    readonly deliveryId: string;
    readonly requestId: string;
    readonly submissionId: string;
    readonly deliveredAt: string;
}
/** Cancellation has a request phase and a host-confirmed stop phase. */
export interface CancellationRecord {
    readonly requestId: string;
    readonly reason: string;
    readonly requestedAt: string;
    readonly confirmedAt?: string;
    readonly evidence?: JsonObject;
    readonly outcome: 'requested' | 'confirmed' | 'unknown';
}
/** Immutable task snapshot shared by the graph, dispatcher, and adapters. */
export interface TaskRecord {
    readonly taskId: string;
    readonly title: string;
    readonly owner?: string;
    readonly dependencies: readonly DependencyRef[];
    /** Human-readable compatibility projection of `criteria.checks`. */
    readonly acceptance: readonly string[];
    readonly criteria: AcceptanceSpec;
    readonly status: TaskStatus;
    /** Deprecated execution projection retained for callers of the first draft. */
    readonly state: TaskState;
    readonly stage: TaskStage;
    readonly revision: number;
    readonly attempts: number;
    readonly attemptId?: string;
    readonly attemptHistory: readonly AttemptRecord[];
    readonly assignmentHistory: readonly AssignmentRecord[];
    readonly returnReasons: readonly string[];
    readonly result?: JsonValue;
    readonly artifacts: readonly ArtifactRef[];
    readonly submissions: readonly SubmissionRecord[];
    readonly delivery?: DeliveryRecord;
    readonly cancellation?: CancellationRecord;
    readonly evidence: readonly EvidenceRecord[];
    readonly deleted: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
}
/** Input accepted by {@link createTask}. */
export interface TaskDefinition {
    readonly taskId: string;
    readonly title: string;
    readonly owner?: string;
    readonly dependencies?: readonly (string | DependencyRef)[];
    readonly acceptance?: readonly string[] | AcceptanceSpec;
    readonly criteria?: AcceptanceSpec;
    readonly now?: string;
}
/** Every event carries the post-command snapshot, making replay deterministic. */
export type TaskEventType = 'task.created' | 'task.assigned' | 'task.queued' | 'task.started' | 'task.completed' | 'task.failed' | 'task.submitted' | 'task.review.finding' | 'task.evidence' | 'task.reviewed' | 'task.accepted' | 'task.criteria_changed' | 'task.returned' | 'task.cancel_requested' | 'task.cancelled' | 'task.stop_unknown' | 'task.delivered' | 'task.deleted' | 'task.restored';
/** Runtime event-type allowlist shared by encoding, validation, and replay. */
export declare const TASK_EVENT_TYPES: readonly TaskEventType[];
/** Versioned JSONL event. Unknown future versions must fail closed at decode. */
export interface TaskEvent {
    readonly version: 1;
    readonly sequence: number;
    readonly eventId: string;
    readonly type: TaskEventType;
    readonly taskId: string;
    readonly revision: number;
    readonly at: string;
    readonly requestId?: string;
    readonly task: TaskRecord;
    readonly data: JsonObject;
}
/** Structured protocol failure with a stable machine-readable code. */
export declare class ProtocolError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
/** Return a detached lossless JSON value or throw at a persistence boundary. */
export declare function toJsonValue(value: unknown, path?: string): JsonValue;
/** Clone a protocol value through the same JSON validation used for persistence. */
export declare function cloneJson<T extends JsonValue>(value: T): T;
/** Derive the legacy state projection from canonical status and business stage. */
export declare function taskStateFor(status: TaskStatus, stage: TaskStage, ready?: boolean): TaskState;
/** Build a revision-one task with no external side effects. */
export declare function createTask(input: TaskDefinition): TaskRecord;
/** Validate a complete task snapshot before it is stored or replayed. */
export declare function validateTaskRecord(task: TaskRecord): TaskRecord;
/**
 * Apply the legacy state projection while preserving a complete canonical snapshot.
 *
 * This helper predates the command-oriented {@link TaskGraph} API, so it has no
 * result, artifact, reviewer, or executor inputs. Transitions that imply those
 * facts use the smallest honest representation: an attempt is closed, and a
 * `running -> waiting` transition appends an empty submission with no review.
 * Callers that have real execution data should use `TaskGraph.completeTask()`
 * and `TaskGraph.submitTaskResult()` instead. Every successful return is
 * validated before it leaves this function; failed/succeeded states cannot be
 * revived here and require explicit rework through the graph API.
 */
export declare function transitionTask(task: TaskRecord, next: TaskState, dependencies?: readonly TaskRecord[], now?: string): TaskRecord;
/** Validate a budget and return a detached copy. */
export declare function validateBudget(budget: Budget): Budget;
/** Compute a stable digest for an artifact snapshot. */
export declare function artifactDigest(artifacts: readonly ArtifactRef[]): string;
/** Stable object-key ordering used by request idempotency and JSONL. */
export declare function stableStringify(value: unknown): string;
/** Encode one event as one newline-free JSONL record. */
export declare function encodeEvent(event: TaskEvent): string;
/** Encode a contiguous event stream as JSONL. */
export declare function encodeEvents(events: readonly TaskEvent[]): string;
/** Decode one JSONL record and reject unknown versions or malformed snapshots. */
export declare function decodeEvent(line: string): TaskEvent;
/** Validate event identity, sequence, and post-command snapshot. */
export declare function validateEvent(event: TaskEvent): TaskEvent;
/** A benchmark measurement used by the optimization ledger. */
export interface MetricSnapshot {
    readonly mode: 'real' | 'mock' | 'replay';
    readonly score: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly latencyMs: number;
    readonly toolCalls: number;
    readonly workloadId?: string;
    readonly model?: string;
    readonly contextLimit?: number;
}
/** Result of comparing two matched measurements. */
export interface MetricComparison {
    readonly scoreDelta: number;
    readonly totalTokensDelta: number;
    readonly latencyDelta: number;
    readonly toolCallsDelta: number;
    readonly accepted: boolean;
    readonly reason: string;
}
/**
 * Compare matched real measurements. Mock and replay values remain useful for
 * debugging but cannot authorize a release.
 */
export declare function compareMetrics(baseline: MetricSnapshot, candidate: MetricSnapshot): MetricComparison;
//# sourceMappingURL=protocol.d.ts.map