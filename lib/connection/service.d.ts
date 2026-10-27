import type { CallerApproval, ConnectionConfig, DelegationHost } from './types.js';
import type { ApprovalAnswer } from './approvals.js';
import { ConnectionStore } from './store.js';
import { DelegatedTasks } from './tasks.js';
import type { ConnectedClient } from './http.js';
import type { DirectoryRequest } from './directories.js';
export interface ConnectionSnapshot {
    configuration: ConnectionConfig;
    revision: number;
    writable: boolean;
    state: 'disabled' | 'listening' | 'error';
    error: string;
    url: string;
}
export interface ConnectionOverview {
    connections: ConnectedClient[];
    sessions: ReturnType<DelegatedTasks['overview']>;
}
export type ConnectionSaveResult = {
    ok: true;
    snapshot: ConnectionSnapshot;
} | {
    ok: false;
    error: string;
};
export declare class ConnectionService {
    private readonly store;
    private readonly host;
    private settings;
    private tasks;
    private http;
    private directoryRequests;
    private timer;
    private tail;
    private state;
    private error;
    private observing;
    constructor(store: ConnectionStore, host: DelegationHost);
    initialize(): Promise<void>;
    read(): ConnectionSnapshot;
    overview(): ConnectionOverview;
    requestApproval(input: Omit<CallerApproval, 'id' | 'createdAt' | 'expiresAt' | 'taskId' | 'cwd'>, roots: readonly string[], signal?: AbortSignal): Promise<ApprovalAnswer>;
    disconnect(id: string): Promise<{
        disconnected: true;
    }>;
    pendingDirectories(): DirectoryRequest[];
    resolveDirectory(id: string, decision: string): Promise<{
        status: DirectoryRequest['status'];
    }>;
    private exclusive;
    save(content: string, revision: string): Promise<ConnectionSaveResult>;
    reveal(): {
        token: string;
    };
    rotate(revision: string): Promise<ConnectionSaveResult>;
    private listen;
    close(): Promise<void>;
}
//# sourceMappingURL=service.d.ts.map