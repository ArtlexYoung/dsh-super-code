import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TaskMemoryState, TaskMemoryEvent } from './core/task-memory.js';
export interface TaskMemoryView {
    tasks: {
        id: string;
        title: string;
        status: string;
    }[];
    current: {
        kind: 'none';
    } | {
        kind: 'task';
        id: string;
        title: string;
        goal: string;
        status: string;
        next: string;
    };
}
/** The browser needs a task summary, never the durable source quotes or evidence. */
export declare function taskMemoryView(state: TaskMemoryState): TaskMemoryView;
export declare const TASK_MEMORY_SOURCE = "dsh-super-code/task-memory/v1";
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
        superCodeTasks: TaskMemoryView;
    }
}
/** Host checkpoints restore the bounded working set without summarizing summaries. */
export declare const taskMemoryProjection: ProjectionDefinition<'superCodeTasks', TaskMemoryState> & {
    wire: NonNullable<ProjectionDefinition<'superCodeTasks', TaskMemoryState>['wire']>;
};
//# sourceMappingURL=task-memory-projection.d.ts.map