import type { CallerApproval, CallerApprovalDecision } from './types.js';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export type ApprovalAnswer = ApprovalOutcome | 'host';
export declare class CallerApprovals {
    private readonly now;
    private readonly requests;
    private readonly settled;
    private readonly presenting;
    constructor(now?: () => number);
    request(input: Omit<CallerApproval, 'id' | 'createdAt' | 'expiresAt'>, signal?: AbortSignal): Promise<ApprovalAnswer>;
    private expire;
    pending(taskId: string): CallerApproval[];
    present(taskId: string, id: string): boolean;
    defer(taskId: string, id: string): void;
    decide(taskId: string, id: string, decision: CallerApprovalDecision): {
        outcome: ApprovalOutcome;
        repeated: boolean;
    };
    withdraw(taskId?: string, answer?: ApprovalAnswer): void;
}
//# sourceMappingURL=approvals.d.ts.map