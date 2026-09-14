import type { Budget, EvidenceRecord } from './protocol.js';
/** Provider-neutral conversation roles used by host adapters. */
export type WorkflowMessageRole = 'user' | 'assistant' | 'tool';
/** A compact message history; the workflow keeps the task prompt once. */
export interface WorkflowMessage {
    readonly role: WorkflowMessageRole;
    readonly content: string;
}
/** Usage returned by one model or tool invocation. */
export interface WorkflowUsage {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
    readonly cachedTokens?: number;
    readonly toolCalls?: number;
    readonly latencyMs?: number;
}
/** Model output returned to the orchestration layer. */
export interface WorkflowGeneration {
    readonly text: string;
    readonly usage?: WorkflowUsage;
    readonly timing?: WorkflowTiming;
    readonly metadata?: Readonly<Record<string, string>>;
}
/** Optional request timing captured by a host adapter. */
export interface WorkflowTiming {
    readonly requestWaitMs?: number;
    readonly inputWaitMs?: number;
    readonly ttftMs?: number;
    readonly outputMs?: number;
    readonly totalLatencyMs?: number;
}
/** External acceptance result, normally produced by a local test runner. */
export interface VerificationResult {
    readonly passed: boolean;
    readonly feedback?: string;
    readonly evidence?: readonly EvidenceRecord[];
}
/** Context supplied to each host callback. */
export interface ProgrammingWorkflowContext {
    readonly phase: 'analysis' | 'draft' | 'repair';
    readonly task: string;
    readonly messages: readonly WorkflowMessage[];
    readonly analysis?: string;
    readonly candidate?: string;
    readonly feedback?: string;
    readonly attempt: number;
    readonly remainingBudget: Budget;
    readonly signal: AbortSignal;
}
/** Host callbacks adapt this workflow to AgentLoop, HTTP, or a test double. */
export interface ProgrammingWorkflowCallbacks {
    readonly generate: (context: ProgrammingWorkflowContext) => Promise<WorkflowGeneration>;
    readonly verify: (input: {
        readonly task: string;
        readonly candidate: string;
        readonly attempt: number;
        readonly signal: AbortSignal;
    }) => Promise<VerificationResult>;
}
/** Bounds for repairs and verifier-feedback compaction. */
export interface ProgrammingWorkflowOptions {
    readonly budget?: Budget;
    readonly maxRepairAttempts?: number;
    readonly maxFeedbackChars?: number;
    /** Generate a separate planning turn, or start with a directly verifiable draft. */
    readonly planning?: 'separate' | 'skip' | 'auto';
}
export interface WorkflowPhaseRecord {
    readonly phase: 'analysis' | 'draft' | 'repair';
    readonly attempt: number;
    readonly generation: WorkflowGeneration;
    readonly acceptance?: VerificationResult;
}
export type ProgrammingWorkflowStatus = 'passed' | 'failed' | 'budget_exhausted' | 'aborted';
/** Complete result with evidence suitable for matched evaluation. */
export interface ProgrammingWorkflowResult {
    readonly status: ProgrammingWorkflowStatus;
    readonly candidate?: string;
    readonly attempts: number;
    readonly phases: readonly WorkflowPhaseRecord[];
    readonly messages: readonly WorkflowMessage[];
    readonly usage: Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>;
    readonly finalAcceptance?: VerificationResult;
}
/**
 * Use a separate plan when the request is structurally complex. The heuristic
 * is deliberately domain-agnostic: it only considers shape and common
 * planning signals, never dataset names, task IDs, or expected answers.
 */
export declare function shouldPlanSeparately(task: string): boolean;
/** Keep verifier diagnostics useful without replaying an unbounded tool log. */
export declare function compactFeedback(value: string | undefined, maxChars?: number): string;
/**
 * Run a bounded programming task: one analysis, one draft, then repairs only
 * when the verifier rejects the candidate. The host owns model/tool execution.
 */
export declare function runProgrammingWorkflow(task: string, callbacks: ProgrammingWorkflowCallbacks, options?: ProgrammingWorkflowOptions, signal?: AbortSignal): Promise<ProgrammingWorkflowResult>;
export default runProgrammingWorkflow;
//# sourceMappingURL=programming.d.ts.map