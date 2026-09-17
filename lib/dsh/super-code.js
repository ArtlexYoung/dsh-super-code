import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { TEAM_NAMES, METHODS, SUPER_CODE_INSTRUCTIONS, readTeamMethod } from '../core/teams.js';
import { taskMemoryProjection, taskMemoryEventOf, TASK_MEMORY_SOURCE } from '../task-memory-projection.js';
import { foldTaskMemory, requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemoryCreateSchema, taskMemoryPatchSchema, taskMemorySchema, sourceSchema } from '../core/task-memory.js';
import { createMemberBrief, validateMemberResult } from '../core/delegation.js';
import { z as json } from 'zod';
export const name = 'super-code';
export const inject = ['tools', 'systemPrompt', 'sessions', 'sessionProjections'];
export const Config = z.object({ maxTasks: z.number().step(1).min(1).max(128).default(32), maxContextBytes: z.number().step(1).min(1024).max(262144).default(32768) });
function assertSource(session, source) {
    const event = session.eventAt(SessionSeq(source.seq));
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user')
        throw new Error('Requirement source must reference a direct user message in this session');
    const original = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (!original.includes(source.quote))
        throw new Error('Requirement quote is not present in its original user message');
}
/** Installs no agent loop and starts no model calls. */
export function apply(ctx, config = {}) {
    const maxTasks = config.maxTasks ?? 32;
    const maxContextBytes = config.maxContextBytes ?? 32768;
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 128 || !Number.isSafeInteger(maxContextBytes) || maxContextBytes < 1024 || maxContextBytes > 262144)
        throw new Error('Invalid super-code capacity');
    ctx.sessionProjections.register(taskMemoryProjection);
    const pending = new WeakSet();
    const locks = new WeakMap();
    const stateOf = (session) => {
        const state = ctx.sessionProjections.stateOf(session, 'superCodeTasks');
        if (state === undefined)
            throw new Error('super-code task projection is unavailable');
        return state;
    };
    const checkpoint = async (session) => {
        if (!await ctx.sessions.flush(session))
            throw new Error('No host persistence checkpoint is configured; task memory is not durable');
        pending.delete(session);
    };
    ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: SUPER_CODE_INSTRUCTIONS });
    ctx.systemPrompt.context({ name: 'super-code:tasks', order: 80, text: ({ agent }) => {
            if (agent === undefined)
                return '';
            if (pending.has(agent.session))
                return 'The last task-memory checkpoint is unconfirmed. Use super_code_task read to retry persistence before relying on it.';
            return taskMemoryContext(stateOf(agent.session), maxContextBytes);
        } });
    ctx.tools.register(defineTool({
        name: 'super_code_method',
        description: 'Read one professional team and optionally shared expertise. Choose by the requested deliverable, not keywords. Routine tasks need no method call.',
        parameters: { team: { type: 'string', enum: TEAM_NAMES, required: true }, method: { type: 'string', enum: Object.keys(METHODS) } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        isConcurrencySafe: () => true,
        execute: async (args) => readTeamMethod(args.team, args.method),
    }));
    ctx.tools.register(defineTool({
        name: 'super_code_task',
        description: `Task memory; never grants permission or executes work. Simple tasks need no record. Actions: list; read(taskId); source(eventSeq); create(record); update(taskId,expectedRevision,record patch); focus(taskId); archive(taskId,expectedRevision); history(eventSeq). Create fields: id,title,team,depth,workspace,sourceVersion,goal,source:{seq,quote},requirements:[{id,text,source:{seq,quote}}],acceptance:[string]. Source seqs appear in runtime context. Update preserves omitted fields; requirement entries replace matching ids, removeRequirements explicitly removes ids. Goal/requirements/workspace/acceptance changes need a user source. Old evidence becomes stale on requirements/source revision changes. Optional updates: decisions:[string], evidence:[{summary,ref,sourceVersion,requirementsRevision,kind:observed|assumption|test|decision}], next:string, status:active|paused|completed|cancelled. Archive only finished tasks; keep eventSeq to read history. Focus does not stop work. delegate(taskId,record:{owner,attemptId,objective,ownedPaths:[string],acceptance:[string],maxTokens}) returns a compact brief to pass to host subagent. validate_member(taskId,record:{assignment:original assignment,result:{binding,owner,attemptId,outcome:completed|failed|cancelled|stop_unknown,summary,artifacts:[string],checks:[string],unknowns:[string],cost:{inputTokens,outputTokens,cachedTokens,toolCalls,complete}}}) rejects stale returns; reviewable still needs lead review.`,
        // Pagination never scans or returns an unbounded archive in one tool call.
        parameters: {
            action: { type: 'string', enum: ['list', 'read', 'source', 'create', 'update', 'focus', 'archive', 'archives', 'restore', 'history', 'delegate', 'validate_member'], required: true,
                description: 'archives: newest first, optional taskId filter and exclusive eventSeq cursor; continue with nextBeforeSeq until done. restore: archived eventSeq plus record:{source:{seq,quote},sourceVersion}, after user asks to resume and you inspect the current version. Restoration retains requirements, invalidates old evidence and starts no workers.' },
            taskId: { type: 'string' }, expectedRevision: { type: 'integer' }, eventSeq: { type: 'integer' }, record: { type: 'json' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (args, exec) => {
            if (exec.agent === undefined)
                throw new Error('super-code requires an agent-owned session');
            const session = exec.agent.session;
            const previous = locks.get(session) ?? Promise.resolve();
            const operation = previous.catch(() => { }).then(async () => {
                exec.signal.throwIfAborted();
                if (pending.has(session))
                    await checkpoint(session);
                exec.signal.throwIfAborted();
                const state = stateOf(session);
                if (args.action === 'archives') {
                    let cursor = args.eventSeq ?? session.seq;
                    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > session.seq)
                        throw new Error('Invalid archive cursor');
                    const records = [];
                    // Bound both scanning work and output; callers continue from nextBeforeSeq.
                    for (let scanned = 0; cursor > 0 && scanned < 256 && records.length < 10; scanned++) {
                        const event = session.eventAt(SessionSeq(--cursor));
                        if (event === undefined)
                            continue;
                        const item = taskMemoryEventOf(event);
                        if (item.kind === 'record' && item.record.kind === 'archive' && (args.taskId === undefined || item.record.task.id === args.taskId)) {
                            const { id, title, status } = item.record.task;
                            records.push({ eventSeq: event.seq, id, title, status });
                        }
                    }
                    return JSON.stringify({ records, nextBeforeSeq: cursor, done: cursor === 0 });
                }
                if (args.action === 'list')
                    return JSON.stringify({ tasks: Object.values(state.tasks).map(({ id, title, status, revision }) => ({ id, title, status, revision })), focus: state.focus, recentUserEventSeqs: state.recentSources });
                if (args.action === 'source' || args.action === 'history') {
                    if (args.eventSeq === undefined)
                        throw new Error('eventSeq is required');
                    const event = session.eventAt(SessionSeq(args.eventSeq));
                    if (args.action === 'source' && event?.type === 'user/message' && event.data.source.kind === 'user')
                        return JSON.stringify(event);
                    if (args.action === 'history' && event !== undefined && taskMemoryEventOf(event).kind === 'record')
                        return JSON.stringify(event);
                    throw new Error('The event is not a matching source or task record');
                }
                if (args.action === 'read')
                    return JSON.stringify(requireTaskMemory(state, args.taskId ?? ''));
                if (args.action === 'delegate' || args.action === 'validate_member') {
                    const task = requireTaskMemory(state, args.taskId ?? '');
                    if (args.action === 'delegate')
                        return JSON.stringify(createMemberBrief(task, session.id, args.record));
                    const envelope = json.object({ assignment: json.unknown(), result: json.unknown() }).strict().parse(args.record);
                    return JSON.stringify(validateMemberResult(task, session.id, envelope.assignment, envelope.result));
                }
                let change;
                if (args.action === 'restore') {
                    if (!Number.isSafeInteger(args.eventSeq) || args.eventSeq < 0)
                        throw new Error('An archived eventSeq is required');
                    const event = session.eventAt(SessionSeq(args.eventSeq));
                    if (event === undefined)
                        throw new Error('Unknown archive event');
                    const archived = taskMemoryEventOf(event);
                    if (archived.kind !== 'record' || archived.record.kind !== 'archive')
                        throw new Error('Only archived tasks can be restored');
                    const record = json.object({ source: sourceSchema, sourceVersion: json.string().trim().min(1).max(4000) }).strict().parse(args.record);
                    assertSource(session, record.source);
                    if (record.source.seq <= event.seq)
                        throw new Error('Restoration requires a user message after the archive');
                    const task = archived.record.task;
                    if (Object.hasOwn(state.tasks, task.id))
                        throw new Error(`Task ${task.id} already exists`);
                    if (Object.keys(state.tasks).length >= maxTasks)
                        throw new Error('Working set is full; archive a completed task first');
                    change = { kind: 'save', task: taskMemorySchema.parse({ ...task, ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: task.requirementsRevision + 1, delegationRevision: 1, status: 'active', decisions: [], next: '' }) };
                }
                else if (args.action === 'create') {
                    const record = taskMemoryCreateSchema.parse(args.record);
                    if (Object.hasOwn(state.tasks, record.id))
                        throw new Error(`Task ${record.id} already exists`);
                    if (Object.keys(state.tasks).length >= maxTasks)
                        throw new Error('Working set is full; archive a completed task first');
                    if (new Set(record.requirements.map(item => item.id)).size !== record.requirements.length)
                        throw new Error('Duplicate requirement ids');
                    assertSource(session, record.source);
                    record.requirements.forEach(item => assertSource(session, item.source));
                    change = { kind: 'save', task: taskMemorySchema.parse({ ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: 1, delegationRevision: 1, status: 'active', decisions: [], evidence: [], next: '' }) };
                }
                else {
                    const task = requireTaskMemory(state, args.taskId ?? '');
                    if (args.action === 'focus')
                        change = { kind: 'focus', id: task.id };
                    else {
                        if (args.expectedRevision !== task.revision)
                            throw new Error(`Stale task ${task.id}; read revision ${task.revision} first`);
                        if (args.action === 'archive') {
                            if (task.status !== 'completed' && task.status !== 'cancelled')
                                throw new Error('Only completed or cancelled memory can be archived; stop workers separately');
                            change = { kind: 'archive', task };
                        }
                        else {
                            const patch = taskMemoryPatchSchema.parse(args.record);
                            if (patch.source !== undefined)
                                assertSource(session, patch.source);
                            patch.requirements?.forEach(item => assertSource(session, item.source));
                            change = { kind: 'save', task: reviseTaskMemory(task, patch, args.expectedRevision) };
                        }
                    }
                }
                const next = foldTaskMemory(state, change);
                // Reject before append, including an oversized nonfocused task that would fail on resume.
                // Reserve room for eight later source seqs so a plain user turn cannot overflow the context.
                const preview = { ...next, recentSources: Array(8).fill(Number.MAX_SAFE_INTEGER) };
                taskMemoryContext(preview, maxContextBytes);
                for (const id of Object.keys(next.tasks))
                    taskMemoryContext({ ...preview, focus: { kind: 'task', id } }, maxContextBytes);
                exec.signal.throwIfAborted();
                const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: JSON.stringify(change) }], source: { kind: 'plugin', plugin: TASK_MEMORY_SOURCE } }), { surfaceOp: 'append' });
                pending.add(session);
                await checkpoint(session);
                return JSON.stringify({ eventSeq: event.seq, action: args.action, ...(change.kind === 'focus' ? { id: change.id } : { id: change.task.id, revision: change.task.revision }) });
            });
            locks.set(session, operation);
            try {
                return await operation;
            }
            finally {
                if (locks.get(session) === operation)
                    locks.delete(session);
            }
        },
    }));
}
const plugin = { name, inject, Config, apply };
export default plugin;
//# sourceMappingURL=super-code.js.map