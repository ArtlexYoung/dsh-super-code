import { z } from 'zod';
export interface ConnectionConfig {
    enabled: boolean;
    port: number;
    allowedDirectories: string[];
    knownDirectories: string[];
    maxConcurrent: number;
    maxConnections: number;
    directoriesConfigured: boolean;
}
export declare const connectionConfigSchema: z.ZodType<ConnectionConfig>;
export declare const defaultConnectionConfig: ConnectionConfig;
export type TaskStatus = 'starting' | 'running' | 'waiting_confirmation' | 'cancelling' | 'finished' | 'failed' | 'cancelled' | 'interrupted' | 'unavailable';
export interface TaskEvent {
    cursor: number;
    time: number;
    status: TaskStatus;
    message: string;
}
export interface GitSnapshot {
    available: boolean;
    root: string;
    head: string;
    fingerprint: string;
    dirty: string[];
}
export interface WorkspaceChanges {
    available: boolean;
    baselineDirty: string[];
    currentDirty: string[];
    changedSinceStart: boolean;
    headChanged: boolean;
    diffStat: string;
    truncated: boolean;
    attribution: 'workspace-observation';
}
export interface DelegatedTask {
    id: string;
    requestId: string;
    fingerprint: string;
    sessionId: string;
    cwd: string;
    preset: string;
    client: string;
    status: TaskStatus;
    cancellationRequested: boolean;
    createdAt: number;
    updatedAt: number;
    currentRequest: string;
    output: string;
    sequence: number;
    events: TaskEvent[];
    operations: Record<string, string>;
    baseline: GitSnapshot;
    connectionId?: string;
}
export interface TaskView {
    taskId: string;
    sessionId: string;
    cwd: string;
    preset: string;
    client: string;
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    output: string;
    events: TaskEvent[];
    cursor: number;
    eventsTruncated: boolean;
    acceptance: 'not-verified';
    workspace: WorkspaceChanges;
}
export interface HostObservation {
    status: 'running' | 'waiting_confirmation' | 'finished' | 'failed' | 'interrupted' | 'unavailable';
    output: string;
    detail: string;
}
export interface DelegationHost {
    preset(): Promise<string>;
    create(sessionId: string, cwd: string, preset: string): Promise<void>;
    prompt(sessionId: string, requestId: string, prompt: string): Promise<void>;
    observe(sessionId: string, requestId: string, cancelling?: boolean): Promise<HostObservation>;
    cancel(sessionId: string): Promise<void>;
}
export declare class ConnectionError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function activeTask(status: TaskStatus): boolean;
//# sourceMappingURL=types.d.ts.map