/** UI-only facts from the existing journal. Never emits messages or changes execution. */
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import { recordedToolResult } from './core/host-messages.js';
const LIMIT = { activities: 80, files: 160, pending: 64, todos: 200 };
const phaseSchema = z.enum(['idle', 'running', 'waiting', 'error', 'interrupted']);
const fileSchema = z.object({ path: z.string(), operation: z.enum(['write', 'edit', 'create', 'patch']),
    seq: z.number(), tool: z.string(), callId: z.string() }).strict();
const activitySchema = z.object({ callId: z.string(), tool: z.string(), description: z.string(), seq: z.number(),
    status: z.enum(['running', 'succeeded', 'failed', 'interrupted']), parent: z.string() }).strict();
const pendingSchema = z.object({ callId: z.string(), turn: z.number(), step: z.number(),
    files: z.array(fileSchema.omit({ seq: true, tool: true, callId: true })),
}).strict();
const todoSchema = z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) });
const goalSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('recorded'), text: z.string(), status: z.string() }).strict()]);
const viewSchema = z.object({ request: z.string(), latestRequest: z.string(), phase: phaseSchema, goal: goalSchema,
    todos: z.array(todoSchema).max(LIMIT.todos), activities: z.array(activitySchema).max(LIMIT.activities),
    files: z.array(fileSchema).max(LIMIT.files), omittedActivities: z.number(), omittedFiles: z.number(), omittedTodos: z.number(),
}).strict();
const stateSchema = viewSchema.extend({ inherited: z.number(), cursor: z.number(), cwd: z.string(),
    pending: z.array(pendingSchema).max(LIMIT.pending), approvals: z.array(z.string()).max(LIMIT.pending),
}).strict();
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function parse(value) {
    if (typeof value !== 'string')
        return object(value);
    // Avoid decoding unbounded tool arguments while folding old histories.
    if (value.length > 2_000_000)
        return {};
    try {
        return object(JSON.parse(value));
    }
    catch {
        return {};
    }
}
function text(value, max = 1600) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function filePath(path, cwd) {
    if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0'))
        return '';
    const paths = /^[a-z]:[\\/]|^\\\\/i.test(cwd || path) ? win32 : posix;
    return paths.isAbsolute(path) ? paths.normalize(path) : cwd ? paths.resolve(cwd, path) : paths.normalize(path);
}
/** Only named filesystem tools are evidence; shell text is never treated as a file mutation. */
function fileCandidates(name, args, cwd) {
    const path = filePath(args.file_path ?? args.path, cwd);
    if (path && ['write', 'write_file'].includes(name))
        return [{ path, operation: 'write' }];
    if (path && ['edit', 'edit_file'].includes(name))
        return [{ path, operation: 'edit' }];
    if (path && name === 'str_replace_editor' && ['create', 'str_replace', 'insert'].includes(args.command)) {
        return [{ path, operation: args.command === 'create' ? 'create' : 'edit' }];
    }
    // No parsing of apply_patch inside arbitrary shell commands or program text.
    // The standalone patch tool's explicit file markers retain operation evidence.
    if (name === 'apply_patch' && typeof args.patch === 'string') {
        return [...args.patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].slice(0, LIMIT.files)
            .flatMap(match => { const path = filePath(match[1], cwd); return path ? [{ path, operation: 'patch' }] : []; });
    }
    return [];
}
function description(name, args) {
    return text(args.description, 240) || (['bash', 'pwsh'].includes(name) ? text(args.command, 240)
        : text(args.file_path ?? args.path, 240) || text(args.query, 240) || text(args.action, 240));
}
function begin(state, data, seq, nested) {
    const callId = text(nested ? data.subCallId : data.callId, 512), name = text(data.name, 120);
    if (!callId || !name || state.activities.some(row => row.callId === callId))
        return state;
    const args = parse(data.arguments);
    const activity = { callId, tool: name, description: description(name, args), seq, status: 'running',
        parent: nested ? text(data.parentCallId, 512) : '' };
    const activities = [...state.activities, activity];
    return { ...state, activities: activities.slice(-LIMIT.activities),
        omittedActivities: state.omittedActivities + Math.max(0, activities.length - LIMIT.activities),
        pending: [...state.pending, { callId, turn: data.turn ?? -1, step: data.step ?? -1,
                files: fileCandidates(name, args, state.cwd) }].slice(-LIMIT.pending) };
}
/** New tools can expose applied diffs through the existing presentation metadata. */
function metadataFiles(meta, cwd) {
    const diffs = object(meta).diffs;
    if (!Array.isArray(diffs))
        return [];
    return diffs.slice(0, LIMIT.files).flatMap(value => {
        const diff = object(value), path = filePath(diff.path, cwd);
        const valid = (diff.oldText === null || typeof diff.oldText === 'string') && typeof diff.newText === 'string';
        return path && valid && diff.oldText !== diff.newText ? [{ path, operation: 'patch' }] : [];
    });
}
function finish(state, callId, isError, seq, turn = -1, step = -1, meta = {}) {
    const pending = state.pending.find(row => row.callId === callId);
    if (pending && turn >= 0 && (pending.turn !== turn || pending.step !== step))
        return state;
    const call = state.pending.find(row => row.callId === callId && (turn < 0 || row.turn === turn && row.step === step));
    const activity = state.activities.find(row => row.callId === callId);
    if (!call && (!activity || activity.status !== 'running'))
        return state;
    const activities = state.activities.map(row => row.callId === callId ? { ...row, status: isError ? 'failed' : 'succeeded' } : row);
    const files = [...state.files];
    const applied = metadataFiles(meta, state.cwd);
    if (!isError && activity && call)
        for (const file of applied.length ? applied : call.files) {
            const index = files.findIndex(row => row.path === file.path);
            if (index >= 0)
                files.splice(index, 1);
            files.push({ ...file, seq, tool: activity.tool, callId });
        }
    return { ...state, activities, pending: state.pending.filter(row => row !== call), files: files.slice(-LIMIT.files),
        omittedFiles: state.omittedFiles + Math.max(0, files.length - LIMIT.files) };
}
/** Pure, bounded and idempotent for repeated event delivery. Fork history is not attributed to a child. */
export function foldTaskFeedback(state, event) {
    if (event.seq < state.inherited || event.seq <= state.cursor)
        return state;
    const data = object(event.data), type = event.type;
    let next = state;
    if (type === 'user/message' && data.source?.kind === 'user') {
        const request = text((Array.isArray(data.content) ? data.content : []).map(object)
            .filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n'), 4000);
        if (request)
            next = { ...next, request: state.request || request, latestRequest: request };
    }
    if (type === 'goal/change') {
        if (data.operation === 'clear')
            next = { ...next, goal: { kind: 'none' } };
        else if (text(data.goal?.objective))
            next = { ...next, goal: { kind: 'recorded', text: text(data.goal.objective, 4000), status: text(data.goal.phase, 40) } };
    }
    if (type === 'todo/write' && Array.isArray(data.todos)) {
        const todos = data.todos.slice(0, LIMIT.todos).flatMap((item) => {
            const parsed = todoSchema.safeParse(item);
            return parsed.success ? [{ ...parsed.data, content: text(parsed.data.content, 800) }] : [];
        });
        next = { ...next, todos, omittedTodos: data.todos.length - todos.length };
    }
    if (type === 'turn/start')
        next = { ...next, phase: 'running', todos: [], omittedTodos: 0, approvals: [],
            pending: [], activities: state.activities.map(row => row.status === 'running' ? { ...row, status: 'interrupted' } : row) };
    if (type === 'turn/end')
        next = { ...next, phase: data.reason?.kind === 'error' ? 'error' : data.reason?.kind === 'aborted' ? 'interrupted' : 'idle',
            pending: [], approvals: [], activities: state.activities.map(row => row.status === 'running' ? { ...row, status: 'interrupted' } : row) };
    if (type === 'approval/asked' && typeof data.id === 'string')
        next = { ...next, phase: 'waiting', approvals: [...new Set([...state.approvals, data.id])].slice(-LIMIT.pending) };
    if (type === 'approval/decided' && state.approvals.includes(data.id)) {
        const approvals = state.approvals.filter(id => id !== data.id);
        next = { ...next, approvals, phase: approvals.length ? 'waiting' : state.phase === 'waiting' ? 'running' : state.phase };
    }
    if (type === 'tool/call' || type === 'tool/ptc-dispatch-start')
        next = begin(next, data, event.seq, type === 'tool/ptc-dispatch-start');
    if (type === 'tool/result') {
        const result = recordedToolResult(data.message);
        if (result.kind === 'record')
            next = finish(next, result.callId, result.isError, event.seq, data.turn, data.step, data.meta);
    }
    if (type === 'tool/ptc-dispatch' && typeof data.subCallId === 'string' && typeof data.isError === 'boolean') {
        next = begin(next, data, event.seq, true);
        next = finish(next, data.subCallId, data.isError, event.seq, -1, -1, data.meta);
    }
    return next === state ? state : { ...next, cursor: event.seq };
}
export const taskFeedbackProjection = {
    key: 'superCodeFeedback', stateVersion: 1, stateSchema,
    init: (header, inherited) => ({ request: '', latestRequest: '', goal: { kind: 'none' }, phase: 'idle', todos: [], activities: [], files: [],
        omittedActivities: 0, omittedFiles: 0, omittedTodos: 0, pending: [], approvals: [], inherited, cursor: -1, cwd: header.cwd ?? '' }),
    apply: foldTaskFeedback,
    wire: { viewSchema, view: state => {
            const { inherited: _inherited, cursor: _cursor, cwd: _cwd, pending: _pending, approvals: _approvals, ...view } = state;
            return view;
        } },
};
//# sourceMappingURL=task-feedback-projection.js.map