import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { ConnectionService } from '../connection/service.js';
import type { ConnectionSaveResult, ConnectionSnapshot } from '../connection/service.js';
interface DirectoryListing {
    path: string;
    home: string;
    crumbs: {
        name: string;
        path: string;
        hidden: boolean;
    }[];
    entries: {
        name: string;
        path: string;
        hidden: boolean;
    }[];
    truncated: boolean;
}
interface SettingsEnvironment {
    workspaces: false | {
        list(): {
            path: string;
            title: string;
        }[];
    };
    picker: false | {
        capability(): {
            kind: string;
            pick?(signal: AbortSignal): Promise<string | null>;
            list?(path?: string, signal?: AbortSignal): Promise<DirectoryListing>;
        };
    };
}
export declare class SuperCodeConnection extends TypertRemoteService {
    private readonly current;
    private readonly environment;
    constructor(ctx: Context, current: () => ConnectionService | false, environment?: SettingsEnvironment);
    private service;
    readConfig(): ConnectionSnapshot;
    saveConfig(content: string, expected: string): Promise<ConnectionSaveResult>;
    revealToken(): {
        token: string;
    };
    rotateToken(expected: string): Promise<ConnectionSaveResult>;
    overview(): ReturnType<ConnectionService['overview']>;
    disconnectClient(id: string): Promise<{
        disconnected: true;
    }>;
    pendingDirectories(): ReturnType<ConnectionService['pendingDirectories']>;
    resolveDirectory(id: string, decision: string): ReturnType<ConnectionService['resolveDirectory']>;
    directories(): Promise<{
        items: {
            path: string;
            title: string;
            available: boolean;
            workspace: boolean;
        }[];
        picker: string;
        available: boolean;
    }>;
    pickDirectory(signal: AbortSignal): Promise<{
        kind: 'selected';
        path: string;
    } | {
        kind: 'cancelled';
    }>;
    browseDirectory(path: string, signal: AbortSignal): Promise<DirectoryListing>;
}
export declare function applyConnection(ctx: Context): void;
export {};
//# sourceMappingURL=connection.d.ts.map