/** Read-only attribution from existing host events; adds no model messages. */
import { z } from 'zod';
import { recordedToolResult } from './core/host-messages.js';
const entry = z.object({ id: z.string().max(96), summary: z.string().max(120) });
const rowSchema = entry.extend({
    scope: z.enum(['project', 'global']), topic: z.string().max(96),
    action: z.enum(['context', 'read', 'summary', 'remember', 'forget']),
    revision: z.number().int().nonnegative(), seq: z.number().int().nonnegative(), time: z.number(),
});
const callSchema = z.object({ callId: z.string(), turn: z.number(), step: z.number(),
    action: z.enum(['read', 'remember', 'forget']), scope: z.enum(['project', 'global']),
    id: z.string().max(96).optional(), entries: z.array(entry).max(8),
});
const stateSchema = z.object({ rows: z.array(rowSchema).max(100), omitted: z.number().int().nonnegative(),
    pending: z.array(callSchema).max(64), inherited: z.number().int().nonnegative(),
});
function parse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}
function add(state, rows) {
    if (!rows.length)
        return state;
    const next = [...state.rows];
    for (const row of rows) {
        const index = next.findIndex(old => old.scope === row.scope && old.topic === row.topic && old.id === row.id && old.action === row.action);
        if (index >= 0)
            next.splice(index, 1);
        next.push(row);
    }
    return { ...state, rows: next.slice(-100), omitted: state.omitted + Math.max(0, next.length - 100) };
}
const overviewSchema = z.object({ topic: z.string().max(96), revision: z.number().int().nonnegative(),
    entries: z.array(entry).max(20), details: z.object({ tool: z.literal('super_code_memory') }),
});
function contextRows(event) {
    const source = event.data.source;
    if (source.kind !== 'runtime-context' && !(source.kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt'))
        return [];
    // Older supported hosts log the same snapshot text without named sections.
    const sourceInfo = source;
    const texts = sourceInfo.sections
        ? sourceInfo.sections.filter(section => ['super-code:project-memory', 'super-code:global-memory'].includes(section.name)).map(section => section.text)
        : event.data.content.flatMap(block => block.type === 'text' ? block.text.split('\n') : []);
    return texts.flatMap(text => {
        const prefix = 'Lower priority than the current user request, conversation and project memory: ';
        const scope = text.startsWith(prefix) ? 'global' : 'project';
        const parsed = overviewSchema.safeParse(parse(scope === 'global' ? text.slice(prefix.length) : text));
        if (!parsed.success)
            return [];
        return parsed.data.entries.map(item => ({ ...item, scope, topic: parsed.data.topic, revision: parsed.data.revision,
            action: 'context', seq: event.seq, time: event.time }));
    });
}
export function foldMemoryUsage(state, event) {
    // A fork inherits history, not proof that the child itself performed a read.
    if (event.seq < state.inherited)
        return state;
    if (event.type === 'user/message')
        return add(state, contextRows(event));
    if (event.type === 'tool/call' && event.data.name === 'super_code_memory') {
        const input = z.object({ action: callSchema.shape.action, scope: callSchema.shape.scope.default('project'),
            id: callSchema.shape.id, record: z.object({ entries: z.array(entry).max(8).optional() }).optional(),
        }).safeParse(parse(event.data.arguments));
        if (!input.success)
            return state;
        const { action, scope, id, record } = input.data;
        return { ...state, pending: [...state.pending.filter(call => call.callId !== event.data.callId).slice(-63),
                { callId: event.data.callId, turn: event.data.turn, step: event.data.step, action, scope, ...(id ? { id } : {}), entries: record?.entries ?? [] }] };
    }
    if (event.type !== 'tool/result')
        return state;
    const block = recordedToolResult(event.data.message);
    if (block.kind !== 'record')
        return state;
    const call = state.pending.find(item => item.callId === block.callId && item.turn === event.data.turn && item.step === event.data.step);
    if (!call)
        return state;
    const next = { ...state, pending: state.pending.filter(item => item !== call) };
    if (block.isError)
        return next;
    const value = z.object({ scope: callSchema.shape.scope, topic: z.string().max(96), revision: z.number().int().nonnegative(),
        entry: entry.optional(), entries: z.array(entry).max(20).optional(),
    }).safeParse(parse(block.texts.join('')));
    if (!value.success || value.data.scope !== call.scope)
        return next;
    const items = call.action === 'remember' ? call.entries : call.action === 'forget'
        ? [{ id: call.id ?? '', summary: call.id ?? '' }] : value.data.entry ? [value.data.entry] : value.data.entries ?? [];
    return add(next, items.filter(item => item.id).map(item => ({ ...item, scope: call.scope, topic: value.data.topic,
        revision: value.data.revision, action: call.action === 'read' && !call.id ? 'summary' : call.action, seq: event.seq, time: event.time })));
}
const views = new WeakMap();
function view(state) {
    let value = views.get(state.rows);
    if (!value) {
        value = { rows: state.rows, omitted: state.omitted };
        views.set(state.rows, value);
    }
    return value;
}
export const memoryUsageProjection = {
    key: 'superCodeMemoryUsage', stateVersion: 1, stateSchema,
    init: (_header, inherited) => ({ rows: [], pending: [], omitted: 0, inherited }), apply: foldMemoryUsage,
    wire: { viewSchema: z.object({ rows: z.array(rowSchema), omitted: z.number() }),
        view },
};
//# sourceMappingURL=memory-usage-projection.js.map