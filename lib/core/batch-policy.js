const TASK_READ_ACTIONS = new Set([
    'list', 'read', 'delegate', 'validate_member', 'source', 'history', 'archives', 'evidence',
]);
const TASK_WRITE_ACTIONS = new Set(['create', 'update', 'focus', 'archive', 'restore']);
const MEMORY_READ_ACTIONS = new Set(['topics', 'read']);
const MEMORY_WRITE_ACTIONS = new Set(['remember', 'forget']);
/** Classify task-ledger actions. Validation is a read of the current snapshot. */
export function classifyTaskAction(action) {
    if (TASK_READ_ACTIONS.has(action))
        return 'read';
    if (TASK_WRITE_ACTIONS.has(action))
        return 'write';
    if (/^(test|check|verify|assert)(?:_|$)/.test(action))
        return 'test';
    return 'unknown';
}
/** Classify durable-memory actions. Unknown scopes/actions remain exclusive. */
export function classifyMemoryAction(action) {
    if (MEMORY_READ_ACTIONS.has(action))
        return 'read';
    if (MEMORY_WRITE_ACTIONS.has(action))
        return 'write';
    if (/^(test|check|verify|assert)(?:_|$)/.test(action))
        return 'test';
    return 'unknown';
}
/** Only explicitly read-only calls may overlap in the host scheduler. */
export function batchSafety(kind) {
    return kind === 'read' ? 'parallel' : 'exclusive';
}
//# sourceMappingURL=batch-policy.js.map