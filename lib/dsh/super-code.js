import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session';
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { TEAM_NAMES, METHODS, SUPER_CODE_INSTRUCTIONS, readTeamMethod } from '../core/teams.js';
import { EXPERIMENT_RECIPES, readExperimentRecipe } from '../core/experiment-recipes.js';
import { taskMemoryProjection, taskMemoryEventOf } from '../task-memory-projection.js';
import { requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemoryRead, taskMemoryCreateSchema, taskMemoryPatchSchema, taskMemorySchema, sourceSchema } from '../core/task-memory.js';
import { createMemberBrief, validateMemberResult } from '../core/delegation.js';
import { z as json } from 'zod';
import { createGuidanceSelector, GUIDED_INSTRUCTIONS } from '../core/guidance.js';
import { listToolEvidence, readToolEvidence, toolEvidenceRef } from '../core/tool-evidence.js';
import { scanSessionPage } from '../core/session-scan.js';
import { TaskMemoryStore } from '../task-memory-store.js';
import { LongMemoryStore, longMemoryContext, longMemoryEntrySchema, memoryWorkspace, memoryGlobalNamespace, GLOBAL_PREFERENCES_TOPIC } from '../long-memory.js';
export const name = 'super-code';
export const inject = ['tools', 'systemPrompt', 'sessions', 'sessionProjections'];
export const Config = z.object({
    maxTasks: z.number().step(1).min(1).max(128).default(32),
    maxContextBytes: z.number().step(1).min(1024).max(262144).default(32768),
    guidedRoutes: z.array(z.object({ provider: z.string().required(), model: z.string().required() })),
});
function assertSource(session, source) {
    const event = session.eventAt(SessionSeq(source.seq));
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user')
        throw new Error('Requirement source must reference a direct user message in this session');
    const original = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (!original.includes(source.quote))
        throw new Error('Requirement quote is not present in its original user message');
}
/** Schema-owned expectations only; never echo submitted values or arbitrary error messages. */
function inputIssue(issue) {
    let hint = issue.code;
    if (issue.code === 'invalid_type')
        hint += `; expected ${issue.expected}`;
    if (issue.code === 'too_small')
        hint += `; ${issue.origin} ${issue.inclusive ? 'min' : 'greater than'} ${issue.minimum}`;
    if (issue.code === 'too_big')
        hint += `; ${issue.origin} ${issue.inclusive ? 'max' : 'less than'} ${issue.maximum}`;
    return `${issue.path.map(String).join('.').slice(0, 120) || 'record'} (${hint})`;
}
// Runtime-only contracts keep the model-facing schema compact without silently ignoring fields.
const actionFields = {
    list: { required: [] }, read: { required: ['taskId'], optional: ['view'] },
    source: { required: ['eventSeq'] }, history: { required: ['eventSeq'] },
    create: { required: ['record'] }, update: { required: ['taskId', 'expectedRevision', 'record'] },
    focus: { required: ['taskId'] }, archive: { required: ['taskId', 'expectedRevision'] },
    archives: { required: [], optional: ['taskId', 'eventSeq'] }, restore: { required: ['eventSeq', 'record'] },
    delegate: { required: ['taskId', 'record'] }, validate_member: { required: ['taskId', 'record'] },
    evidence: { required: [], optional: ['eventSeq', 'record'] },
};
function assertActionFields(args) {
    if (!Object.hasOwn(actionFields, args.action))
        throw new Error('Unsupported task action');
    const rule = actionFields[args.action];
    for (const field of rule.required)
        if (args[field] === undefined)
            throw new Error(`${args.action} requires ${field}; no task snapshot was appended.`);
    for (const field of ['taskId', 'expectedRevision', 'eventSeq', 'record', 'view']) {
        if (args[field] !== undefined && !rule.required.includes(field) && !rule.optional?.includes(field))
            throw new Error(`${field} is not supported by ${args.action}`);
    }
    if (args.action === 'evidence' && args.record !== undefined && args.eventSeq !== undefined)
        throw new Error('evidence accepts either a record or an eventSeq cursor');
}
/** Installs no agent loop and starts no model calls. */
export function apply(ctx, config = {}) {
    const maxTasks = config.maxTasks ?? 32;
    const maxContextBytes = config.maxContextBytes ?? 32768;
    const selectGuidance = createGuidanceSelector(config.guidedRoutes);
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 128 || !Number.isSafeInteger(maxContextBytes) || maxContextBytes < 1024 || maxContextBytes > 262144)
        throw new Error('Invalid super-code capacity');
    ctx.sessionProjections.register(taskMemoryProjection);
    const memory = new TaskMemoryStore(ctx, maxContextBytes);
    ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: SUPER_CODE_INSTRUCTIONS });
    // Wrap the host selection waterfall: providers run before its model snapshot is resolved.
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next();
        if (selectGuidance(assembled.variables.provider, assembled.variables.model) === 'standard')
            return assembled;
        return { ...assembled, sections: assembled.sections.map(section => section.name === PERSONA_PREFIX_SECTION && section.text === SUPER_CODE_INSTRUCTIONS
                ? { ...section, text: `${section.text}\n${GUIDED_INSTRUCTIONS}` } : section) };
    }, { prepend: true });
    ctx.systemPrompt.context({ name: 'super-code:tasks', order: 80, text: ({ agent }) => {
            if (agent === undefined)
                return '';
            if (memory.isPending(agent.session))
                return 'The last task-memory checkpoint is unconfirmed. Use super_code_task read to retry persistence before relying on it.';
            return taskMemoryContext(memory.current(agent.session), maxContextBytes);
        } });
    ctx.systemPrompt.context({ name: 'super-code:project-memory', order: 81, text: ({ agent }) => {
            if (!agent)
                return '';
            if (memory.isPending(agent.session))
                return '';
            const state = memory.current(agent.session);
            const task = state.focus.kind === 'task' ? state.tasks[state.focus.id] : undefined;
            if (!task?.topic)
                return '';
            const longMemory = ctx.get('superCodeLongMemory');
            if (!longMemory)
                return 'Long memory is unavailable; current task memory remains available.';
            let workspace;
            try {
                workspace = memoryWorkspace(agent.session);
            }
            catch {
                return 'Long memory cannot read this workspace; verify its path before relying on it.';
            }
            const found = longMemory.read(workspace, task.topic);
            return found.kind === 'found' ? longMemoryContext(found.value, 2048, task.sourceVersion) : '';
        } });
    ctx.systemPrompt.context({ name: 'super-code:global-memory', order: 82, text: ({ agent }) => {
            if (!agent || memory.isPending(agent.session))
                return '';
            const longMemory = ctx.get('superCodeLongMemory');
            if (!longMemory)
                return '';
            const found = longMemory.read(memoryGlobalNamespace(), GLOBAL_PREFERENCES_TOPIC);
            return found.kind === 'found' ? `Lower priority than the current user request, conversation and project memory: ${longMemoryContext(found.value, 1024)}` : '';
        } });
    ctx.tools.register(defineTool({
        name: 'super_code_method',
        description: 'Read expertise when causes remain indistinguishable, failures repeat or recovery/state behavior is unclear. Select a method directly; omit it only to inspect a team. Reuse loaded guidance; batch with independent reads. Not a routine prerequisite.',
        parameters: { team: { type: 'string', enum: TEAM_NAMES, required: true }, method: { type: 'string', enum: Object.keys(METHODS) },
            recipe: { type: 'string', enum: EXPERIMENT_RECIPES, description: 'Optional runnable Shell example for a hard problem: failure reduction, differential oracle, controlled async interleavings or contract relation. Omit when unnecessary.' } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const method = readTeamMethod(args.team, args.method);
            return args.recipe === undefined ? method : `${method}\n\n${readExperimentRecipe(args.recipe)}`;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'super_code_task',
        description: `Task memory; never grants permission or executes work. Simple tasks need no record. Actions: list; read(taskId,view?); source(eventSeq); create(record); update(taskId,expectedRevision,record patch); focus(taskId); archive(taskId,expectedRevision); history(eventSeq). Create fields: id,title,team,depth,workspace,sourceVersion,goal,source:{seq,quote},requirements:[{id,text,source:{seq,quote}}],acceptance:[string]. Optional topic is a specific project task category shared across sessions; keyPoints:[{kind:constraint|fact|decision|next,summary:up to 30 characters}] replaces routine decision text in context, with full details still readable. Source seqs appear in runtime context. Update preserves omitted fields; requirement entries replace matching ids, removeRequirements explicitly removes ids. Goal/requirements/workspace/acceptance/topic changes need a user source. Old evidence and key points become stale on requirements/source revision changes. Optional updates: decisions:[string], evidence:[{summary,ref,sourceVersion,requirementsRevision,kind:observed|assumption|test|decision}], next:string, status:active|paused|completed|cancelled. Archive only finished tasks; keep eventSeq to read history. Focus does not stop work. delegate(taskId,record:{owner,attemptId,objective,ownedPaths:[string],acceptance:[string],maxTokens}) returns a compact brief to pass to host subagent. validate_member(taskId,record:{assignment:original assignment,result:{binding,owner,attemptId,outcome:completed|failed|cancelled|stop_unknown,summary,artifacts:[string],checks:[string],unknowns:[string]}}) rejects stale returns; reviewable still needs lead review. Accounting is separate; never guess costs or treat model-reported usage as a verified budget.`,
        // Pagination never scans or returns an unbounded archive in one tool call.
        parameters: {
            action: { type: 'string', enum: ['list', 'read', 'source', 'create', 'update', 'focus', 'archive', 'archives', 'restore', 'history', 'delegate', 'validate_member', 'evidence'], required: true,
                description: 'evidence: record:{callSeq,resultSeq} or {ref} reads a pair, not acceptance/current-code proof. Long output returns a head/tail excerpt and readMore; optional record.offset reads original text pages (UTF-16 offsets). Without record, list identities; match callId/turn/step and inspect arguments. Directory/archives use exclusive eventSeq/nextBeforeSeq; done=false means more. archives optionally filters taskId. restore: archived eventSeq plus record:{source:{seq,quote},sourceVersion}, after user asks to resume and you inspect the workspace. sourceVersion must distinguish relevant working-tree edits, not just HEAD. Recorded versions do not verify current files. Restore retains requirements and invalidates old evidence; starts no workers.' },
            taskId: { type: 'string' }, expectedRevision: { type: 'integer' }, eventSeq: { type: 'integer', description: 'Use visible runtime source identities; if the newest user source is absent, list returns recentUserEventSeqs. Never guess an event sequence.' }, record: { type: 'json' },
            view: { type: 'string', enum: ['resume', 'full'], description: 'Only for read: default resume returns {current} with all constraints and bounded current evidence. full retrieves omitted details: source quotes, all evidence and versions. Stale evidence is historical, not current proof.' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (args, exec) => {
            try {
                if (exec.agent === undefined)
                    throw new Error('super-code requires an agent-owned session');
                assertActionFields(args);
                const session = exec.agent.session;
                if (args.action === 'evidence') {
                    exec.signal.throwIfAborted();
                    if (args.record === undefined)
                        return JSON.stringify(await listToolEvidence(session.seq, args.eventSeq ?? session.seq, seq => session.eventAt(SessionSeq(seq)), exec.signal));
                    const input = json.union([
                        json.object({ ref: json.string().min(1).max(4000), offset: json.number().int().nonnegative().safe().optional() }).strict(),
                        json.object({ callSeq: json.number().int().nonnegative(), resultSeq: json.number().int().nonnegative(), offset: json.number().int().nonnegative().safe().optional() }).strict(),
                    ]).parse(args.record);
                    const ref = 'ref' in input ? input.ref : toolEvidenceRef({ ...input, sessionId: session.id });
                    return JSON.stringify(readToolEvidence(session.id, ref, seq => session.eventAt(SessionSeq(seq)), input.offset));
                }
                const mutating = ['create', 'update', 'focus', 'archive', 'restore'].includes(args.action);
                if (!mutating) {
                    const { state, end } = await memory.read(session, exec.signal);
                    if (args.action === 'archives') {
                        const records = [];
                        const page = await scanSessionPage(end, args.eventSeq ?? end, seq => session.eventAt(SessionSeq(seq)), event => {
                            const item = taskMemoryEventOf(event);
                            if (item.kind === 'record' && item.record.kind === 'archive' && (args.taskId === undefined || item.record.task.id === args.taskId)) {
                                const { id, title, status } = item.record.task;
                                records.push({ eventSeq: event.seq, id, title, status });
                            }
                            return records.length >= 10;
                        }, exec.signal);
                        return JSON.stringify({ records, ...page });
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
                    if (args.action === 'read') {
                        const task = requireTaskMemory(state, args.taskId ?? '');
                        return args.view === 'full' ? JSON.stringify(task) : taskMemoryRead(task, maxContextBytes);
                    }
                    if (args.action === 'delegate' || args.action === 'validate_member') {
                        const task = requireTaskMemory(state, args.taskId ?? '');
                        if (args.action === 'delegate')
                            return JSON.stringify(createMemberBrief(task, session.id, args.record));
                        const envelope = json.object({ assignment: json.unknown(), result: json.unknown() }).strict().parse(args.record);
                        return JSON.stringify(validateMemberResult(task, session.id, envelope.assignment, envelope.result));
                    }
                    throw new Error('Unsupported task action');
                }
                const receipt = await memory.write(session, exec.signal, state => {
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
                        change = { kind: 'save', task: taskMemorySchema.parse({ ...task, ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: task.requirementsRevision + 1, delegationRevision: 1, status: 'active', decisions: [], keyPoints: [], next: '' }) };
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
                        if (args.action === 'focus') {
                            if (state.focus.kind === 'task' && state.focus.id === task.id)
                                return { kind: 'unchanged', id: task.id, revision: task.revision };
                            change = { kind: 'focus', id: task.id };
                        }
                        else {
                            if (args.expectedRevision === undefined)
                                throw new Error(`${args.action} requires expectedRevision; use the current task view. No task snapshot was appended.`);
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
                                const revised = reviseTaskMemory(task, patch, args.expectedRevision);
                                if (revised === task)
                                    return { kind: 'unchanged', id: task.id, revision: task.revision };
                                change = { kind: 'save', task: revised };
                            }
                        }
                    }
                    return change;
                });
                return JSON.stringify({ action: args.action, ...receipt });
            }
            catch (error) {
                if (error instanceof json.ZodError)
                    throw new Error(`Invalid ${args.action} input: ${error.issues.slice(0, 4).map(inputIssue).join('; ')}${error.issues.length > 4 ? '; additional invalid fields omitted' : ''}. Check the action fields; no automatic correction was applied.`);
                throw error;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'super_code_memory',
        description: 'Three scopes: conversation task memory lives in the session; project memory is shared by sessions in the same workspace and focused topic; global memory contains only explicit cross-project user preferences in the host storage root. Use scope:project (default) or scope:global. actions: topics pages project categories; read returns summaries or one full entry; remember adds/replaces up to 8 sourced entries, summary <=30 characters; forget removes an id. Global remember requires record.globalConfirmed:true, kind:constraint and a direct user quote stating a cross-project preference. Project facts and experience require a tool source and current sourceVersion. Entries are historical, do not verify mutable facts or grant permission.',
        parameters: { action: { type: 'string', enum: ['topics', 'read', 'remember', 'forget'], required: true },
            scope: { type: 'string', enum: ['project', 'global'], description: 'Default project. Global is for explicit cross-project user preferences only.' },
            id: { type: 'string', description: 'Only for read or forget. Omit for topic overview.' }, record: { type: 'json' } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async (args, exec) => {
            if (!exec.agent)
                throw new Error('Long memory requires an agent-owned session');
            const session = exec.agent.session;
            const longMemory = ctx.get('superCodeLongMemory');
            if (!longMemory)
                throw new Error('Long memory storage is unavailable');
            const scope = args.scope ?? 'project';
            if (scope !== 'project' && scope !== 'global')
                throw new Error('Unknown memory scope');
            const workspace = scope === 'global' ? memoryGlobalNamespace() : memoryWorkspace(session);
            if (args.action === 'topics') {
                if (args.id !== undefined)
                    throw new Error('topics does not accept id');
                const { offset } = json.object({ offset: json.number().int().nonnegative().safe().default(0) }).strict().parse(args.record ?? {});
                const topics = scope === 'global' ? longMemory.topics(workspace).filter(item => item.topic === GLOBAL_PREFERENCES_TOPIC) : longMemory.topics(workspace);
                const page = topics.slice(offset, offset + 20);
                const nextOffset = offset + page.length;
                return JSON.stringify({ topics: page, total: topics.length, nextOffset: nextOffset < topics.length ? nextOffset : undefined });
            }
            const state = (await memory.read(session, exec.signal)).state;
            const task = state.focus.kind === 'task' ? requireTaskMemory(state, state.focus.id) : undefined;
            if (scope === 'project' && !task?.topic)
                throw new Error('Focus a task with a topic before accessing project memory');
            const topic = scope === 'global' ? GLOBAL_PREFERENCES_TOPIC : task.topic;
            const found = longMemory.read(workspace, topic);
            const current = found.kind === 'found' ? found.value : undefined;
            if (args.action === 'read') {
                if (args.record !== undefined)
                    throw new Error('read does not accept record');
                if (args.id === undefined) {
                    if (!current)
                        return JSON.stringify({ scope, topic, revision: 0, entries: [], ids: [] });
                    return JSON.stringify({ scope, ...JSON.parse(longMemoryContext(current, scope === 'global' ? 1024 : 2048, task?.sourceVersion)), ids: current.entries.map(entry => entry.id) });
                }
                if (found.kind === 'missing')
                    throw new Error(`Unknown memory ${args.id}`);
                const entry = found.value.entries.find(item => item.id === args.id);
                if (!entry)
                    throw new Error(`Unknown memory ${args.id}`);
                const sourceSession = ctx.sessions.get(SessionId(entry.source.sessionId));
                let sourceAvailability = 'session-not-live';
                if (sourceSession) {
                    try {
                        if (entry.source.kind === 'user') {
                            assertSource(sourceSession, { seq: entry.source.eventSeq, quote: entry.source.quote });
                            sourceAvailability = 'available';
                        }
                        else {
                            const ref = toolEvidenceRef({ sessionId: sourceSession.id, callSeq: entry.source.callSeq, resultSeq: entry.source.eventSeq });
                            sourceAvailability = readToolEvidence(sourceSession.id, ref, seq => sourceSession.eventAt(SessionSeq(seq))).kind === 'recorded' ? 'available' : 'unavailable';
                        }
                    }
                    catch {
                        sourceAvailability = 'unavailable';
                    }
                }
                return JSON.stringify({ scope, topic, revision: found.value.revision, entry, sourceAvailability,
                    basis: 'historical; tool source pair checked at write time, summary/detail not semantically verified; source availability does not reverify mutable facts or grant permission' });
            }
            if (args.action === 'remember') {
                if (args.id !== undefined)
                    throw new Error('remember does not accept id');
                const input = json.object({ expectedRevision: json.number().int().nonnegative(), globalConfirmed: json.boolean().optional(), entries: json.array(json.object({
                        id: json.string(), kind: json.enum(['constraint', 'fact', 'experience']), summary: json.string(), detail: json.string(),
                        sourceVersion: json.string().optional(), source: json.object({
                            kind: json.enum(['user', 'tool']), eventSeq: json.number().int().nonnegative(), quote: json.string().min(1).max(4000).optional(),
                            callSeq: json.number().int().nonnegative().optional(),
                        }).strict(),
                    }).strict()).min(1).max(8) }).strict().parse(args.record);
                if (scope === 'global' && input.globalConfirmed !== true)
                    throw new Error('Global memory requires explicit confirmation in this request');
                if (scope === 'project' && input.globalConfirmed !== undefined)
                    throw new Error('globalConfirmed is only valid for global memory');
                const entries = input.entries.map(entry => {
                    if (scope === 'global' && (entry.kind !== 'constraint' || entry.sourceVersion !== undefined)) {
                        throw new Error('Global memory accepts only sourced user preferences');
                    }
                    if (entry.kind === 'constraint') {
                        if (entry.source.kind !== 'user' || !entry.source.quote || entry.source.callSeq !== undefined)
                            throw new Error('A constraint needs a quoted user source');
                        assertSource(session, { seq: entry.source.eventSeq, quote: entry.source.quote });
                    }
                    else {
                        if (entry.source.kind !== 'tool' || entry.source.callSeq === undefined || entry.source.quote !== undefined
                            || !entry.sourceVersion || entry.sourceVersion !== task?.sourceVersion)
                            throw new Error('A fact or experience needs current tool evidence and version');
                        const ref = toolEvidenceRef({ sessionId: session.id, callSeq: entry.source.callSeq, resultSeq: entry.source.eventSeq });
                        const observed = readToolEvidence(session.id, ref, seq => session.eventAt(SessionSeq(seq)));
                        if (observed.kind !== 'recorded' || (entry.kind === 'fact' && observed.outcome !== 'tool-returned')) {
                            throw new Error('Tool source is unavailable or failed');
                        }
                    }
                    return longMemoryEntrySchema.parse({ ...entry, source: { ...entry.source, sessionId: session.id } });
                });
                exec.signal.throwIfAborted();
                if (!await ctx.sessions.flush(session))
                    throw new Error('No host persistence checkpoint is configured; memory sources are not durable');
                exec.signal.throwIfAborted();
                const saved = await longMemory.remember(workspace, topic, input.expectedRevision, entries);
                return JSON.stringify({ scope, topic: saved.topic, revision: saved.revision, count: saved.entries.length });
            }
            if (args.action === 'forget') {
                if (args.id === undefined)
                    throw new Error('forget requires id');
                const input = json.object({ expectedRevision: json.number().int().positive(), source: sourceSchema }).strict().parse(args.record);
                assertSource(session, input.source);
                exec.signal.throwIfAborted();
                if (!await ctx.sessions.flush(session))
                    throw new Error('No host persistence checkpoint is configured; memory sources are not durable');
                exec.signal.throwIfAborted();
                const saved = await longMemory.forget(workspace, topic, input.expectedRevision, args.id);
                return JSON.stringify({ scope, topic: saved.topic, revision: saved.revision, count: saved.entries.length });
            }
            throw new Error('Unsupported memory action');
        },
    }));
}
const plugin = { name, inject, Config, apply };
export default plugin;
//# sourceMappingURL=super-code.js.map