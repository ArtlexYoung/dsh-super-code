import type { ConnectionConfig, DelegationHost, TaskStatus, TaskView } from './types.js';
import type { ConnectionStore } from './store.js';
export declare function withinDirectory(root: string, cwd: string): boolean;
export declare class DelegatedTasks {
    private readonly store;
    private readonly host;
    private readonly configuration;
    private records;
    private tail;
    private closed;
    constructor(store: ConnectionStore, host: DelegationHost, configuration: () => ConnectionConfig);
    initialize(): Promise<void>;
    private exclusive;
    private event;
    private persist;
    private owned;
    private enabled;
    private directory;
    private capacity;
    run(input: {
        requestId: string;
        cwd: string;
        prompt: string;
        client?: string;
        connectionId?: string;
    }): Promise<TaskView>;
    send(input: {
        taskId: string;
        requestId: string;
        prompt: string;
        connectionId?: string;
    }): Promise<TaskView>;
    cancel(id: string): Promise<TaskView>;
    private refresh;
    tick(): Promise<void>;
    view(id: string, cursor: number): Promise<TaskView>;
    list(cursor: number): Promise<{
        tasks: {
            taskId: string;
            sessionId: string;
            cwd: string;
            client: string;
            status: TaskStatus;
            updatedAt: number;
        }[];
        nextCursor: number | false;
    }>;
    overview(): {
        taskId: string;
        sessionId: string;
        cwd: string;
        client: string;
        connectionId: string;
        status: TaskStatus;
        updatedAt: number;
    }[];
    wait(id: string, cursor: number, waitMs: number, signal?: AbortSignal): Promise<TaskView>;
    close(): Promise<void>;
}
//# sourceMappingURL=tasks.d.ts.map