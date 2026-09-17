import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TaskMemoryState, TaskMemoryEvent } from './core/task-memory.js';
export declare const TASK_MEMORY_SOURCE = "dsh-super-agent/task-memory/v1";
/** Known host message vocabulary keeps external plugin records resumable. */
export declare function taskMemoryEventOf(event: SessionEvent): {
    kind: 'record';
    record: TaskMemoryEvent;
} | {
    kind: 'unrelated';
};
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        superCodeTasks: TaskMemoryState;
    }
    interface SessionProjectionMap {
        superCodeTasks: TaskMemoryState;
    }
}
/** Host checkpoints restore the bounded working set without summarizing summaries. */
export declare const taskMemoryProjection: ProjectionDefinition<'superCodeTasks', TaskMemoryState> & {
    wire: NonNullable<ProjectionDefinition<'superCodeTasks', TaskMemoryState>['wire']>;
};
//# sourceMappingURL=task-memory-projection.d.ts.map