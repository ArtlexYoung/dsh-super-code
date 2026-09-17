import { randomUUID } from 'node:crypto';
import { cloneJson, createTask, encodeEvents, ProtocolError, stableStringify, TASK_EVENT_TYPES, validateEvent, validateTaskRecord, artifactDigest, } from './protocol.js';
function text(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
    return value.trim();
}
function detached(value) {
    return cloneJson(value);
}
function objectValue(value, field) {
    const converted = cloneJson(value);
    if (converted === null || Array.isArray(converted) || typeof converted !== 'object') {
        throw new ProtocolError(`${field} must be a JSON object`, 'INVALID_ARGUMENT');
    }
    return converted;
}
function timestamp(value) {
    if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
        throw new ProtocolError('clock must return an ISO timestamp', 'INVALID_CONFIG');
    }
    return value;
}
function replaceAttempt(attempts, attemptId, update) {
    const index = attempts.findIndex(attempt => attempt.attemptId === attemptId);
    if (index < 0)
        throw new ProtocolError(`unknown attempt ${attemptId}`, 'ATTEMPT_NOT_FOUND');
    return attempts.map((attempt, position) => position === index ? update(attempt) : attempt);
}
function currentSubmission(task) {
    if (task.attemptId === undefined)
        return undefined;
    return [...task.submissions].reverse().find(submission => submission.attemptId === task.attemptId);
}
function acceptedSubmission(task) {
    if (task.stage !== 'accepted' && task.stage !== 'delivered')
        return undefined;
    const submission = currentSubmission(task);
    if (submission === undefined || submission.criteria.version !== task.criteria.version || submission.criteria.name !== task.criteria.name)
        return undefined;
    if (!submission.reviews.some(review => review.outcome === 'passed'))
        return undefined;
    if (submission.artifactDigest !== artifactDigest(task.artifacts))
        return undefined;
    return submission;
}
function activeStatus(status) {
    return status === 'created' || status === 'queued' || status === 'running';
}
/**
 * Event-sourced DAG for one Super Agent scope. All public mutations append a
 * complete post-command snapshot, so a fresh instance can be reconstructed
 * without re-running a model or tool.
 */
export class TaskGraph {
    records = new Map();
    log = [];
    requests = new Map();
    pendingRequests = new Map();
    waiters = new Set();
    options;
    transactionDepth = 0;
    notifyPending = false;
    /** Scope label used by adapters for ownership checks. */
    scope;
    /**
     * @param inputs - optional initial tasks.
     * @param options - graph limits, scope, and deterministic seams; a number is accepted as the legacy max depth.
     */
    constructor(inputs = [], options = {}) {
        const normalized = typeof options === 'number' ? { maxDepth: options } : options;
        this.options = {
            ...normalized,
            maxTasks: normalized.maxTasks ?? 256,
            maxDepth: normalized.maxDepth ?? 32,
        };
        if (!Number.isSafeInteger(this.options.maxTasks) || this.options.maxTasks < 1)
            throw new ProtocolError('maxTasks must be a positive safe integer', 'INVALID_CONFIG');
        if (!Number.isSafeInteger(this.options.maxDepth) || this.options.maxDepth < 1)
            throw new ProtocolError('maxDepth must be a positive safe integer', 'INVALID_CONFIG');
        this.scope = normalized.scope;
        const initial = inputs.map(input => createTask(input));
        for (const task of initial) {
            if (this.records.has(task.taskId))
                throw new ProtocolError(`duplicate task ${task.taskId}`, 'TASK_DUPLICATE');
            this.records.set(task.taskId, task);
        }
        try {
            this.validateGraph();
        }
        catch (error) {
            this.records.clear();
            throw error;
        }
        for (const task of initial)
            this.appendInitial(task);
    }
    /** Rebuild a graph from a contiguous event stream without side effects. */
    static fromEvents(events, options = {}) {
        const graph = new TaskGraph([], options);
        graph.replay(events);
        return graph;
    }
    /** Current global event sequence. */
    get version() {
        return this.log.length;
    }
    /** Detached current task, including deleted tombstones when requested explicitly. */
    get(taskId) {
        const task = this.records.get(text(taskId, 'taskId'));
        if (task === undefined)
            throw new ProtocolError(`unknown task ${taskId}`, 'TASK_NOT_FOUND');
        return detached(task);
    }
    /** Return all active tasks by insertion order. */
    all(includeDeleted = false) {
        return [...this.records.values()]
            .filter(task => includeDeleted || !task.deleted)
            .map(task => detached(task));
    }
    /** Return tasks whose dependencies are currently accepted. */
    ready() {
        return [...this.records.values()]
            .filter(task => !task.deleted && task.status === 'created' && task.cancellation === undefined && this.dependenciesSatisfied(task))
            .map(task => detached(task));
    }
    /** Return events after a sequence, detached for callers and persistence. */
    eventsSince(sequence = 0) {
        if (!Number.isSafeInteger(sequence) || sequence < 0)
            throw new ProtocolError('sequence must be a non-negative safe integer', 'INVALID_ARGUMENT');
        return this.log.slice(sequence).map(event => detached(event));
    }
    /** Return the complete JSONL event stream. */
    toJSONL() {
        return encodeEvents(this.log);
    }
    /** Add a task and append `task.created`. */
    add(input, requestId) {
        const taskId = text(input.taskId, 'taskId');
        const replay = this.beginRequest(requestId, { operation: 'create', input });
        if (replay !== undefined)
            return replay;
        if (this.records.has(taskId))
            throw new ProtocolError(`duplicate task ${taskId}`, 'TASK_DUPLICATE');
        if (this.activeCount() >= this.options.maxTasks)
            throw new ProtocolError(`task limit ${this.options.maxTasks} reached`, 'TASK_LIMIT');
        const task = createTask({ ...input, taskId });
        this.records.set(task.taskId, task);
        try {
            this.validateGraph();
        }
        catch (error) {
            this.records.delete(task.taskId);
            throw error;
        }
        return this.commit(undefined, task, 'task.created', { operation: 'create' }, requestId);
    }
    /** Assign and queue one task. Queueing does not start a model attempt. */
    assignTask(taskId, owner, expectedRevision, requestId, reason) {
        const normalizedOwner = text(owner, 'owner');
        const replay = this.beginRequest(requestId, { operation: 'assign', taskId, owner: normalizedOwner, expectedRevision, reason });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.deleted || current.status === 'cancelled')
            throw new ProtocolError('cancelled or deleted task cannot be assigned', 'INVALID_TRANSITION');
        if (current.owner !== undefined && current.owner !== normalizedOwner)
            throw new ProtocolError(`task ${current.taskId} is owned by ${current.owner}`, 'TASK_OWNER_CONFLICT');
        if (current.status !== 'created' && current.status !== 'queued')
            throw new ProtocolError(`task ${current.taskId} is not queueable`, 'INVALID_TRANSITION');
        if (current.status === 'queued' && current.owner === normalizedOwner)
            return this.noop(requestId, current);
        const assignment = { owner: normalizedOwner, assignedAt: this.now(), ...reason === undefined ? {} : { reason: text(reason, 'reason') } };
        const next = {
            ...current,
            owner: normalizedOwner,
            assignmentHistory: [...current.assignmentHistory, assignment],
            status: 'queued',
            state: 'ready',
            stage: 'queued',
        };
        return this.update(current, next, 'task.assigned', { owner: normalizedOwner }, requestId);
    }
    /** Start one admitted task and create a fresh attempt. */
    startTask(taskId, expectedRevision, requestId) {
        const replay = this.beginRequest(requestId, { operation: 'start', taskId, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        this.assertStartable(current);
        return this.startFrom(current, requestId);
    }
    /** Atomically assign and start several independent ready tasks. */
    startBatch(assignments) {
        const unique = new Set();
        if (assignments.length === 0)
            return [];
        for (const assignment of assignments) {
            const taskId = text(assignment.taskId, 'taskId');
            if (unique.has(taskId))
                throw new ProtocolError(`duplicate batch task ${taskId}`, 'INVALID_ARGUMENT');
            unique.add(taskId);
        }
        return this.transaction(() => {
            const selected = assignments.map(assignment => {
                const task = this.require(assignment.taskId);
                this.expectRevision(task, assignment.expectedRevision);
                this.assertStartable(task);
                const owner = text(assignment.owner, 'owner');
                if (task.owner !== undefined && task.owner !== owner)
                    throw new ProtocolError(`task ${task.taskId} is owned by ${task.owner}`, 'TASK_OWNER_CONFLICT');
                return { task, owner };
            });
            const started = [];
            for (const { task, owner } of selected) {
                const assigned = task.owner === undefined
                    ? { ...task, owner, assignmentHistory: [...task.assignmentHistory, { owner, assignedAt: this.now() }] }
                    : task;
                const startedTask = this.startFrom(assigned, undefined, owner);
                started.push(startedTask);
            }
            return started.map(task => detached(task));
        });
    }
    /** Mark an attempt as completed; submission and acceptance remain separate. */
    completeTask(taskId, attemptId, result, artifacts = [], expectedRevision, requestId) {
        const replay = this.beginRequest(requestId, { operation: 'complete', taskId, attemptId, result, artifacts, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        this.assertAttemptRunning(current, attemptId);
        if (current.cancellation?.outcome === 'requested')
            return this.markStopUnknownInternal(current, 'result arrived after cancellation request', undefined, requestId);
        const jsonResult = result === undefined ? undefined : cloneJson(result);
        const normalizedArtifacts = artifacts.map(artifact => detached(artifact));
        const endedAt = this.now();
        const history = replaceAttempt(current.attemptHistory, attemptId, attempt => ({ ...attempt, outcome: 'completed', endedAt }));
        const next = {
            ...current,
            state: 'succeeded',
            status: 'completed',
            stage: 'needs_attention',
            attemptHistory: history,
            ...jsonResult === undefined ? { result: undefined } : { result: jsonResult },
            artifacts: normalizedArtifacts,
        };
        return this.update(current, next, 'task.completed', { attemptId, artifactDigest: artifactDigest(normalizedArtifacts) }, requestId);
    }
    /** Mark an attempt failed. A failed task is not implicitly requeued. */
    failTask(taskId, attemptId, error, expectedRevision, requestId) {
        const errorName = error instanceof Error ? error.name : 'TaskError';
        const errorMessage = error instanceof Error ? error.message : String(error);
        const replay = this.beginRequest(requestId, { operation: 'fail', taskId, attemptId, errorName, errorMessage, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        this.assertAttemptRunning(current, attemptId);
        if (current.cancellation?.outcome === 'requested')
            return this.confirmCancellationInternal(current, { reason: errorMessage }, requestId);
        const endedAt = this.now();
        const history = replaceAttempt(current.attemptHistory, attemptId, attempt => ({ ...attempt, outcome: 'failed', endedAt, error: { name: errorName, message: errorMessage } }));
        const next = { ...current, status: 'failed', state: 'failed', stage: 'needs_attention', attemptHistory: history };
        return this.update(current, next, 'task.failed', { attemptId, error: { name: errorName, message: errorMessage } }, requestId);
    }
    /** Submit the current attempt's artifact snapshot for review. */
    submitTaskResult(taskId, requestId, artifacts, expectedRevision) {
        const normalizedRequest = text(requestId, 'requestId');
        const supplied = artifacts;
        const replay = this.beginRequest(normalizedRequest, { operation: 'submit', taskId, artifacts: supplied, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.status !== 'completed' || current.attemptId === undefined)
            throw new ProtocolError('submission requires a completed attempt', 'INVALID_TRANSITION');
        if (current.delivery !== undefined)
            throw new ProtocolError('delivered task cannot be submitted again', 'INVALID_TRANSITION');
        if (currentSubmission(current) !== undefined)
            throw new ProtocolError('current attempt already has a submission', 'SUBMISSION_DUPLICATE');
        const snapshot = (supplied ?? current.artifacts).map(artifact => detached(artifact));
        const submission = {
            submissionId: this.makeId('submission'),
            requestId: normalizedRequest,
            attemptId: current.attemptId,
            criteria: detached(current.criteria),
            artifacts: snapshot,
            artifactDigest: artifactDigest(snapshot),
            submittedAt: this.now(),
            findings: [],
            reviews: [],
        };
        const next = { ...current, stage: 'awaiting_review', state: 'waiting', status: 'completed', submissions: [...current.submissions, submission] };
        return this.update(current, next, 'task.submitted', { submissionId: submission.submissionId }, normalizedRequest);
    }
    /** Append one normalized finding to the current submission. */
    recordReviewFinding(taskId, finding, expectedRevision, requestId) {
        const normalized = this.normalizeFinding(finding);
        const replay = this.beginRequest(requestId, { operation: 'finding', taskId, finding: normalized, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.stage === 'accepted' || current.stage === 'delivered')
            throw new ProtocolError('accepted task cannot receive another review finding', 'INVALID_TRANSITION');
        const submission = currentSubmission(current);
        if (submission === undefined)
            throw new ProtocolError('review finding requires a current submission', 'SUBMISSION_REQUIRED');
        if (submission.findings.some(existing => existing.findingId === normalized.findingId)) {
            return this.noop(requestId, current);
        }
        const updatedSubmission = { ...submission, findings: [...submission.findings, normalized] };
        const next = this.replaceSubmission(current, updatedSubmission);
        return this.update(current, next, 'task.review.finding', { findingId: normalized.findingId }, requestId);
    }
    /** Record an independent or host review conclusion without accepting it. */
    recordReview(taskId, review, expectedRevision, requestId) {
        const normalized = this.normalizeReview(review);
        const replay = this.beginRequest(requestId, { operation: 'review', taskId, review: normalized, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.stage === 'accepted' || current.stage === 'delivered')
            throw new ProtocolError('accepted task cannot be reviewed again', 'INVALID_TRANSITION');
        const submission = currentSubmission(current);
        if (submission === undefined)
            throw new ProtocolError('review requires a current submission', 'SUBMISSION_REQUIRED');
        if (normalized.independent && normalized.reviewerId === current.owner)
            throw new ProtocolError('independent review must use a different reviewer', 'REVIEW_NOT_INDEPENDENT');
        if (submission.reviews.some(existing => existing.reviewId === normalized.reviewId))
            return this.noop(requestId, current);
        const updatedSubmission = { ...submission, reviews: [...submission.reviews, normalized] };
        const next = { ...this.replaceSubmission(current, updatedSubmission), stage: normalized.outcome === 'failed' ? 'needs_attention' : 'awaiting_review', state: 'waiting', status: 'completed' };
        return this.update(current, next, 'task.reviewed', { reviewId: normalized.reviewId, outcome: normalized.outcome }, requestId);
    }
    /** Accept a current submission after at least one passed review. */
    acceptTask(taskId, expectedRevision, requestId, minimumIndependentReviews = 0) {
        const replay = this.beginRequest(requestId, { operation: 'accept', taskId, expectedRevision, minimumIndependentReviews });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.delivery !== undefined)
            throw new ProtocolError('delivered task cannot be accepted again', 'INVALID_TRANSITION');
        if (current.stage !== 'awaiting_review' && current.stage !== 'needs_attention')
            throw new ProtocolError('acceptance requires a submitted review', 'ACCEPTANCE_REQUIRED');
        const submission = currentSubmission(current);
        if (submission === undefined)
            throw new ProtocolError('acceptance requires a current submission', 'SUBMISSION_REQUIRED');
        if (submission.criteria.name !== current.criteria.name || submission.criteria.version !== current.criteria.version)
            throw new ProtocolError('submission criteria are stale', 'ACCEPTANCE_STALE');
        if (submission.artifactDigest !== artifactDigest(current.artifacts))
            throw new ProtocolError('artifacts changed since submission', 'ACCEPTANCE_STALE');
        const passed = submission.reviews.filter(review => review.outcome === 'passed');
        const independent = new Set(passed.filter(review => review.independent).map(review => review.reviewerId));
        if (passed.length === 0)
            throw new ProtocolError('acceptance requires a passed review', 'ACCEPTANCE_REQUIRED');
        if (independent.size < minimumIndependentReviews)
            throw new ProtocolError(`acceptance requires ${minimumIndependentReviews} independent reviews`, 'REVIEW_INSUFFICIENT');
        const next = { ...current, stage: 'accepted', state: 'succeeded', status: 'completed' };
        return this.update(current, next, 'task.accepted', { submissionId: submission.submissionId, independentReviews: independent.size }, requestId);
    }
    /** Explicitly close the current attempt and create a new pending attempt. */
    returnForRework(taskId, reason, expectedRevision, requestId) {
        const normalizedReason = text(reason, 'reason');
        const replay = this.beginRequest(requestId, { operation: 'return', taskId, reason: normalizedReason, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.deleted || current.delivery !== undefined)
            throw new ProtocolError('delivered or deleted task cannot be returned', 'INVALID_TRANSITION');
        if (current.attempts === 0 || (current.status !== 'completed' && current.status !== 'failed'))
            throw new ProtocolError('rework requires a finished attempt', 'INVALID_TRANSITION');
        const ready = this.dependenciesSatisfied(current);
        const next = {
            ...current,
            status: 'created',
            state: ready ? 'ready' : 'pending',
            stage: 'pending',
            attemptId: undefined,
            result: undefined,
            artifacts: [],
            cancellation: undefined,
            returnReasons: [...current.returnReasons, normalizedReason],
        };
        return this.update(current, next, 'task.returned', { reason: normalizedReason }, requestId);
    }
    /** Request cancellation; running work remains stopping until confirmed. */
    requestCancellation(taskId, reason, requestId, expectedRevision) {
        const normalizedReason = text(reason, 'reason');
        const normalizedRequest = text(requestId ?? `cancel-${this.makeId('request')}`, 'requestId');
        const replay = this.beginRequest(normalizedRequest, { operation: 'cancel-request', taskId, reason: normalizedReason, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (!activeStatus(current.status) || current.deleted)
            throw new ProtocolError(`task ${current.taskId} is already terminal`, 'INVALID_TRANSITION');
        if (current.cancellation !== undefined)
            throw new ProtocolError('task is already stopping', 'CANCELLATION_DUPLICATE');
        const cancellation = { requestId: normalizedRequest, reason: normalizedReason, requestedAt: this.now(), outcome: 'requested' };
        const stopping = { ...current, cancellation, stage: 'stopping' };
        const requested = this.update(current, stopping, 'task.cancel_requested', { reason: normalizedReason }, current.status === 'running' ? normalizedRequest : undefined);
        if (current.status === 'running')
            return requested;
        return this.confirmCancellationInternal(requested, { reason: 'task had not started' }, normalizedRequest);
    }
    /** Confirm that an executor actually stopped. */
    confirmCancellation(taskId, options = {}, requestId) {
        const normalizedRequest = requestId ?? `confirm-${this.makeId('request')}`;
        const replay = this.beginRequest(normalizedRequest, { operation: 'cancel-confirm', taskId, options });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, options.expectedRevision);
        return this.confirmCancellationInternal(current, options, normalizedRequest);
    }
    /** Mark a late result or timeout as unknown stop; this cannot be retried implicitly. */
    markStopUnknown(taskId, reason, evidence, expectedRevision, requestId) {
        const normalizedReason = text(reason, 'reason');
        const replay = this.beginRequest(requestId, { operation: 'stop-unknown', taskId, reason: normalizedReason, evidence, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.status !== 'running' || (current.cancellation !== undefined && current.cancellation.outcome !== 'requested')) {
            throw new ProtocolError('stop-unknown requires a running attempt', 'INVALID_TRANSITION');
        }
        return this.markStopUnknownInternal(current, normalizedReason, evidence, requestId);
    }
    /** Cancel every task that has not started; no model executor is called. */
    cancelUnstarted(reason = 'cancelled before start') {
        const result = [];
        for (const task of [...this.records.values()]) {
            if (task.deleted || (task.status !== 'created' && task.status !== 'queued'))
                continue;
            result.push(this.requestCancellation(task.taskId, reason));
        }
        return result;
    }
    /** Deliver only the currently accepted submission. */
    deliverTask(taskId, requestId, expectedRevision) {
        const normalizedRequest = text(requestId, 'requestId');
        const replay = this.beginRequest(normalizedRequest, { operation: 'deliver', taskId, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.delivery !== undefined) {
            if (current.delivery.requestId === normalizedRequest)
                return this.noop(normalizedRequest, current);
            throw new ProtocolError('task is already delivered for another request', 'DELIVERY_DUPLICATE');
        }
        const submission = acceptedSubmission(current);
        if (submission === undefined || current.stage !== 'accepted')
            throw new ProtocolError('delivery requires current accepted artifacts and criteria', 'ACCEPTANCE_REQUIRED');
        const delivery = { deliveryId: this.makeId('delivery'), requestId: normalizedRequest, submissionId: submission.submissionId, deliveredAt: this.now() };
        const next = { ...current, delivery, stage: 'delivered', state: 'succeeded', status: 'completed' };
        return this.update(current, next, 'task.delivered', { deliveryId: delivery.deliveryId, submissionId: submission.submissionId }, normalizedRequest);
    }
    /** Add an evidence pointer without changing acceptance. */
    addEvidence(taskId, evidence, expectedRevision, requestId) {
        const normalized = this.normalizeEvidence(taskId, evidence);
        const replay = this.beginRequest(requestId, { operation: 'evidence', taskId, evidence: normalized, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        const next = { ...current, evidence: [...current.evidence, normalized] };
        return this.update(current, next, 'task.evidence', { evidenceId: normalized.evidenceId }, requestId);
    }
    /** Change criteria after explicit rework; old reviews then remain historical. */
    setAcceptance(taskId, criteria, expectedRevision, requestId) {
        const normalized = this.normalizeCriteria(criteria);
        const replay = this.beginRequest(requestId, { operation: 'criteria', taskId, criteria: normalized, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.delivery !== undefined)
            throw new ProtocolError('delivered task criteria cannot change', 'INVALID_TRANSITION');
        if (current.status === 'running' || current.status === 'queued')
            throw new ProtocolError('running task criteria cannot change', 'INVALID_TRANSITION');
        if (currentSubmission(current) !== undefined)
            throw new ProtocolError('return the current submission before changing criteria', 'INVALID_TRANSITION');
        if (stableStringify(current.criteria) === stableStringify(normalized))
            return this.noop(requestId, current);
        const next = {
            ...current,
            criteria: normalized,
            acceptance: [...normalized.checks],
            status: 'created',
            state: this.dependenciesSatisfied(current) ? 'ready' : 'pending',
            stage: 'pending',
            result: undefined,
            artifacts: [],
        };
        return this.update(current, next, 'task.criteria_changed', { criteriaChanged: true }, requestId);
    }
    /** Delete a task while retaining a tombstone in the event stream. */
    deleteTask(taskId, expectedRevision, requestId) {
        const replay = this.beginRequest(requestId, { operation: 'delete', taskId, expectedRevision });
        if (replay !== undefined)
            return replay;
        const current = this.require(taskId);
        this.expectRevision(current, expectedRevision);
        if (current.deleted)
            return this.noop(requestId, current);
        if (current.status === 'running' || current.status === 'queued')
            throw new ProtocolError('running task must be stopped before deletion', 'INVALID_TRANSITION');
        if (current.delivery !== undefined)
            throw new ProtocolError('delivered task cannot be deleted', 'INVALID_TRANSITION');
        const dependent = [...this.records.values()].find(candidate => !candidate.deleted && candidate.dependencies.some(dependency => dependency.taskId === current.taskId));
        if (dependent !== undefined)
            throw new ProtocolError(`task ${current.taskId} still blocks ${dependent.taskId}`, 'TASK_HAS_DEPENDENTS');
        const next = { ...current, deleted: true, status: 'cancelled', state: 'cancelled', stage: 'deleted' };
        return this.update(current, next, 'task.deleted', {}, requestId);
    }
    /** Restore one persisted snapshot without replaying a model/tool side effect. */
    restoreTask(snapshot, requestId) {
        validateTaskRecord(snapshot);
        const replay = this.beginRequest(requestId, { operation: 'restore', snapshot });
        if (replay !== undefined)
            return replay;
        if (this.records.has(snapshot.taskId))
            throw new ProtocolError(`task ${snapshot.taskId} is already present`, 'TASK_DUPLICATE');
        let restored = detached(snapshot);
        if (restored.status === 'running' || restored.status === 'queued' || restored.stage === 'stopping') {
            const now = this.now();
            const attemptHistory = restored.attemptId === undefined
                ? restored.attemptHistory
                : replaceAttempt(restored.attemptHistory, restored.attemptId, attempt => ({ ...attempt, outcome: 'stop_unknown', endedAt: now }));
            const cancellation = restored.cancellation ?? { requestId: `restore-${this.makeId('request')}`, reason: 'active attempt was restored without stop evidence', requestedAt: now, outcome: 'unknown' };
            restored = { ...restored, status: 'failed', state: 'failed', stage: 'stop_unknown', attemptHistory, cancellation: { ...cancellation, outcome: 'unknown' } };
        }
        this.records.set(restored.taskId, restored);
        try {
            this.validateGraph();
        }
        catch (error) {
            this.records.delete(restored.taskId);
            throw error;
        }
        const eventTask = { ...restored, revision: restored.revision + 1, updatedAt: this.now() };
        this.records.set(eventTask.taskId, eventTask);
        return this.commit(restored, eventTask, 'task.restored', { operation: 'restore' }, requestId);
    }
    /** Explain every dependency and its accepted version binding. */
    dependencyStatus(taskId) {
        const task = this.require(taskId);
        return task.dependencies.map(dependency => {
            const upstream = this.records.get(dependency.taskId);
            if (upstream === undefined || upstream.deleted)
                return { taskId: dependency.taskId, satisfied: false, reason: 'dependency is missing or deleted', stage: 'deleted', status: 'cancelled' };
            const accepted = acceptedSubmission(upstream);
            const boundMatches = dependency.acceptedSubmissionId === undefined
                || accepted?.submissionId === dependency.acceptedSubmissionId && accepted.artifactDigest === dependency.acceptedArtifactDigest;
            const satisfied = accepted !== undefined && boundMatches;
            return {
                taskId: dependency.taskId,
                satisfied,
                reason: satisfied ? '' : accepted === undefined ? `dependency is ${upstream.stage}` : 'dependency accepted version changed',
                stage: upstream.stage,
                status: upstream.status,
                ...accepted === undefined ? {} : { acceptedSubmissionId: accepted.submissionId, acceptedArtifactDigest: accepted.artifactDigest },
            };
        });
    }
    /** Wait for a committed event rather than polling task state. */
    waitForChange(afterSequence = this.version, timeoutMs = 30_000, signal) {
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
            return Promise.reject(new ProtocolError('afterSequence must be a non-negative safe integer', 'INVALID_ARGUMENT'));
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
            return Promise.reject(new ProtocolError('timeoutMs must be a non-negative finite number', 'INVALID_ARGUMENT'));
        if (this.version > afterSequence)
            return Promise.resolve({ timedOut: false, sequence: this.version, events: this.eventsSince(afterSequence) });
        if (signal?.aborted)
            return Promise.reject(signal.reason ?? new ProtocolError('wait aborted', 'WAIT_ABORTED'));
        if (timeoutMs === 0)
            return Promise.resolve({ timedOut: true, sequence: this.version, events: [] });
        return new Promise((resolve, reject) => {
            const waiter = { after: afterSequence, resolve, reject, timer: undefined, signal, onAbort: undefined };
            const timer = setTimeout(() => {
                this.waiters.delete(waiter);
                if (waiter.onAbort !== undefined)
                    signal?.removeEventListener('abort', waiter.onAbort);
                resolve({ timedOut: true, sequence: this.version, events: [] });
            }, timeoutMs);
            const onAbort = () => {
                clearTimeout(timer);
                this.waiters.delete(waiter);
                signal?.removeEventListener('abort', onAbort);
                reject(signal?.reason ?? new ProtocolError('wait aborted', 'WAIT_ABORTED'));
            };
            Object.assign(waiter, { timer, onAbort });
            signal?.addEventListener('abort', onAbort, { once: true });
            this.waiters.add(waiter);
        });
    }
    /** Replay events into this graph; duplicate event IDs are idempotent. */
    replay(events) {
        this.transaction(() => {
            for (const raw of events) {
                const event = detached(raw);
                validateEvent(event);
                if (!TASK_EVENT_TYPES.includes(event.type))
                    throw new ProtocolError(`unknown task event type ${event.type}`, 'INVALID_EVENT');
                const known = this.log.find(candidate => candidate.eventId === event.eventId);
                if (known !== undefined) {
                    if (stableStringify(known) !== stableStringify(event))
                        throw new ProtocolError(`event ${event.eventId} conflicts with existing event`, 'EVENT_CONFLICT');
                    continue;
                }
                if (event.sequence !== this.log.length + 1)
                    throw new ProtocolError(`event sequence ${event.sequence} is not contiguous`, 'EVENT_SEQUENCE');
                const prior = this.records.get(event.taskId);
                if (prior === undefined && event.type !== 'task.created' && event.type !== 'task.restored')
                    throw new ProtocolError(`event ${event.type} has no task predecessor`, 'INVALID_EVENT');
                if (prior !== undefined && event.revision !== prior.revision + 1)
                    throw new ProtocolError(`task ${event.taskId} revision is not contiguous`, 'EVENT_REVISION');
                if (prior === undefined && event.revision !== 1 && event.type === 'task.created')
                    throw new ProtocolError('created task must start at revision one', 'EVENT_REVISION');
                this.assertReplayTransition(prior, event);
                this.records.set(event.taskId, detached(event.task));
                this.validateGraph();
                this.log.push(event);
                if (event.requestId !== undefined) {
                    const fingerprint = typeof event.data.requestFingerprint === 'string' ? event.data.requestFingerprint : stableStringify(event.data);
                    this.requests.set(event.requestId, { fingerprint, result: detached(event.task) });
                }
            }
        });
    }
    appendInitial(task) {
        const event = {
            version: 1,
            sequence: this.log.length + 1,
            eventId: this.makeId('event'),
            type: 'task.created',
            taskId: task.taskId,
            revision: task.revision,
            at: task.createdAt,
            task: detached(task),
            data: { operation: 'create' },
        };
        validateEvent(event);
        this.log.push(event);
    }
    /** Reject a forged replay snapshot that skips or revives a lifecycle stage. */
    assertReplayTransition(previous, event) {
        if (previous === undefined) {
            if (event.type !== 'task.created' && event.type !== 'task.restored')
                throw new ProtocolError(`event ${event.type} cannot create a task`, 'INVALID_EVENT');
            return;
        }
        const next = event.task;
        const fail = (message) => { throw new ProtocolError(message, 'INVALID_EVENT'); };
        const same = (left, right) => stableStringify(left) === stableStringify(right);
        const prefixUnchanged = (left, right) => same(left, right.slice(0, left.length));
        const latestAttempt = (task) => task.attemptHistory[task.attemptHistory.length - 1];
        const previousLatest = latestAttempt(previous);
        const nextLatest = latestAttempt(next);
        const currentSubmission = (task) => task.attemptId === undefined
            ? undefined
            : [...task.submissions].reverse().find(submission => submission.attemptId === task.attemptId);
        switch (event.type) {
            case 'task.assigned':
                if (!['created', 'queued'].includes(previous.status) || next.status !== 'queued' || next.stage !== 'queued' || next.state !== 'ready')
                    fail('assignment must move a pending task to queued');
                if (next.owner === undefined || next.assignmentHistory.length !== previous.assignmentHistory.length + 1 || !prefixUnchanged(previous.assignmentHistory, next.assignmentHistory))
                    fail('assignment must append one owner record');
                if (next.assignmentHistory.at(-1)?.owner !== next.owner)
                    fail('assignment owner must match task owner');
                break;
            case 'task.started':
                if (!['created', 'queued'].includes(previous.status) || next.status !== 'running' || next.stage !== 'working' || next.state !== 'running' || next.attempts !== previous.attempts + 1)
                    fail('start must create exactly one attempt');
                if (next.attemptHistory.length !== previous.attemptHistory.length + 1 || !prefixUnchanged(previous.attemptHistory, next.attemptHistory) || nextLatest?.outcome !== 'running' || next.attemptId !== nextLatest?.attemptId || event.data.attemptId !== next.attemptId)
                    fail('start must append the active attempt');
                if (next.cancellation !== undefined || next.result !== undefined || next.artifacts.length !== 0)
                    fail('start must clear execution payload and cancellation');
                break;
            case 'task.completed':
                if (previous.status !== 'running' || next.status !== 'completed' || next.stage !== 'needs_attention' || next.state !== 'succeeded')
                    fail('completion must end a running attempt');
                if (previousLatest === undefined || nextLatest === undefined || previousLatest.attemptId !== nextLatest.attemptId || previousLatest.outcome !== 'running' || nextLatest.outcome !== 'completed' || next.attemptId !== previous.attemptId)
                    fail('completion must close the active attempt');
                if (next.attemptHistory.length !== previous.attemptHistory.length || !same(next.attemptHistory.slice(0, -1), previous.attemptHistory.slice(0, -1)))
                    fail('completion cannot rewrite attempt history');
                if (event.data.attemptId !== next.attemptId || event.data.artifactDigest !== artifactDigest(next.artifacts))
                    fail('completion evidence does not match the snapshot');
                break;
            case 'task.failed':
                if (previous.status !== 'running' || next.status !== 'failed' || next.stage !== 'needs_attention' || next.state !== 'failed')
                    fail('failure must end a running attempt');
                if (previousLatest === undefined || nextLatest === undefined || previousLatest.attemptId !== nextLatest.attemptId || previousLatest.outcome !== 'running' || nextLatest.outcome !== 'failed' || next.attemptId !== previous.attemptId)
                    fail('failure must close the active attempt');
                break;
            case 'task.submitted':
                if (previous.status !== 'completed' || next.stage !== 'awaiting_review' || next.state !== 'waiting' || next.submissions.length !== previous.submissions.length + 1 || !prefixUnchanged(previous.submissions, next.submissions))
                    fail('submission requires completed execution');
                if (currentSubmission(next) === undefined || currentSubmission(next)?.submissionId !== event.data.submissionId || currentSubmission(next)?.attemptId !== next.attemptId)
                    fail('submission must append the current attempt');
                break;
            case 'task.review.finding':
                if (previous.stage !== 'awaiting_review' && previous.stage !== 'needs_attention')
                    fail('review requires a submitted attempt');
                if (next.submissions.length !== previous.submissions.length || currentSubmission(previous) === undefined || currentSubmission(next) === undefined)
                    fail('finding requires the current submission');
                if (currentSubmission(next).findings.length !== currentSubmission(previous).findings.length + 1 || !prefixUnchanged(currentSubmission(previous).findings, currentSubmission(next).findings) || event.data.findingId !== currentSubmission(next).findings.at(-1)?.findingId)
                    fail('finding must append exactly one record');
                break;
            case 'task.reviewed':
                if (previous.stage !== 'awaiting_review' && previous.stage !== 'needs_attention')
                    fail('review requires a submitted attempt');
                if (next.submissions.length !== previous.submissions.length || currentSubmission(previous) === undefined || currentSubmission(next) === undefined)
                    fail('review requires the current submission');
                if (currentSubmission(next).reviews.length !== currentSubmission(previous).reviews.length + 1 || !prefixUnchanged(currentSubmission(previous).reviews, currentSubmission(next).reviews) || event.data.reviewId !== currentSubmission(next).reviews.at(-1)?.reviewId || event.data.outcome !== currentSubmission(next).reviews.at(-1)?.outcome)
                    fail('review must append exactly one conclusion');
                if (next.status !== 'completed' || next.state !== 'waiting' || !['awaiting_review', 'needs_attention'].includes(next.stage))
                    fail('review must keep the task awaiting review');
                break;
            case 'task.accepted':
                if (previous.status !== 'completed' || (previous.stage !== 'awaiting_review' && previous.stage !== 'needs_attention') || next.stage !== 'accepted' || next.state !== 'succeeded' || next.status !== 'completed')
                    fail('acceptance requires completed review');
                if (currentSubmission(next) === undefined || event.data.submissionId !== currentSubmission(next)?.submissionId || !currentSubmission(next).reviews.some(review => review.outcome === 'passed'))
                    fail('acceptance must reference a passed current submission');
                break;
            case 'task.criteria_changed':
                if (previous.status === 'running' || previous.status === 'queued' || next.status !== 'created' || next.stage !== 'pending' || next.attemptId !== undefined || next.result !== undefined || next.artifacts.length !== 0)
                    fail('criteria changes require a reset pending task');
                if (currentSubmission(previous) !== undefined || same(previous.criteria, next.criteria))
                    fail('criteria change must replace criteria without a current submission');
                break;
            case 'task.returned':
                if (!['completed', 'failed'].includes(previous.status) || next.status !== 'created' || next.stage !== 'pending' || next.attemptId !== undefined || next.result !== undefined || next.artifacts.length !== 0 || next.cancellation !== undefined)
                    fail('rework must close the old attempt');
                if (next.attempts !== previous.attempts || !same(next.attemptHistory, previous.attemptHistory) || next.returnReasons.length !== previous.returnReasons.length + 1 || !prefixUnchanged(previous.returnReasons, next.returnReasons))
                    fail('rework must preserve history and append a reason');
                break;
            case 'task.cancel_requested':
                if (!['created', 'queued', 'running'].includes(previous.status) || next.status !== previous.status || next.stage !== 'stopping' || next.cancellation?.outcome !== 'requested')
                    fail('cancellation request requires active work');
                if (previous.cancellation !== undefined || !same({ ...previous, stage: next.stage, cancellation: next.cancellation, revision: next.revision, updatedAt: next.updatedAt }, { ...next }))
                    fail('cancellation request must only add stopping state');
                break;
            case 'task.cancelled':
                if (previous.cancellation?.outcome !== 'requested' || next.status !== 'cancelled' || next.stage !== 'stopped' || next.state !== 'cancelled' || next.cancellation?.outcome !== 'confirmed')
                    fail('cancellation confirmation requires a request');
                if (previous.attemptId === undefined && next.attemptHistory.length !== previous.attemptHistory.length)
                    fail('unstarted cancellation cannot create an attempt');
                if (previous.attemptId !== undefined && (next.attemptId !== previous.attemptId || nextLatest?.outcome !== 'cancelled'))
                    fail('cancellation confirmation must close the active attempt');
                break;
            case 'task.stop_unknown':
                if ((previous.cancellation !== undefined && previous.cancellation.outcome !== 'requested' && previous.cancellation.outcome !== 'unknown') || (previous.cancellation === undefined && previous.status !== 'running') || next.status !== 'failed' || next.stage !== 'stop_unknown' || next.state !== 'failed' || next.cancellation?.outcome !== 'unknown')
                    fail('stop-unknown requires an active or requested attempt');
                if (previous.attemptId !== undefined && (next.attemptId !== previous.attemptId || nextLatest?.outcome !== 'stop_unknown'))
                    fail('stop-unknown must close the active attempt');
                if (next.result !== undefined || next.artifacts.length !== 0)
                    fail('stop-unknown cannot retain execution payload');
                break;
            case 'task.delivered':
                if (previous.stage !== 'accepted' || next.stage !== 'delivered' || next.delivery === undefined || next.status !== 'completed' || next.state !== 'succeeded')
                    fail('delivery requires acceptance');
                {
                    const delivery = next.delivery;
                    if (delivery === undefined || delivery.submissionId !== event.data.submissionId || delivery.deliveryId !== event.data.deliveryId)
                        fail('delivery evidence does not match the snapshot');
                }
                break;
            case 'task.deleted':
                if (previous.status === 'running' || previous.status === 'queued' || previous.delivery !== undefined || !next.deleted || next.status !== 'cancelled' || next.stage !== 'deleted' || next.state !== 'cancelled')
                    fail('deletion requires a stopped task');
                break;
            case 'task.evidence':
                if (next.evidence.length !== previous.evidence.length + 1 || !prefixUnchanged(previous.evidence, next.evidence) || event.data.evidenceId !== next.evidence.at(-1)?.evidenceId)
                    fail('evidence event must append one evidence record');
                break;
            case 'task.restored':
                fail('restored event cannot follow an existing task');
            case 'task.created':
                fail('created event cannot follow an existing task');
        }
    }
    activeCount() {
        return [...this.records.values()].filter(task => !task.deleted).length;
    }
    require(taskId) {
        const normalized = text(taskId, 'taskId');
        const task = this.records.get(normalized);
        if (task === undefined)
            throw new ProtocolError(`unknown task ${normalized}`, 'TASK_NOT_FOUND');
        return task;
    }
    expectRevision(task, expectedRevision) {
        if (expectedRevision !== undefined && task.revision !== expectedRevision)
            throw new ProtocolError(`stale task ${task.taskId} revision ${expectedRevision}; current revision is ${task.revision}`, 'TASK_STALE_REVISION');
    }
    assertStartable(task) {
        if (task.deleted || task.status === 'cancelled')
            throw new ProtocolError('cancelled or deleted task cannot start', 'INVALID_TRANSITION');
        if (task.status !== 'created' && task.status !== 'queued')
            throw new ProtocolError(`task ${task.taskId} is not pending`, 'INVALID_TRANSITION');
        if (task.cancellation !== undefined)
            throw new ProtocolError('task has a cancellation request', 'CANCELLATION_PENDING');
        if (!this.dependenciesSatisfied(task)) {
            const blocked = this.dependencyStatus(task.taskId).filter(item => !item.satisfied).map(item => item.taskId);
            throw new ProtocolError(`dependency is not accepted yet: ${blocked.join(', ')}`, 'TASK_DEPENDENCY_BLOCKED');
        }
    }
    assertAttemptRunning(task, attemptId) {
        if (task.status !== 'running' || task.attemptId !== text(attemptId, 'attemptId'))
            throw new ProtocolError(`attempt ${attemptId} is not running`, 'ATTEMPT_NOT_RUNNING');
        const attempt = task.attemptHistory.find(candidate => candidate.attemptId === attemptId);
        if (attempt?.outcome !== 'running')
            throw new ProtocolError(`attempt ${attemptId} is already terminal`, 'ATTEMPT_NOT_RUNNING');
    }
    startFrom(task, requestId, ownerOverride) {
        const owner = ownerOverride ?? task.owner;
        const attemptId = this.makeId('attempt');
        const now = this.now();
        const attempt = { attemptId, number: task.attempts + 1, ...owner === undefined ? {} : { owner }, startedAt: now, outcome: 'running' };
        const dependencies = task.dependencies.map(dependency => {
            const upstream = this.require(dependency.taskId);
            const accepted = acceptedSubmission(upstream);
            if (accepted === undefined)
                throw new ProtocolError(`dependency ${dependency.taskId} is no longer accepted`, 'TASK_DEPENDENCY_BLOCKED');
            return { ...dependency, acceptedSubmissionId: accepted.submissionId, acceptedArtifactDigest: accepted.artifactDigest };
        });
        const next = {
            ...task,
            ...owner === undefined ? {} : { owner },
            dependencies,
            status: 'running',
            state: 'running',
            stage: 'working',
            attempts: task.attempts + 1,
            attemptId,
            attemptHistory: [...task.attemptHistory, attempt],
            result: undefined,
            artifacts: [],
            cancellation: undefined,
        };
        return this.update(task, next, 'task.started', { attemptId, owner: owner ?? '' }, requestId);
    }
    update(previous, next, type, data, requestId) {
        const committed = {
            ...next,
            revision: previous.revision + 1,
            updatedAt: this.now(),
            state: next.state,
        };
        return this.commit(previous, committed, type, data, requestId);
    }
    commit(previous, task, type, data, requestId) {
        validateTaskRecord(task);
        if (previous !== undefined && task.revision !== previous.revision + 1)
            throw new ProtocolError(`task ${task.taskId} revision must increase by one`, 'EVENT_REVISION');
        if (previous === undefined && task.revision !== 1 && type === 'task.created')
            throw new ProtocolError('created task must start at revision one', 'EVENT_REVISION');
        const fingerprint = requestId === undefined
            ? undefined
            : this.pendingRequests.get(requestId) ?? stableStringify({ operation: type, taskId: task.taskId, data });
        const eventData = {
            ...data,
            ...fingerprint === undefined ? {} : { requestFingerprint: fingerprint },
        };
        const event = {
            version: 1,
            sequence: this.log.length + 1,
            eventId: this.makeId('event'),
            type,
            taskId: task.taskId,
            revision: task.revision,
            at: task.updatedAt,
            ...requestId === undefined ? {} : { requestId },
            task: detached(task),
            data: objectValue(eventData, 'event.data'),
        };
        validateEvent(event);
        this.records.set(task.taskId, detached(task));
        this.log.push(event);
        if (requestId !== undefined && fingerprint !== undefined)
            this.requests.set(requestId, { fingerprint, result: detached(task) });
        if (requestId !== undefined)
            this.pendingRequests.delete(requestId);
        this.notifyPending = true;
        if (this.transactionDepth === 0)
            this.notifyWaiters();
        return detached(task);
    }
    beginRequest(requestId, payload) {
        if (requestId === undefined)
            return undefined;
        const id = text(requestId, 'requestId');
        const fingerprint = stableStringify(payload);
        const prior = this.requests.get(id);
        if (prior === undefined) {
            this.pendingRequests.set(id, fingerprint);
            // Public commands are synchronous, but validation can fail before a
            // commit removes this reservation. Schedule a bounded cleanup so a
            // rejected request cannot accumulate forever in a long-lived workspace.
            queueMicrotask(() => {
                if (this.pendingRequests.get(id) === fingerprint)
                    this.pendingRequests.delete(id);
            });
            return undefined;
        }
        if (prior.fingerprint !== fingerprint)
            throw new ProtocolError(`request ID ${id} was reused with different content`, 'REQUEST_ID_CONFLICT');
        return detached(prior.result);
    }
    /** Commit an idempotent no-op result without inventing a second event. */
    noop(requestId, task) {
        if (requestId !== undefined) {
            const id = text(requestId, 'requestId');
            const fingerprint = this.pendingRequests.get(id);
            if (fingerprint !== undefined)
                this.requests.set(id, { fingerprint, result: detached(task) });
            this.pendingRequests.delete(id);
        }
        return detached(task);
    }
    transaction(operation) {
        const records = new Map(this.records);
        const logLength = this.log.length;
        const requestEntries = new Map(this.requests);
        const pendingEntries = new Map(this.pendingRequests);
        this.transactionDepth++;
        try {
            const result = operation();
            this.transactionDepth--;
            if (this.transactionDepth === 0 && this.notifyPending)
                this.notifyWaiters();
            return result;
        }
        catch (error) {
            this.transactionDepth--;
            this.records.clear();
            for (const [key, value] of records)
                this.records.set(key, value);
            this.log.splice(logLength);
            this.requests.clear();
            for (const [key, value] of requestEntries)
                this.requests.set(key, value);
            this.pendingRequests.clear();
            for (const [key, value] of pendingEntries)
                this.pendingRequests.set(key, value);
            this.notifyPending = false;
            throw error;
        }
    }
    notifyWaiters() {
        this.notifyPending = false;
        if (this.waiters.size === 0)
            return;
        for (const waiter of [...this.waiters]) {
            if (this.log.length <= waiter.after)
                continue;
            this.waiters.delete(waiter);
            if (waiter.timer !== undefined)
                clearTimeout(waiter.timer);
            if (waiter.signal !== undefined && waiter.onAbort !== undefined)
                waiter.signal.removeEventListener('abort', waiter.onAbort);
            waiter.resolve({ timedOut: false, sequence: this.log.length, events: this.eventsSince(waiter.after) });
        }
    }
    validateGraph() {
        for (const task of this.records.values()) {
            validateTaskRecord(task);
            for (const dependency of task.dependencies) {
                if (!this.records.has(dependency.taskId))
                    throw new ProtocolError(`unknown dependency ${dependency.taskId}`, 'TASK_DEPENDENCY_NOT_FOUND');
            }
        }
        const visit = (id, path, depth) => {
            if (depth > this.options.maxDepth)
                throw new ProtocolError(`task graph exceeds depth ${this.options.maxDepth}`, 'TASK_GRAPH_DEPTH');
            if (path.has(id))
                throw new ProtocolError(`task graph cycle at ${id}`, 'TASK_DEPENDENCY_CYCLE');
            const next = new Set(path).add(id);
            for (const dependency of this.require(id).dependencies)
                visit(dependency.taskId, next, depth + 1);
        };
        for (const task of this.records.values())
            visit(task.taskId, new Set(), 0);
    }
    dependenciesSatisfied(task) {
        return this.dependencyStatus(task.taskId).every(dependency => dependency.satisfied);
    }
    replaceSubmission(task, submission) {
        return { ...task, submissions: task.submissions.map(existing => existing.submissionId === submission.submissionId ? submission : existing) };
    }
    confirmCancellationInternal(task, options, requestId) {
        if (task.cancellation === undefined)
            throw new ProtocolError('task has no cancellation request', 'CANCELLATION_REQUIRED');
        if (task.cancellation.outcome !== 'requested')
            throw new ProtocolError('task cancellation is already terminal', 'CANCELLATION_DUPLICATE');
        if (!activeStatus(task.status) || task.deleted)
            throw new ProtocolError('only active work can be cancellation-confirmed', 'INVALID_TRANSITION');
        const now = this.now();
        const attemptId = task.attemptId;
        const history = attemptId === undefined || task.status !== 'running'
            ? task.attemptHistory
            : replaceAttempt(task.attemptHistory, attemptId, attempt => ({ ...attempt, outcome: 'cancelled', endedAt: now }));
        const cancellation = { ...task.cancellation, confirmedAt: now, evidence: options.evidence === undefined ? task.cancellation.evidence : objectValue(options.evidence, 'evidence'), outcome: 'confirmed' };
        const next = { ...task, status: 'cancelled', state: 'cancelled', stage: 'stopped', cancellation, attemptHistory: history };
        return this.update(task, next, 'task.cancelled', { reason: options.reason ?? task.cancellation.reason, ...options.evidence === undefined ? {} : { evidence: options.evidence } }, requestId);
    }
    markStopUnknownInternal(task, reason, evidence, requestId) {
        const now = this.now();
        const attemptId = task.attemptId;
        const history = attemptId === undefined
            ? task.attemptHistory
            : replaceAttempt(task.attemptHistory, attemptId, attempt => ({ ...attempt, outcome: 'stop_unknown', endedAt: now, error: { name: 'StopUnknown', message: reason } }));
        const cancellation = task.cancellation === undefined
            ? { requestId: `unknown-${this.makeId('request')}`, reason, requestedAt: now, outcome: 'unknown' }
            : { ...task.cancellation, outcome: 'unknown', confirmedAt: undefined, evidence: evidence === undefined ? task.cancellation.evidence : objectValue(evidence, 'evidence') };
        const next = { ...task, status: 'failed', state: 'failed', stage: 'stop_unknown', cancellation, attemptHistory: history, result: undefined };
        return this.update(task, next, 'task.stop_unknown', { reason, ...evidence === undefined ? {} : { evidence } }, requestId);
    }
    normalizeFinding(finding) {
        const summary = text(finding.summary, 'finding.summary');
        const reviewerId = text(finding.reviewerId, 'finding.reviewerId');
        const findingId = text(finding.findingId, 'finding.findingId');
        return {
            findingId,
            reviewerId,
            summary,
            ...finding.artifactId === undefined ? {} : { artifactId: text(finding.artifactId, 'finding.artifactId') },
            ...finding.location === undefined ? {} : { location: text(finding.location, 'finding.location') },
            ...finding.severity === undefined ? {} : { severity: finding.severity },
        };
    }
    normalizeReview(review) {
        const reviewerId = text(review.reviewerId, 'review.reviewerId');
        const reviewId = text(review.reviewId, 'review.reviewId');
        if (!['passed', 'failed', 'unverified', 'stale'].includes(review.outcome))
            throw new ProtocolError(`unknown review outcome ${String(review.outcome)}`, 'INVALID_ARGUMENT');
        return {
            reviewId,
            reviewerId,
            independent: review.independent === true,
            outcome: review.outcome,
            report: objectValue(review.report, 'review.report'),
            findings: review.findings.map(finding => this.normalizeFinding(finding)),
            reviewedAt: timestamp(review.reviewedAt),
        };
    }
    normalizeCriteria(criteria) {
        const name = text(criteria.name, 'criteria.name');
        const version = text(criteria.version, 'criteria.version');
        const checks = criteria.checks.map((check, index) => text(check, `criteria.checks[${index}]`));
        if (checks.length === 0)
            throw new ProtocolError('criteria.checks must not be empty', 'INVALID_ARGUMENT');
        return { name, version, checks: [...new Set(checks)] };
    }
    normalizeEvidence(taskId, evidence) {
        const evidenceId = text(evidence.evidenceId, 'evidenceId');
        return {
            evidenceId,
            taskId,
            kind: evidence.kind,
            summary: text(evidence.summary, 'evidence.summary'),
            ...evidence.ref === undefined ? {} : { ref: text(evidence.ref, 'evidence.ref') },
            ...evidence.digest === undefined ? {} : { digest: text(evidence.digest, 'evidence.digest') },
            recordedAt: evidence.recordedAt === undefined ? this.now() : timestamp(evidence.recordedAt),
        };
    }
    now() {
        return timestamp(this.options.clock?.() ?? new Date().toISOString());
    }
    makeId(prefix) {
        const value = this.options.idFactory?.() ?? randomUUID();
        return `${prefix}-${text(value, 'id')}`;
    }
}
export default TaskGraph;
//# sourceMappingURL=task-graph.js.map