import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
interface FileFact {
    path: string;
    operation: 'write' | 'edit' | 'create' | 'patch';
    seq: number;
    tool: string;
    callId: string;
}
interface Activity {
    callId: string;
    tool: string;
    description: string;
    seq: number;
    status: 'running' | 'succeeded' | 'failed' | 'interrupted';
    parent: string;
}
export interface TaskFeedbackView {
    request: string;
    latestRequest: string;
    phase: 'idle' | 'running' | 'waiting' | 'error' | 'interrupted';
    goal: {
        kind: 'none';
    } | {
        kind: 'recorded';
        text: string;
        status: string;
    };
    todos: {
        content: string;
        status: 'pending' | 'in_progress' | 'completed';
    }[];
    activities: Activity[];
    files: FileFact[];
    omittedActivities: number;
    omittedFiles: number;
    omittedTodos: number;
}
export interface TaskFeedbackState extends TaskFeedbackView {
    inherited: number;
    cursor: number;
    cwd: string;
    approvals: string[];
    pending: {
        callId: string;
        turn: number;
        step: number;
        files: {
            path: string;
            operation: FileFact['operation'];
        }[];
    }[];
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        superCodeFeedback: TaskFeedbackState;
    }
    interface SessionProjectionMap {
        superCodeFeedback: TaskFeedbackView;
    }
}
/** Pure, bounded and idempotent for repeated event delivery. Fork history is not attributed to a child. */
export declare function foldTaskFeedback(state: TaskFeedbackState, event: SessionEvent): TaskFeedbackState;
export declare const taskFeedbackProjection: ProjectionDefinition<'superCodeFeedback', TaskFeedbackState> & {
    wire: NonNullable<ProjectionDefinition<'superCodeFeedback', TaskFeedbackState>['wire']>;
};
export {};
//# sourceMappingURL=task-feedback-projection.d.ts.map