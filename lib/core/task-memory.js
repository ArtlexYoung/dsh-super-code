import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { TEAM_NAMES } from './teams.js';
const text = z.string().trim().min(1).max(4_000);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/);
export const sourceSchema = z.object({ seq: z.number().int().nonnegative(), quote: text }).strict();
export const requirementSchema = z.object({ id, text, source: sourceSchema }).strict();
const evidenceSchema = z.object({
    summary: text, ref: text, sourceVersion: text,
    requirementsRevision: z.number().int().positive(),
    kind: z.enum(['observed', 'assumption', 'test', 'decision']),
}).strict();
/** Task memory records requirements and recovery context; it never grants authority. */
const taskObject = z.object({
    id, title: z.string().trim().min(1).max(200),
    createdAtSeq: z.number().int().nonnegative(),
    team: z.enum(TEAM_NAMES), depth: z.enum(['simple', 'complex']),
    workspace: text, sourceVersion: text, goal: text,
    source: sourceSchema,
    requirements: z.array(requirementSchema).max(64),
    acceptance: z.array(text).min(1).max(32),
    decisions: z.array(text).max(16),
    evidence: z.array(evidenceSchema).max(32),
    next: z.string().max(4_000),
    status: z.enum(['active', 'paused', 'completed', 'cancelled']),
    revision: z.number().int().positive(),
    requirementsRevision: z.number().int().positive(),
    delegationRevision: z.number().int().positive(),
}).strict();
export const taskMemorySchema = taskObject;
/** A bounded working set. Archived complete records remain in the host log. */
export const taskMemoryStateSchema = z.object({
    tasks: z.record(id, taskMemorySchema),
    recentSources: z.array(z.number().int().nonnegative()).max(8),
    focus: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('task'), id }).strict()]),
}).strict();
export const taskMemoryEventSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('save'), task: taskMemorySchema }).strict(),
    z.object({ kind: z.literal('focus'), id }).strict(),
    z.object({ kind: z.literal('archive'), task: taskMemorySchema }).strict(),
]);
export const taskMemoryCreateSchema = taskObject.omit({ createdAtSeq: true, revision: true, requirementsRevision: true, delegationRevision: true, status: true, evidence: true, decisions: true, next: true });
export const taskMemoryPatchSchema = z.object({
    title: taskObject.shape.title.optional(), team: taskObject.shape.team.optional(), depth: taskObject.shape.depth.optional(),
    goal: text.optional(), workspace: text.optional(), sourceVersion: text.optional(),
    source: sourceSchema.optional(), requirements: z.array(requirementSchema).max(64).optional(),
    removeRequirements: z.array(id).max(64).optional(), acceptance: taskObject.shape.acceptance.optional(),
    decisions: taskObject.shape.decisions.optional(), evidence: taskObject.shape.evidence.optional(),
    next: taskObject.shape.next.optional(), status: taskObject.shape.status.optional(),
}).strict();
export function emptyTaskMemory() { return { tasks: {}, recentSources: [], focus: { kind: 'none' } }; }
export function requireTaskMemory(state, taskId) {
    if (!Object.hasOwn(state.tasks, taskId))
        throw new Error(`Unknown task ${taskId}; read its archived event to restore it`);
    return state.tasks[taskId];
}
/** Replace only explicitly named requirements; unchanged constraints retain their sources. */
export function reviseTaskMemory(task, patch, expectedRevision) {
    if (task.revision !== expectedRevision)
        throw new Error(`Stale task ${task.id}: expected ${expectedRevision}, current ${task.revision}`);
    const normalized = taskMemoryPatchSchema.parse(patch);
    if ((task.status === 'completed' || task.status === 'cancelled') && normalized.status !== undefined && normalized.status !== task.status) {
        throw new Error('Archive and restore a finished task with a new user source before reopening it');
    }
    const requirements = new Map(task.requirements.map(item => [item.id, item]));
    const removals = new Set(normalized.removeRequirements ?? []);
    for (const key of removals) {
        if (!requirements.delete(key))
            throw new Error(`Cannot remove unknown requirement ${key}`);
    }
    const replacements = new Set();
    for (const requirement of normalized.requirements ?? []) {
        if (removals.has(requirement.id) || replacements.has(requirement.id))
            throw new Error(`Conflicting requirement ${requirement.id}`);
        replacements.add(requirement.id);
        requirements.set(requirement.id, requirement);
    }
    const { removeRequirements: _removed, ...fields } = normalized;
    const requiresSource = normalized.goal !== undefined || normalized.workspace !== undefined
        || normalized.acceptance !== undefined || normalized.requirements !== undefined || removals.size > 0;
    if (requiresSource && normalized.source === undefined)
        throw new Error('A requirement change needs the source of the user correction');
    // All validation precedes equality: a stale request or a new source is not a retry.
    const candidate = taskMemorySchema.parse({ ...task, ...fields, requirements: [...requirements.values()] });
    if (isDeepStrictEqual(candidate, task))
        return task;
    // Redundant requirement fields may accompany real progress. Only changed content
    // or a new correction source invalidates work; source-only updates keep their contract.
    const changed = requiresSource && (!isDeepStrictEqual(candidate.source, task.source)
        || candidate.goal !== task.goal || candidate.workspace !== task.workspace
        || !isDeepStrictEqual(candidate.acceptance, task.acceptance) || !isDeepStrictEqual(candidate.requirements, task.requirements));
    const invalidatesDecisions = changed || (normalized.sourceVersion !== undefined && normalized.sourceVersion !== task.sourceVersion);
    // A paused member must never become current merely because its parent resumes.
    const invalidatesDelegation = invalidatesDecisions || (normalized.status !== undefined && normalized.status !== task.status);
    return taskMemorySchema.parse({ ...task, ...fields, decisions: normalized.decisions ?? (invalidatesDecisions ? [] : task.decisions), requirements: [...requirements.values()], revision: task.revision + 1,
        requirementsRevision: task.requirementsRevision + Number(changed), delegationRevision: task.delegationRevision + Number(invalidatesDelegation) });
}
/** Deterministic replay; old evidence stays recorded but is never current after revision. */
export function foldTaskMemory(state, input) {
    const event = taskMemoryEventSchema.parse(input);
    if (event.kind === 'focus') {
        requireTaskMemory(state, event.id);
        return { ...state, focus: { kind: 'task', id: event.id } };
    }
    if (event.kind === 'save') {
        return { ...state, tasks: { ...state.tasks, [event.task.id]: event.task }, focus: state.focus.kind === 'none' ? { kind: 'task', id: event.task.id } : state.focus };
    }
    const tasks = { ...state.tasks };
    delete tasks[event.task.id];
    return { ...state, tasks, focus: state.focus.kind === 'task' && state.focus.id === event.task.id ? { kind: 'none' } : state.focus };
}
/** One recovery shape for runtime context and explicit reads. */
function taskResumeView(task) {
    const validEvidence = task.evidence.filter(item => item.requirementsRevision === task.requirementsRevision && item.sourceVersion === task.sourceVersion);
    // Bound the routine view, not the durable record. Keep the newest entries
    // in their original order, with an explicit count for everything omitted.
    const evidence = validEvidence.slice(-3).map(({ kind, summary, ref }) => ({ kind, summary, ref }));
    return {
        id: task.id, status: task.status, team: task.team, depth: task.depth,
        revision: task.revision, requirementsRevision: task.requirementsRevision, delegationRevision: task.delegationRevision,
        workspace: task.workspace, sourceVersion: task.sourceVersion, sourceSeq: task.source.seq,
        goal: task.goal, requirements: task.requirements.map(({ id, text, source }) => ({ id, text, sourceSeq: source.seq })),
        acceptance: task.acceptance, decisions: task.decisions, next: task.next,
        evidence, omittedEvidence: validEvidence.length - evidence.length,
        staleEvidence: task.evidence.length - validEvidence.length,
        ...(evidence.length ? { evidenceBasis: 'recorded-versions; current workspace not checked' } : {}),
        details: { tool: 'super_code_task', action: 'read', taskId: task.id, view: 'full' },
    };
}
function serializeMemoryView(view, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error('maxBytes must be a positive safe integer');
    for (;;) {
        const output = JSON.stringify(view).replace(/\{\{/g, '\\u007b\\u007b');
        if (Buffer.byteLength(output, 'utf8') <= maxBytes)
            return output;
        if (view.current === undefined || view.current.evidence.length === 0)
            throw new Error('Task context exceeds its budget; split the task or explicitly reduce notes. Hard requirements were not truncated.');
        view.current.evidence.shift();
        view.current.omittedEvidence++;
    }
}
/** Read a bounded recovery view without changing focus or the durable record. */
export function taskMemoryRead(task, maxBytes) {
    return serializeMemoryView({ current: taskResumeView(task) }, maxBytes);
}
/** Compact current state; full sources and evidence remain available via read(view=full). */
export function taskMemoryContext(state, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error('maxBytes must be a positive safe integer');
    const roster = Object.values(state.tasks).map(task => ({ id: task.id, title: task.title, status: task.status }));
    if (roster.length === 0 && state.recentSources.length === 0)
        return '';
    const view = { tasks: roster, recentUserEventSeqs: state.recentSources,
        ...(state.focus.kind === 'task' ? { current: taskResumeView(requireTaskMemory(state, state.focus.id)) } : {}) };
    return serializeMemoryView(view, maxBytes);
}
//# sourceMappingURL=task-memory.js.map