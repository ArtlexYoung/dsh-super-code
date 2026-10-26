import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DelegatedTasks } from './tasks.js';
import type { DirectoryApplication, DirectoryRequest } from './directories.js';
type RequestDirectory = (input: DirectoryApplication, client: string) => Promise<DirectoryRequest>;
type ClientName = () => string;
type ConnectionStatus = () => {
    connections: number;
    maxConnections: number;
    ids: readonly string[];
};
export declare function delegationMcpServer(tasks: DelegatedTasks, signal: (id: string | number) => AbortSignal, connectionId?: string, requestDirectory?: (input: DirectoryApplication) => Promise<DirectoryRequest>, clientName?: ClientName, connectionStatus?: ConnectionStatus): McpServer;
export interface ConnectedClient {
    id: string;
    name: string;
    version: string;
    connectedAt: number;
    lastSeen: number;
}
/** MCP sessions, rather than TCP sockets or individual HTTP requests, define a connection. */
export declare class ConnectionHttp {
    private readonly tasks;
    private readonly requestDirectory;
    private server;
    private requests;
    private readonly clients;
    private readonly pending;
    private timer;
    constructor(tasks: DelegatedTasks, requestDirectory?: RequestDirectory | undefined);
    connections(): ConnectedClient[];
    disconnect(id: string): Promise<void>;
    private prune;
    start(port: number, token: string, maxConnections?: number): Promise<void>;
    private admit;
    private handle;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=http.d.ts.map