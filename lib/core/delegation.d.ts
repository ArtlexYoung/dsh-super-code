import type { TaskMemory } from './task-memory.js';
export interface MemberAssignment {
    owner: string;
    attemptId: string;
    objective: string;
    ownedPaths: string[];
    acceptance: string[];
    maxTokens: number;
}
export interface MemberBrief extends MemberAssignment {
    binding: string;
    sessionId: string;
    taskId: string;
    createdAtSeq: number;
    requirementsRevision: number;
    delegationRevision: number;
    workspace: string;
    sourceVersion: string;
    constraints: string[];
    taskGoal: string;
    taskAcceptance: string[];
}
export interface MemberResult {
    binding: string;
    owner: string;
    attemptId: string;
    outcome: 'completed' | 'failed' | 'cancelled' | 'stop_unknown';
    summary: string;
    artifacts: string[];
    checks: string[];
    unknowns: string[];
    /** Optional self-report, never authenticated usage or budget enforcement. */
    cost?: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        toolCalls: number;
        complete: boolean;
    };
}
export type MemberAccounting = {
    kind: 'unavailable';
    budget: 'unknown';
} | {
    kind: 'model-reported';
    budget: 'unknown';
    reportedBudget: 'within' | 'exceeded' | 'incomplete' | 'invalid';
};
export interface MemberReview {
    reviewable: boolean;
    reasons: string[];
    accounting: MemberAccounting;
    result: MemberResult;
}
/** Compact, version-bound inputs for the existing host subagent provider. */
export declare function createMemberBrief(task: TaskMemory, sessionId: string, input: MemberAssignment): MemberBrief;
/** Version matching is necessary for review, not proof that the work is correct. */
export declare function validateMemberResult(task: TaskMemory, sessionId: string, assignment: MemberAssignment, input: MemberResult): MemberReview;
//# sourceMappingURL=delegation.d.ts.map