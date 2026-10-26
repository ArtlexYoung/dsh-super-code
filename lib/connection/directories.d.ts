export interface DirectoryApplication {
    requestId: string;
    path: string;
    reason: string;
}
export interface DirectoryRequest {
    id: string;
    requestId: string;
    path: string;
    reason: string;
    client: string;
    createdAt: number;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
}
/** Pending consent is deliberately ephemeral; only an approved allowlist is persisted. */
export declare class DirectoryRequests {
    private readonly allowed;
    private readonly now;
    private readonly requests;
    private readonly sources;
    constructor(allowed: () => string[], now?: () => number);
    private expire;
    request(input: DirectoryApplication, client: string): Promise<DirectoryRequest>;
    pending(): DirectoryRequest[];
    resolve(id: string, decision: 'approved' | 'rejected', grant: (path: string) => Promise<void>): Promise<{
        status: DirectoryRequest['status'];
    }>;
    rejectPending(): void;
}
//# sourceMappingURL=directories.d.ts.map