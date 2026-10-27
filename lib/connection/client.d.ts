export interface ConnectionRequest {
    url: string;
    token: string;
    tool: string;
    arguments: Record<string, unknown>;
}
export declare function invokeConnectionTool(request: ConnectionRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
//# sourceMappingURL=client.d.ts.map