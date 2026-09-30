import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
export interface MemoryUsageRow {
    id: string;
    summary: string;
    scope: 'project' | 'global';
    topic: string;
    action: 'context' | 'read' | 'summary' | 'remember' | 'forget';
    revision: number;
    seq: number;
    time: number;
}
export interface MemoryUsageState {
    rows: MemoryUsageRow[];
    omitted: number;
    inherited: number;
    pending: {
        callId: string;
        turn: number;
        step: number;
        action: 'read' | 'remember' | 'forget';
        scope: 'project' | 'global';
        id?: string;
        entries: {
            id: string;
            summary: string;
        }[];
    }[];
}
export interface MemoryUsageView {
    rows: MemoryUsageRow[];
    omitted: number;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        superCodeMemoryUsage: MemoryUsageState;
    }
    interface SessionProjectionMap {
        superCodeMemoryUsage: MemoryUsageView;
    }
}
export declare function foldMemoryUsage(state: MemoryUsageState, event: SessionEvent): MemoryUsageState;
export declare const memoryUsageProjection: ProjectionDefinition<'superCodeMemoryUsage', MemoryUsageState> & {
    wire: NonNullable<ProjectionDefinition<'superCodeMemoryUsage', MemoryUsageState>['wire']>;
};
//# sourceMappingURL=memory-usage-projection.d.ts.map