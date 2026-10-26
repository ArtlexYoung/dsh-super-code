import type { ConnectionConfig, DelegatedTask } from './types.js';
export interface ConnectionSettings {
    revision: number;
    config: ConnectionConfig;
    token: string;
}
export declare class ConnectionStore {
    readonly directory: string;
    private lock;
    private owned;
    constructor(directory: string);
    initialize(): Promise<void>;
    private claim;
    close(): Promise<void>;
    settings(): Promise<ConnectionSettings>;
    saveSettings(value: ConnectionSettings): Promise<void>;
    tasks(): Promise<DelegatedTask[]>;
    saveTasks(tasks: DelegatedTask[]): Promise<void>;
    private write;
}
//# sourceMappingURL=store.d.ts.map