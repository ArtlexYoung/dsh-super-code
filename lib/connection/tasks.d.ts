import type { CallerApproval, CallerApprovalDecision, ConnectionConfig, DelegationHost, HistoryCursor, HistoryPage, ModelSelection, TaskStatus, TaskView } from './types.js';
import { CallerApprovals } from './approvals.js';
import type { ApprovalAnswer } from './approvals.js';
import type { ConnectionStore } from './store.js';
export declare function withinDirectory(root: string, cwd: string): boolean;
export declare class DelegatedTasks {
    private readonly store;
    private readonly host;
    private readonly configuration;
    private records;
    private tail;
    private closed;
    readonly approvals: CallerApprovals;
    constructor(store: ConnectionStore, host: DelegationHost, configuration: () => ConnectionConfig);
    initialize(): Promise<void>;
    private exclusive;
    private event;
    private persist;
    private owned;
    private enabled;
    requestApproval(input: Omit<CallerApproval, 'id' | 'createdAt' | 'expiresAt' | 'taskId' | 'cwd'>, roots: readonly string[], signal?: AbortSignal): Promise<ApprovalAnswer>;
    approve(taskId: string, approvalId: string, decision: CallerApprovalDecision): Promise<{
        outcome: string;
        repeated: boolean;
    }>;
    approvalsChanged(): void;
    private selectModel;
    models(): Promise<unknown>;
    private directory;
    private capacity;
    run(input: {
        requestId: string;
        cwd: string;
        prompt: string;
        client?: string;
        connectionId?: string;
        modelSelection?: ModelSelection;
    }): Promise<TaskView>;
    send(input: {
        taskId: string;
        requestId: string;
        cwd?: string;
        prompt: string;
        connectionId?: string;
        modelSelection?: ModelSelection;
    }): Promise<TaskView>;
    cancel(id: string): Promise<TaskView>;
    private refresh;
    private refreshPending;
    tick(): Promise<void>;
    private snapshot;
    view(id: string, cursor: number): Promise<TaskView>;
    private describe;
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
    sessions(cwd: string, limit: number, status: {
        connections: number;
        maxConnections: number;
        ids: readonly string[];
    }): Promise<{
        cwd: string;
        allowNewConversations: boolean;
        connections: number;
        maxConnections: number;
        availableConnections: number;
        activeTasks: number;
        availableTasks: number;
        sessions: {
            taskId: string;
            sessionId: string;
            cwd: string;
            client: string;
            status: TaskStatus;
            createdAt: number;
            updatedAt: number;
            connectionCount: number;
            reusable: boolean;
            modelSelection?: ModelSelection;
        }[];
    }>;
    history(id: string, cursor: HistoryCursor, limit: number, descendantId?: string): Promise<HistoryPage & {
        taskId: string;
    }>;
    status(connections: {
        connections: number;
        maxConnections: number;
    }): Promise<{
        role: 'delegation-executor';
        allowNewConversations: boolean;
        allowCallerApproval: boolean;
        allowedDirectories: string[];
        connections: number;
        maxConnections: number;
        availableConnections: number;
        activeTasks: number;
        availableTasks: number;
        blockingTasks: {
            taskId: string;
            cwd: string;
            status: TaskStatus;
        }[];
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