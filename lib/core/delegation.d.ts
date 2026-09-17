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
    cost: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        toolCalls: number;
        complete: boolean;
    };
}
/** Compact, version-bound inputs for the existing host subagent provider. */
export declare function createMemberBrief(task: TaskMemory, sessionId: string, input: MemberAssignment): MemberBrief;
/** Version matching is necessary for review, not proof that the work is correct. */
export declare function validateMemberResult(task: TaskMemory, sessionId: string, assignment: MemberAssignment, input: MemberResult): {
    reviewable: boolean;
    reasons: string[];
    result: MemberResult;
};
//# sourceMappingURL=delegation.d.ts.map