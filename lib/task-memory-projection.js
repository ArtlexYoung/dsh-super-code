import { emptyTaskMemory, foldTaskMemory, taskMemoryStateSchema, taskMemoryEventSchema } from './core/task-memory.js';
export const TASK_MEMORY_SOURCE = 'dsh-super-agent/task-memory/v1';
/** Known host message vocabulary keeps external plugin records resumable. */
export function taskMemoryEventOf(event) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin' || event.data.source.plugin !== TASK_MEMORY_SOURCE)
        return { kind: 'unrelated' };
    const content = event.data.content;
    if (content.length !== 1 || content[0]?.type !== 'text')
        throw new Error('Malformed task-memory record');
    return { kind: 'record', record: taskMemoryEventSchema.parse(JSON.parse(content[0].text)) };
}
/** Host checkpoints restore the bounded working set without summarizing summaries. */
export const taskMemoryProjection = {
    key: 'superCodeTasks', stateVersion: 1, stateSchema: taskMemoryStateSchema,
    init: () => emptyTaskMemory(),
    apply: (state, event) => {
        const record = taskMemoryEventOf(event);
        if (record.kind === 'record')
            return foldTaskMemory(state, record.record);
        if (event.type === 'user/message' && event.data.source.kind === 'user') {
            return { ...state, recentSources: [...state.recentSources.slice(-7), event.seq] };
        }
        return state;
    },
    wire: { viewSchema: taskMemoryStateSchema, view: state => state },
};
//# sourceMappingURL=task-memory-projection.js.map