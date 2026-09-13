import { createHash } from 'node:crypto';
/** Execution facts retained for compatibility with the first protocol draft. */
export const TASK_STATES = [
    'pending',
    'ready',
    'running',
    'waiting',
    'succeeded',
    'failed',
    'cancelled',
];
/** Canonical execution status. A completed run still needs review and delivery. */
export const TASK_STATUSES = ['created', 'queued', 'running', 'completed', 'failed', 'cancelled'];
/** Business stage kept separate from execution status. */
export const TASK_STAGES = [
    'pending',
    'queued',
    'working',
    'awaiting_review',
    'needs_attention',
    'accepted',
    'delivered',
    'stopping',
    'stopped',
    'stop_unknown',
    'deleted',
];
/** Runtime event-type allowlist shared by encoding, validation, and replay. */
export const TASK_EVENT_TYPES = [
    'task.created',
    'task.assigned',
    'task.queued',
    'task.started',
    'task.completed',
    'task.failed',
    'task.submitted',
    'task.review.finding',
    'task.evidence',
    'task.reviewed',
    'task.accepted',
    'task.criteria_changed',
    'task.returned',
    'task.cancel_requested',
    'task.cancelled',
    'task.stop_unknown',
    'task.delivered',
    'task.deleted',
    'task.restored',
];
/** Structured protocol failure with a stable machine-readable code. */
export class ProtocolError extends Error {
    code;
    constructor(message, code = 'PROTOCOL_ERROR') {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
    }
}
/** Return a detached lossless JSON value or throw at a persistence boundary. */
export function toJsonValue(value, path = '$') {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new ProtocolError(`${path} must contain a finite number`, 'INVALID_JSON');
        return value;
    }
    if (Array.isArray(value))
        return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
    if (typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined)
                continue;
            output[key] = toJsonValue(item, `${path}.${key}`);
        }
        return output;
    }
    throw new ProtocolError(`${path} is not lossless JSON`, 'INVALID_JSON');
}
/** Clone a protocol value through the same JSON validation used for persistence. */
export function cloneJson(value) {
    return toJsonValue(value);
}
function requiredText(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
    }
    return value.trim();
}
function isoNow() {
    return new Date().toISOString();
}
function validTimestamp(value, field) {
    if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
        throw new ProtocolError(`${field} must be an ISO timestamp`, 'INVALID_ARGUMENT');
    }
    return value;
}
function normalizeCriteria(input) {
    const candidate = input.criteria ?? (input.acceptance && !Array.isArray(input.acceptance) ? input.acceptance : undefined);
    if (candidate !== undefined) {
        const criteria = candidate;
        const name = requiredText(criteria.name, 'criteria.name');
        const version = requiredText(criteria.version, 'criteria.version');
        const checks = criteria.checks.map((check, index) => requiredText(check, `criteria.checks[${index}]`));
        if (checks.length === 0)
            throw new ProtocolError('criteria.checks must not be empty', 'INVALID_ARGUMENT');
        return { name, version, checks: [...new Set(checks)] };
    }
    const checks = Array.isArray(input.acceptance)
        ? input.acceptance.map((check, index) => requiredText(check, `acceptance[${index}]`))
        : [];
    return { name: 'default', version: '1', checks: [...new Set(checks)] };
}
function normalizeDependencies(input) {
    const result = [];
    const seen = new Set();
    for (const raw of input.dependencies ?? []) {
        const dependency = typeof raw === 'string' ? { taskId: raw } : raw;
        const taskId = requiredText(dependency.taskId, 'dependency.taskId');
        if (taskId === input.taskId)
            throw new ProtocolError('task cannot depend on itself', 'TASK_DEPENDENCY_CYCLE');
        if (seen.has(taskId))
            throw new ProtocolError(`duplicate dependency ${taskId}`, 'INVALID_ARGUMENT');
        seen.add(taskId);
        result.push({
            taskId,
            ...dependency.acceptedSubmissionId === undefined ? {} : { acceptedSubmissionId: requiredText(dependency.acceptedSubmissionId, 'acceptedSubmissionId') },
            ...dependency.acceptedArtifactDigest === undefined ? {} : { acceptedArtifactDigest: requiredText(dependency.acceptedArtifactDigest, 'acceptedArtifactDigest') },
        });
    }
    return result;
}
function stateFor(status, stage, ready = false) {
    if (status === 'running')
        return stage === 'awaiting_review' ? 'waiting' : 'running';
    if (status === 'completed')
        return 'succeeded';
    if (status === 'failed')
        return 'failed';
    if (status === 'cancelled')
        return 'cancelled';
    return ready ? 'ready' : 'pending';
}
/** Derive the legacy state projection from canonical status and business stage. */
export function taskStateFor(status, stage, ready = false) {
    return stateFor(status, stage, ready);
}
/** Build a revision-one task with no external side effects. */
export function createTask(input) {
    const taskId = requiredText(input.taskId, 'taskId');
    const title = requiredText(input.title, 'title');
    const dependencies = normalizeDependencies({ ...input, taskId });
    const criteria = normalizeCriteria(input);
    const now = input.now === undefined ? isoNow() : validTimestamp(input.now, 'now');
    return {
        taskId,
        title,
        ...input.owner === undefined ? {} : { owner: requiredText(input.owner, 'owner') },
        dependencies,
        acceptance: [...criteria.checks],
        criteria,
        status: 'created',
        state: stateFor('created', 'pending', dependencies.length === 0),
        stage: 'pending',
        revision: 1,
        attempts: 0,
        attemptHistory: [],
        assignmentHistory: input.owner === undefined ? [] : [{ owner: requiredText(input.owner, 'owner'), assignedAt: now }],
        returnReasons: [],
        artifacts: [],
        submissions: [],
        evidence: [],
        deleted: false,
        createdAt: now,
        updatedAt: now,
    };
}
function snapshotFailure(message) {
    throw new ProtocolError(message, 'INVALID_SNAPSHOT');
}
function eventFailure(message) {
    throw new ProtocolError(message, 'INVALID_EVENT');
}
function snapshotRecord(value, field) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        snapshotFailure(`${field} must be an object`);
    return value;
}
function snapshotText(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        snapshotFailure(`${field} must be a non-empty string`);
    return value.trim();
}
function snapshotTimestamp(value, field) {
    if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value)))
        snapshotFailure(`${field} must be an ISO timestamp`);
    return value;
}
function snapshotJson(value, field) {
    try {
        toJsonValue(value, field);
    }
    catch (error) {
        if (error instanceof ProtocolError)
            snapshotFailure(`${field} is not lossless JSON: ${error.message}`);
        snapshotFailure(`${field} is not lossless JSON`);
    }
}
function snapshotCriteria(value, field) {
    const criteria = snapshotRecord(value, field);
    snapshotText(criteria.name, `${field}.name`);
    snapshotText(criteria.version, `${field}.version`);
    if (!Array.isArray(criteria.checks))
        snapshotFailure(`${field}.checks must be an array`);
    const checks = criteria.checks.map((check, index) => snapshotText(check, `${field}.checks[${index}]`));
    if (new Set(checks).size !== checks.length)
        snapshotFailure(`${field}.checks must not contain duplicates`);
}
function snapshotDependency(value, taskId, index) {
    const dependency = snapshotRecord(value, `task.dependencies[${index}]`);
    const dependencyId = snapshotText(dependency.taskId, `task.dependencies[${index}].taskId`);
    if (dependencyId === taskId)
        snapshotFailure('task cannot depend on itself');
    const submission = dependency.acceptedSubmissionId;
    const digest = dependency.acceptedArtifactDigest;
    if ((submission === undefined) !== (digest === undefined))
        snapshotFailure(`task.dependencies[${index}] must bind submission and artifact together`);
    if (submission !== undefined)
        snapshotText(submission, `task.dependencies[${index}].acceptedSubmissionId`);
    if (digest !== undefined)
        snapshotText(digest, `task.dependencies[${index}].acceptedArtifactDigest`);
}
function snapshotArtifact(value, field) {
    const artifact = snapshotRecord(value, field);
    snapshotText(artifact.artifactId, `${field}.artifactId`);
    snapshotText(artifact.uri, `${field}.uri`);
    if (artifact.digest !== undefined)
        snapshotText(artifact.digest, `${field}.digest`);
    if (artifact.mediaType !== undefined)
        snapshotText(artifact.mediaType, `${field}.mediaType`);
    if (artifact.sizeBytes !== undefined && (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)) {
        snapshotFailure(`${field}.sizeBytes must be a non-negative safe integer`);
    }
}
function snapshotFinding(value, field) {
    const finding = snapshotRecord(value, field);
    snapshotText(finding.findingId, `${field}.findingId`);
    snapshotText(finding.reviewerId, `${field}.reviewerId`);
    snapshotText(finding.summary, `${field}.summary`);
    if (finding.artifactId !== undefined)
        snapshotText(finding.artifactId, `${field}.artifactId`);
    if (finding.location !== undefined)
        snapshotText(finding.location, `${field}.location`);
    if (finding.severity !== undefined && !['info', 'low', 'medium', 'high', 'critical'].includes(String(finding.severity))) {
        snapshotFailure(`${field}.severity is invalid`);
    }
}
function snapshotReview(value, field, owner) {
    const review = snapshotRecord(value, field);
    const reviewerId = snapshotText(review.reviewerId, `${field}.reviewerId`);
    snapshotText(review.reviewId, `${field}.reviewId`);
    if (typeof review.independent !== 'boolean')
        snapshotFailure(`${field}.independent must be boolean`);
    if (review.independent && reviewerId === owner)
        snapshotFailure('independent review must use a different reviewer');
    if (!['passed', 'failed', 'unverified', 'stale'].includes(String(review.outcome)))
        snapshotFailure(`${field}.outcome is invalid`);
    const report = snapshotRecord(review.report, `${field}.report`);
    snapshotJson(report, `${field}.report`);
    if (!Array.isArray(review.findings))
        snapshotFailure(`${field}.findings must be an array`);
    const findingIds = new Set();
    review.findings.forEach((finding, index) => {
        snapshotFinding(finding, `${field}.findings[${index}]`);
        const id = snapshotRecord(finding, `${field}.findings[${index}]`).findingId;
        if (findingIds.has(id))
            snapshotFailure(`${field}.findings contains duplicate ${id}`);
        findingIds.add(id);
    });
    snapshotTimestamp(review.reviewedAt, `${field}.reviewedAt`);
}
function snapshotAttempt(value, field, expectedNumber) {
    const attempt = snapshotRecord(value, field);
    const id = snapshotText(attempt.attemptId, `${field}.attemptId`);
    if (attempt.number !== expectedNumber)
        snapshotFailure(`${field}.number must be ${expectedNumber}`);
    if (!['running', 'completed', 'failed', 'cancelled', 'stop_unknown'].includes(String(attempt.outcome)))
        snapshotFailure(`${field}.outcome is invalid`);
    snapshotTimestamp(attempt.startedAt, `${field}.startedAt`);
    if (attempt.endedAt === undefined && attempt.outcome !== 'running')
        snapshotFailure(`${field}.endedAt is required for a terminal attempt`);
    if (attempt.endedAt !== undefined)
        snapshotTimestamp(attempt.endedAt, `${field}.endedAt`);
    if (attempt.outcome === 'running' && attempt.endedAt !== undefined)
        snapshotFailure(`${field}.running attempt cannot have endedAt`);
    if (attempt.owner !== undefined)
        snapshotText(attempt.owner, `${field}.owner`);
    if (attempt.error !== undefined) {
        const error = snapshotRecord(attempt.error, `${field}.error`);
        snapshotText(error.name, `${field}.error.name`);
        snapshotText(error.message, `${field}.error.message`);
    }
    return { id, outcome: String(attempt.outcome) };
}
function snapshotCancellation(value) {
    const cancellation = snapshotRecord(value, 'task.cancellation');
    snapshotText(cancellation.requestId, 'task.cancellation.requestId');
    snapshotText(cancellation.reason, 'task.cancellation.reason');
    snapshotTimestamp(cancellation.requestedAt, 'task.cancellation.requestedAt');
    const outcome = String(cancellation.outcome);
    if (!['requested', 'confirmed', 'unknown'].includes(outcome))
        snapshotFailure('task.cancellation.outcome is invalid');
    if (outcome === 'requested' && cancellation.confirmedAt !== undefined)
        snapshotFailure('requested cancellation cannot have confirmedAt');
    if (outcome === 'unknown' && cancellation.confirmedAt !== undefined)
        snapshotFailure('unknown cancellation cannot have confirmedAt');
    if (outcome === 'confirmed' && cancellation.confirmedAt === undefined)
        snapshotFailure('confirmed cancellation requires confirmedAt');
    if (cancellation.confirmedAt !== undefined)
        snapshotTimestamp(cancellation.confirmedAt, 'task.cancellation.confirmedAt');
    if (cancellation.evidence !== undefined) {
        snapshotRecord(cancellation.evidence, 'task.cancellation.evidence');
        snapshotJson(cancellation.evidence, 'task.cancellation.evidence');
    }
    return outcome;
}
/** Validate a complete task snapshot before it is stored or replayed. */
export function validateTaskRecord(task) {
    const snapshot = snapshotRecord(task, 'task');
    const taskId = snapshotText(snapshot.taskId, 'task.taskId');
    snapshotText(snapshot.title, 'task.title');
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1)
        snapshotFailure('task.revision must be positive');
    if (!Number.isSafeInteger(snapshot.attempts) || snapshot.attempts < 0)
        snapshotFailure('task.attempts must be non-negative');
    if (typeof snapshot.deleted !== 'boolean')
        snapshotFailure('task.deleted must be boolean');
    const status = snapshot.status;
    const stage = snapshot.stage;
    const state = snapshot.state;
    if (!TASK_STATUSES.includes(String(status)))
        snapshotFailure(`unknown task status ${String(status)}`);
    if (!TASK_STAGES.includes(String(stage)))
        snapshotFailure(`unknown task stage ${String(stage)}`);
    if (!TASK_STATES.includes(String(state)))
        snapshotFailure(`unknown task state ${String(state)}`);
    const stages = {
        created: ['pending', 'stopping'],
        queued: ['queued', 'stopping'],
        running: ['working', 'awaiting_review', 'stopping'],
        completed: ['awaiting_review', 'needs_attention', 'accepted', 'delivered'],
        failed: ['needs_attention', 'stop_unknown'],
        cancelled: ['stopped', 'deleted'],
    };
    if (!stages[status].includes(stage))
        snapshotFailure(`task.stage ${String(stage)} is invalid for ${String(status)}`);
    const expectedStates = status === 'created'
        ? ['pending', 'ready']
        : status === 'queued'
            ? ['ready']
            : status === 'running'
                ? [stage === 'awaiting_review' ? 'waiting' : 'running']
                : status === 'completed'
                    ? [stage === 'awaiting_review' ? 'waiting' : 'succeeded']
                    : status === 'failed'
                        ? ['failed']
                        : ['cancelled'];
    if (!expectedStates.includes(state))
        snapshotFailure(`task.state ${String(state)} does not match status/stage`);
    if (!Array.isArray(snapshot.acceptance))
        snapshotFailure('task.acceptance must be an array');
    snapshot.acceptance.forEach((check, index) => snapshotText(check, `task.acceptance[${index}]`));
    snapshotCriteria(snapshot.criteria, 'task.criteria');
    const criteria = snapshotRecord(snapshot.criteria, 'task.criteria');
    if (snapshot.acceptance.length !== criteria.checks.length || snapshot.acceptance.some((value, index) => value !== criteria.checks[index])) {
        snapshotFailure('task.acceptance must equal criteria.checks');
    }
    if (snapshot.owner !== undefined)
        snapshotText(snapshot.owner, 'task.owner');
    if (!Array.isArray(snapshot.dependencies))
        snapshotFailure('task.dependencies must be an array');
    const dependencyIds = new Set();
    snapshot.dependencies.forEach((dependency, index) => {
        snapshotDependency(dependency, taskId, index);
        const id = snapshotRecord(dependency, `task.dependencies[${index}]`).taskId;
        if (dependencyIds.has(id))
            snapshotFailure(`duplicate dependency ${id}`);
        dependencyIds.add(id);
    });
    if (!Array.isArray(snapshot.attemptHistory) || snapshot.attempts !== snapshot.attemptHistory.length)
        snapshotFailure('task.attempts must equal attemptHistory.length');
    const attempts = snapshot.attemptHistory.map((attempt, index) => snapshotAttempt(attempt, `task.attemptHistory[${index}]`, index + 1));
    const attemptIds = new Set();
    attempts.forEach(attempt => {
        if (attemptIds.has(attempt.id))
            snapshotFailure(`duplicate attempt ${attempt.id}`);
        attemptIds.add(attempt.id);
    });
    const runningAttempts = attempts.filter(attempt => attempt.outcome === 'running');
    if (runningAttempts.length > 0 && status !== 'running')
        snapshotFailure('only a running task may contain a running attempt');
    if (status === 'running') {
        if (snapshot.attemptId === undefined)
            snapshotFailure('running task requires attemptId');
        const currentAttemptId = snapshotText(snapshot.attemptId, 'task.attemptId');
        if (attempts.length === 0 || attempts[attempts.length - 1]?.id !== currentAttemptId || runningAttempts.length !== 1 || attempts[attempts.length - 1]?.outcome !== 'running') {
            snapshotFailure('running task attemptId must identify its only active attempt');
        }
    }
    else if (snapshot.attemptId !== undefined) {
        const currentAttemptId = snapshotText(snapshot.attemptId, 'task.attemptId');
        if (status === 'created' || status === 'queued' || attempts.length === 0 || attempts[attempts.length - 1]?.id !== currentAttemptId)
            snapshotFailure('terminal task attemptId must identify its latest attempt');
    }
    if (status === 'completed' && attempts.length === 0)
        snapshotFailure('completed task requires an attempt');
    if (status === 'completed' && attempts.length > 0 && attempts[attempts.length - 1]?.outcome !== 'completed')
        snapshotFailure('completed task must reference a completed latest attempt');
    if ((status === 'completed' || status === 'failed') && stage === 'needs_attention' && attempts.length === 0)
        snapshotFailure('needs-attention task requires an attempt');
    if (status === 'failed' && stage === 'needs_attention' && attempts.length > 0 && attempts[attempts.length - 1]?.outcome !== 'failed')
        snapshotFailure('failed task must reference a failed latest attempt');
    if (status === 'cancelled' && stage === 'stopped' && attempts.length > 0 && attempts[attempts.length - 1]?.outcome !== 'cancelled')
        snapshotFailure('stopped task must close its latest attempt as cancelled');
    if (stage === 'stop_unknown' && attempts.length > 0 && attempts[attempts.length - 1]?.outcome !== 'stop_unknown')
        snapshotFailure('stop-unknown task must close its latest attempt as stop_unknown');
    if (!Array.isArray(snapshot.assignmentHistory))
        snapshotFailure('task.assignmentHistory must be an array');
    snapshot.assignmentHistory.forEach((assignment, index) => {
        const record = snapshotRecord(assignment, `task.assignmentHistory[${index}]`);
        snapshotText(record.owner, `task.assignmentHistory[${index}].owner`);
        snapshotTimestamp(record.assignedAt, `task.assignmentHistory[${index}].assignedAt`);
        if (record.reason !== undefined)
            snapshotText(record.reason, `task.assignmentHistory[${index}].reason`);
    });
    if (snapshot.owner === undefined && snapshot.assignmentHistory.length > 0)
        snapshotFailure('assignment history requires task.owner');
    if (snapshot.owner !== undefined && snapshot.assignmentHistory.at(-1)?.owner !== snapshot.owner)
        snapshotFailure('task.owner must match its latest assignment');
    if (!Array.isArray(snapshot.returnReasons))
        snapshotFailure('task.returnReasons must be an array');
    snapshot.returnReasons.forEach((reason, index) => snapshotText(reason, `task.returnReasons[${index}]`));
    if (snapshot.returnReasons.length > snapshot.attempts)
        snapshotFailure('task.returnReasons cannot exceed attempts');
    if (!Array.isArray(snapshot.artifacts))
        snapshotFailure('task.artifacts must be an array');
    const artifactIds = new Set();
    snapshot.artifacts.forEach((artifact, index) => {
        snapshotArtifact(artifact, `task.artifacts[${index}]`);
        const id = snapshotRecord(artifact, `task.artifacts[${index}]`).artifactId;
        if (artifactIds.has(id))
            snapshotFailure(`task.artifacts contains duplicate ${id}`);
        artifactIds.add(id);
    });
    if (snapshot.result !== undefined)
        snapshotJson(snapshot.result, 'task.result');
    if ((status === 'created' || status === 'queued' || status === 'running' || status === 'failed' || (status === 'cancelled' && stage === 'stopped'))
        && (snapshot.result !== undefined || snapshot.artifacts.length > 0)) {
        snapshotFailure(`${String(status)}/${String(stage)} task cannot retain execution payload`);
    }
    if (!Array.isArray(snapshot.submissions))
        snapshotFailure('task.submissions must be an array');
    const submissionIds = new Set();
    const submittedAttempts = new Set();
    let priorAttemptNumber = 0;
    snapshot.submissions.forEach((submission, index) => {
        const record = snapshotRecord(submission, `task.submissions[${index}]`);
        const submissionId = snapshotText(record.submissionId, `task.submissions[${index}].submissionId`);
        if (submissionIds.has(submissionId))
            snapshotFailure(`duplicate submission ${submissionId}`);
        submissionIds.add(submissionId);
        snapshotText(record.requestId, `task.submissions[${index}].requestId`);
        const attemptId = snapshotText(record.attemptId, `task.submissions[${index}].attemptId`);
        const attemptIndex = attempts.findIndex(attempt => attempt.id === attemptId);
        if (attemptIndex < 0 || attempts[attemptIndex]?.outcome !== 'completed')
            snapshotFailure(`submission ${submissionId} must reference a completed attempt`);
        if (submittedAttempts.has(attemptId))
            snapshotFailure(`duplicate submission attempt ${attemptId}`);
        submittedAttempts.add(attemptId);
        const attemptNumber = attemptIndex + 1;
        if (attemptNumber <= priorAttemptNumber)
            snapshotFailure('submissions must follow attempt order');
        priorAttemptNumber = attemptNumber;
        snapshotCriteria(record.criteria, `task.submissions[${index}].criteria`);
        if (!Array.isArray(record.artifacts))
            snapshotFailure(`task.submissions[${index}].artifacts must be an array`);
        const submissionArtifactIds = new Set();
        record.artifacts.forEach((artifact, artifactIndex) => {
            snapshotArtifact(artifact, `task.submissions[${index}].artifacts[${artifactIndex}]`);
            const id = snapshotRecord(artifact, `task.submissions[${index}].artifacts[${artifactIndex}]`).artifactId;
            if (submissionArtifactIds.has(id))
                snapshotFailure(`submission ${submissionId} contains duplicate artifact ${id}`);
            submissionArtifactIds.add(id);
        });
        let computedDigest;
        try {
            computedDigest = artifactDigest(record.artifacts);
        }
        catch (error) {
            snapshotFailure(`submission ${submissionId} has invalid artifacts: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (record.artifactDigest !== computedDigest)
            snapshotFailure(`submission ${submissionId} artifactDigest does not match artifacts`);
        snapshotTimestamp(record.submittedAt, `task.submissions[${index}].submittedAt`);
        if (!Array.isArray(record.findings))
            snapshotFailure(`task.submissions[${index}].findings must be an array`);
        const findingIds = new Set();
        record.findings.forEach((finding, findingIndex) => {
            snapshotFinding(finding, `task.submissions[${index}].findings[${findingIndex}]`);
            const id = snapshotRecord(finding, `task.submissions[${index}].findings[${findingIndex}]`).findingId;
            if (findingIds.has(id))
                snapshotFailure(`submission ${submissionId} contains duplicate finding ${id}`);
            findingIds.add(id);
        });
        if (!Array.isArray(record.reviews))
            snapshotFailure(`task.submissions[${index}].reviews must be an array`);
        const reviewIds = new Set();
        record.reviews.forEach((review, reviewIndex) => {
            snapshotReview(review, `task.submissions[${index}].reviews[${reviewIndex}]`, snapshot.owner);
            const id = snapshotRecord(review, `task.submissions[${index}].reviews[${reviewIndex}]`).reviewId;
            if (reviewIds.has(id))
                snapshotFailure(`submission ${submissionId} contains duplicate review ${id}`);
            reviewIds.add(id);
        });
    });
    if (!Array.isArray(snapshot.evidence))
        snapshotFailure('task.evidence must be an array');
    const evidenceIds = new Set();
    snapshot.evidence.forEach((evidence, index) => {
        const record = snapshotRecord(evidence, `task.evidence[${index}]`);
        const id = snapshotText(record.evidenceId, `task.evidence[${index}].evidenceId`);
        if (evidenceIds.has(id))
            snapshotFailure(`duplicate evidence ${id}`);
        evidenceIds.add(id);
        if (record.taskId !== undefined && snapshotText(record.taskId, `task.evidence[${index}].taskId`) !== taskId)
            snapshotFailure('evidence.taskId must match task.taskId');
        if (!['source', 'test', 'metric', 'artifact', 'review', 'log'].includes(String(record.kind)))
            snapshotFailure(`task.evidence[${index}].kind is invalid`);
        snapshotText(record.summary, `task.evidence[${index}].summary`);
        if (record.ref !== undefined)
            snapshotText(record.ref, `task.evidence[${index}].ref`);
        if (record.digest !== undefined)
            snapshotText(record.digest, `task.evidence[${index}].digest`);
        if (record.recordedAt !== undefined)
            snapshotTimestamp(record.recordedAt, `task.evidence[${index}].recordedAt`);
    });
    const cancellationOutcome = snapshot.cancellation === undefined ? undefined : snapshotCancellation(snapshot.cancellation);
    if (stage === 'stopping' && cancellationOutcome !== 'requested')
        snapshotFailure('stopping task requires a requested cancellation');
    if (stage === 'stopped' && cancellationOutcome !== 'confirmed')
        snapshotFailure('stopped task requires confirmed cancellation');
    if (stage === 'stop_unknown' && cancellationOutcome !== 'unknown')
        snapshotFailure('stop-unknown task requires unknown cancellation');
    if (stage !== 'stopping' && stage !== 'stopped' && stage !== 'stop_unknown' && stage !== 'deleted' && cancellationOutcome !== undefined)
        snapshotFailure('cancellation is only valid during stopping or after a stop');
    if (stage === 'deleted' && cancellationOutcome !== undefined && cancellationOutcome !== 'confirmed')
        snapshotFailure('deleted task may retain only confirmed cancellation');
    if (snapshot.delivery !== undefined) {
        const delivery = snapshotRecord(snapshot.delivery, 'task.delivery');
        snapshotText(delivery.deliveryId, 'task.delivery.deliveryId');
        snapshotText(delivery.requestId, 'task.delivery.requestId');
        const submissionId = snapshotText(delivery.submissionId, 'task.delivery.submissionId');
        snapshotTimestamp(delivery.deliveredAt, 'task.delivery.deliveredAt');
        if (stage !== 'delivered')
            snapshotFailure('delivery requires delivered stage');
        if (!submissionIds.has(submissionId))
            snapshotFailure('delivery must reference a task submission');
    }
    else if (stage === 'delivered') {
        snapshotFailure('delivered stage requires delivery');
    }
    if (stage === 'awaiting_review' || stage === 'accepted' || stage === 'delivered') {
        if (snapshot.attemptId === undefined)
            snapshotFailure(`${String(stage)} stage requires a current attempt`);
        const currentSubmission = [...snapshot.submissions].reverse().find((submission) => snapshotRecord(submission, 'task.submission').attemptId === snapshot.attemptId);
        if (currentSubmission === undefined)
            snapshotFailure(`${String(stage)} stage requires a current submission`);
        const current = snapshotRecord(currentSubmission, 'task.currentSubmission');
        const currentCriteria = snapshotRecord(snapshot.criteria, 'task.criteria');
        const submissionCriteria = snapshotRecord(current.criteria, 'task.currentSubmission.criteria');
        if (submissionCriteria.name !== currentCriteria.name || submissionCriteria.version !== currentCriteria.version)
            snapshotFailure('current submission criteria are stale');
        if (stage === 'accepted' || stage === 'delivered') {
            if (current.artifactDigest !== artifactDigest(snapshot.artifacts))
                snapshotFailure('accepted submission artifacts do not match task artifacts');
            if (!current.reviews.some(review => snapshotRecord(review, 'task.currentSubmission.review').outcome === 'passed'))
                snapshotFailure('accepted stage requires a passed review');
        }
    }
    if (snapshot.deleted && (status !== 'cancelled' || stage !== 'deleted'))
        snapshotFailure('deleted task requires cancelled/deleted status');
    if (!snapshot.deleted && stage === 'deleted')
        snapshotFailure('deleted stage requires deleted flag');
    if (snapshot.deleted && snapshot.delivery !== undefined)
        snapshotFailure('delivered task must be tombstoned before deletion');
    snapshotTimestamp(snapshot.createdAt, 'task.createdAt');
    snapshotTimestamp(snapshot.updatedAt, 'task.updatedAt');
    return task;
}
const STATE_TRANSITIONS = {
    pending: ['ready', 'cancelled'],
    ready: ['running', 'cancelled'],
    running: ['waiting', 'succeeded', 'failed', 'cancelled'],
    waiting: ['running', 'failed', 'cancelled'],
    succeeded: [],
    failed: [],
    cancelled: [],
};
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
export function transitionTask(task, next, dependencies = [], now = isoNow()) {
    validateTaskRecord(task);
    if (!TASK_STATES.includes(next))
        throw new ProtocolError(`unknown task state ${String(next)}`, 'INVALID_TRANSITION');
    if (!STATE_TRANSITIONS[task.state].includes(next))
        throw new ProtocolError(`invalid transition ${task.state} -> ${next}`, 'INVALID_TRANSITION');
    if (next === 'ready') {
        const supplied = new Map(dependencies.map(dependency => [dependency.taskId, dependency]));
        const unresolved = dependencies.some(dependency => dependency.state !== 'succeeded' || (dependency.stage !== 'accepted' && dependency.stage !== 'delivered'))
            || task.dependencies.some(dependency => {
                const upstream = supplied.get(dependency.taskId);
                return upstream === undefined || upstream.state !== 'succeeded' || (upstream.stage !== 'accepted' && upstream.stage !== 'delivered');
            });
        if (unresolved)
            throw new ProtocolError('dependencies are not accepted', 'TASK_DEPENDENCY_BLOCKED');
    }
    if (task.cancellation !== undefined && next !== 'cancelled') {
        throw new ProtocolError('a cancellation request must be resolved before this transition', 'CANCELLATION_PENDING');
    }
    const at = validTimestamp(now, 'now');
    const usedIds = new Set([
        ...task.attemptHistory.map(attempt => attempt.attemptId),
        ...task.submissions.map(submission => submission.submissionId),
    ]);
    const makeId = (kind, ordinal) => {
        const base = `legacy-${kind}-${task.taskId}-${task.revision + 1}-${ordinal}`;
        let candidate = base;
        let suffix = 1;
        while (usedIds.has(candidate))
            candidate = `${base}-${suffix++}`;
        usedIds.add(candidate);
        return candidate;
    };
    const finish = (changes) => {
        const result = {
            ...task,
            ...changes,
            revision: task.revision + 1,
            updatedAt: at,
        };
        validateTaskRecord(result);
        return result;
    };
    const closeAttempt = (outcome) => {
        const attemptId = task.attemptId;
        if (attemptId === undefined)
            throw new ProtocolError(`state ${task.state} requires an active attempt`, 'INVALID_TRANSITION');
        const index = task.attemptHistory.findIndex(attempt => attempt.attemptId === attemptId);
        if (index < 0 || task.attemptHistory[index]?.outcome !== 'running')
            throw new ProtocolError(`attempt ${attemptId} is not running`, 'INVALID_TRANSITION');
        return task.attemptHistory.map((attempt, position) => position === index
            ? { ...attempt, outcome, endedAt: at, ...outcome === 'failed' ? { error: { name: 'LegacyTransition', message: 'legacy transition marked the attempt failed' } } : {} }
            : attempt);
    };
    const appendAttempt = (outcome) => {
        const attemptId = makeId('attempt', task.attempts + 1);
        const attempt = {
            attemptId,
            number: task.attempts + 1,
            ...task.owner === undefined ? {} : { owner: task.owner },
            startedAt: at,
            ...outcome === 'running' ? { outcome } : {
                outcome,
                endedAt: at,
                ...outcome === 'failed' ? { error: { name: 'LegacyTransition', message: 'legacy transition marked the attempt failed' } } : {},
            },
        };
        return { attempt, history: [...task.attemptHistory, attempt] };
    };
    if (next === 'ready')
        return finish({ status: 'created', state: 'ready', stage: 'pending' });
    if (next === 'running') {
        if (task.state === 'waiting') {
            const { attempt, history } = appendAttempt('running');
            return finish({
                status: 'running',
                state: 'running',
                stage: 'working',
                attempts: task.attempts + 1,
                attemptId: attempt.attemptId,
                attemptHistory: history,
                result: undefined,
                artifacts: [],
                cancellation: undefined,
            });
        }
        const { attempt, history } = appendAttempt('running');
        return finish({
            status: 'running',
            state: 'running',
            stage: 'working',
            attempts: task.attempts + 1,
            attemptId: attempt.attemptId,
            attemptHistory: history,
            result: undefined,
            artifacts: [],
            cancellation: undefined,
        });
    }
    if (next === 'waiting') {
        if (task.cancellation !== undefined)
            throw new ProtocolError('a cancellation request must be resolved before review', 'CANCELLATION_PENDING');
        const history = closeAttempt('completed');
        const attemptId = task.attemptId;
        if (attemptId === undefined)
            throw new ProtocolError('waiting state requires an active attempt', 'INVALID_TRANSITION');
        const submission = {
            submissionId: makeId('submission', task.attempts),
            requestId: makeId('request', task.attempts),
            attemptId,
            criteria: { ...task.criteria, checks: [...task.criteria.checks] },
            artifacts: task.artifacts.map(artifact => ({ ...artifact })),
            artifactDigest: artifactDigest(task.artifacts),
            submittedAt: at,
            findings: [],
            reviews: [],
        };
        return finish({
            status: 'completed',
            state: 'waiting',
            stage: 'awaiting_review',
            attemptHistory: history,
            submissions: [...task.submissions, submission],
        });
    }
    if (next === 'succeeded') {
        return finish({
            status: 'completed',
            state: 'succeeded',
            stage: 'needs_attention',
            attemptHistory: closeAttempt('completed'),
        });
    }
    if (next === 'failed') {
        if (task.state === 'waiting') {
            const { attempt, history } = appendAttempt('failed');
            return finish({
                status: 'failed',
                state: 'failed',
                stage: 'needs_attention',
                attempts: task.attempts + 1,
                attemptId: attempt.attemptId,
                attemptHistory: history,
                result: undefined,
                artifacts: [],
            });
        }
        return finish({
            status: 'failed',
            state: 'failed',
            stage: 'needs_attention',
            attemptHistory: closeAttempt('failed'),
            result: undefined,
            artifacts: [],
        });
    }
    if (next === 'cancelled') {
        const cancellation = task.cancellation?.outcome === 'requested'
            ? { ...task.cancellation, confirmedAt: at, outcome: 'confirmed' }
            : {
                requestId: makeId('cancel', task.attempts),
                reason: 'legacy transition requested cancellation',
                requestedAt: at,
                confirmedAt: at,
                outcome: 'confirmed',
            };
        if (task.state === 'waiting') {
            const { attempt, history } = appendAttempt('cancelled');
            return finish({
                status: 'cancelled',
                state: 'cancelled',
                stage: 'stopped',
                attempts: task.attempts + 1,
                attemptId: attempt.attemptId,
                attemptHistory: history,
                result: undefined,
                artifacts: [],
                cancellation,
            });
        }
        const history = task.state === 'running' ? closeAttempt('cancelled') : task.attemptHistory;
        return finish({
            status: 'cancelled',
            state: 'cancelled',
            stage: 'stopped',
            attemptHistory: history,
            result: undefined,
            artifacts: [],
            cancellation,
        });
    }
    throw new ProtocolError(`unsupported legacy transition ${task.state} -> ${next}`, 'INVALID_TRANSITION');
}
/** Validate a budget and return a detached copy. */
export function validateBudget(budget) {
    if (!budget || typeof budget !== 'object')
        throw new ProtocolError('budget must be an object', 'INVALID_ARGUMENT');
    for (const [name, value] of Object.entries(budget)) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
            throw new ProtocolError(`${name} must be a non-negative safe integer`, 'INVALID_ARGUMENT');
        }
    }
    if (budget.maxTotalTokens !== undefined
        && budget.maxInputTokens !== undefined
        && budget.maxOutputTokens !== undefined
        && budget.maxTotalTokens < budget.maxInputTokens + budget.maxOutputTokens) {
        throw new ProtocolError('maxTotalTokens must cover maxInputTokens + maxOutputTokens', 'INVALID_ARGUMENT');
    }
    return { ...budget };
}
/** Compute a stable digest for an artifact snapshot. */
export function artifactDigest(artifacts) {
    const seen = new Set();
    const normalized = artifacts.map((artifact, index) => {
        if (!artifact || typeof artifact !== 'object')
            throw new ProtocolError(`artifacts[${index}] must be an object`, 'INVALID_ARGUMENT');
        const artifactId = requiredText(artifact.artifactId, `artifacts[${index}].artifactId`);
        if (seen.has(artifactId))
            throw new ProtocolError(`artifacts contains duplicate ${artifactId}`, 'INVALID_ARGUMENT');
        seen.add(artifactId);
        if (artifact.sizeBytes !== undefined && (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)) {
            throw new ProtocolError(`artifacts[${index}].sizeBytes must be a non-negative safe integer`, 'INVALID_ARGUMENT');
        }
        return {
            artifactId,
            uri: requiredText(artifact.uri, `artifacts[${index}].uri`),
            ...artifact.digest === undefined ? {} : { digest: requiredText(artifact.digest, `artifacts[${index}].digest`) },
            ...artifact.mediaType === undefined ? {} : { mediaType: requiredText(artifact.mediaType, `artifacts[${index}].mediaType`) },
            ...artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes },
        };
    }).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}
/** Stable object-key ordering used by request idempotency and JSONL. */
export function stableStringify(value) {
    const normalize = (candidate) => {
        if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean')
            return candidate;
        if (typeof candidate === 'number') {
            if (!Number.isFinite(candidate))
                throw new ProtocolError('cannot stringify a non-finite number', 'INVALID_JSON');
            return candidate;
        }
        if (Array.isArray(candidate))
            return candidate.map(normalize);
        if (typeof candidate === 'object') {
            const output = {};
            for (const key of Object.keys(candidate).sort()) {
                const valueAtKey = candidate[key];
                if (valueAtKey !== undefined)
                    output[key] = normalize(valueAtKey);
            }
            return output;
        }
        throw new ProtocolError('cannot stringify a non-JSON value', 'INVALID_JSON');
    };
    return JSON.stringify(normalize(value));
}
/** Encode one event as one newline-free JSONL record. */
export function encodeEvent(event) {
    validateEvent(event);
    return stableStringify(event);
}
/** Encode a contiguous event stream as JSONL. */
export function encodeEvents(events) {
    return events.map(encodeEvent).join('\n') + (events.length === 0 ? '' : '\n');
}
/** Decode one JSONL record and reject unknown versions or malformed snapshots. */
export function decodeEvent(line) {
    if (typeof line !== 'string' || line.trim() === '')
        throw new ProtocolError('event line is empty', 'INVALID_EVENT');
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (error) {
        throw new ProtocolError(`event line is not JSON: ${error instanceof Error ? error.message : String(error)}`, 'INVALID_EVENT');
    }
    validateEvent(parsed);
    return parsed;
}
/** Validate event identity, sequence, and post-command snapshot. */
export function validateEvent(event) {
    try {
        const record = snapshotRecord(event, 'event');
        if (record.version !== 1)
            eventFailure('unsupported task event version');
        if (!Number.isSafeInteger(record.sequence) || record.sequence < 1)
            eventFailure('event.sequence must be positive');
        snapshotText(record.eventId, 'event.eventId');
        const taskId = snapshotText(record.taskId, 'event.taskId');
        const type = snapshotText(record.type, 'event.type');
        if (type !== record.type)
            eventFailure('event.type must not contain surrounding whitespace');
        if (!TASK_EVENT_TYPES.includes(type))
            eventFailure(`unknown task event type ${type}`);
        snapshotTimestamp(record.at, 'event.at');
        const task = snapshotRecord(record.task, 'event.task');
        if (record.revision !== task.revision || taskId !== task.taskId)
            eventFailure('event identity does not match its task snapshot');
        validateTaskRecord(task);
        const data = snapshotRecord(record.data, 'event.data');
        toJsonValue(data, 'event.data');
    }
    catch (error) {
        if (error instanceof ProtocolError && error.code === 'INVALID_EVENT')
            throw error;
        if (error instanceof ProtocolError)
            throw new ProtocolError(error.message, 'INVALID_EVENT');
        throw new ProtocolError(`event is invalid: ${error instanceof Error ? error.message : String(error)}`, 'INVALID_EVENT');
    }
    return event;
}
function metricNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        throw new ProtocolError(`${field} must be a non-negative finite number`, 'INVALID_METRIC');
    return value;
}
/**
 * Compare matched real measurements. Mock and replay values remain useful for
 * debugging but cannot authorize a release.
 */
export function compareMetrics(baseline, candidate) {
    if (baseline.mode !== 'real' || candidate.mode !== 'real')
        throw new ProtocolError('release comparison requires real results', 'METRIC_MODE_UNVERIFIED');
    for (const [name, value] of Object.entries(baseline)) {
        if (['mode', 'workloadId', 'model', 'contextLimit'].includes(name))
            continue;
        metricNumber(value, `baseline.${name}`);
    }
    for (const [name, value] of Object.entries(candidate)) {
        if (['mode', 'workloadId', 'model', 'contextLimit'].includes(name))
            continue;
        metricNumber(value, `candidate.${name}`);
    }
    for (const key of ['workloadId', 'model', 'contextLimit']) {
        if (baseline[key] !== undefined && candidate[key] !== undefined && baseline[key] !== candidate[key]) {
            throw new ProtocolError(`${key} must match between baseline and candidate`, 'METRIC_MISMATCH');
        }
    }
    const scoreDelta = candidate.score - baseline.score;
    const totalTokensDelta = candidate.inputTokens + candidate.outputTokens - baseline.inputTokens - baseline.outputTokens;
    const latencyDelta = candidate.latencyMs - baseline.latencyMs;
    const toolCallsDelta = candidate.toolCalls - baseline.toolCalls;
    const accepted = candidate.score >= baseline.score && totalTokensDelta < 0;
    return {
        scoreDelta,
        totalTokensDelta,
        latencyDelta,
        toolCallsDelta,
        accepted,
        reason: accepted
            ? 'candidate score is no lower and total tokens are lower'
            : candidate.score < baseline.score
                ? 'candidate score is lower than baseline'
                : 'candidate total tokens are not strictly lower than baseline',
    };
}
//# sourceMappingURL=protocol.js.map