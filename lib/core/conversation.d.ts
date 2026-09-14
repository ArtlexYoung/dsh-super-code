import type { WorkflowGeneration, WorkflowMessage, WorkflowUsage } from './programming.js';
export interface ConversationContext {
    readonly turn: number;
    readonly user: string;
    readonly messages: readonly WorkflowMessage[];
    readonly contract: ConversationContract;
    readonly signal: AbortSignal;
}
export interface ConversationCallbacks {
    readonly generate: (context: ConversationContext) => Promise<WorkflowGeneration>;
}
export interface ConversationOptions {
    readonly maxHistoryChars?: number;
    readonly retainGenerations?: boolean;
    /** Keep a compact, deterministic ledger of constraints found in user turns. */
    readonly preserveContract?: boolean;
    readonly maxContractChars?: number;
}
/** Stable requirements extracted from the user side of a multi-turn task. */
export interface ConversationContract {
    readonly requirements: readonly string[];
    readonly text: string;
}
export interface ConversationResult {
    readonly messages: readonly WorkflowMessage[];
    readonly generations: readonly WorkflowGeneration[];
    readonly usage: Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>;
}
/** Build a bounded contract without interpreting or rewriting task semantics. */
export declare function extractConversationContract(turns: readonly string[], maxChars?: number): ConversationContract;
/** Run a multi-turn conversation while bounding the history sent to the host. */
export declare function runConversationWorkflow(turns: readonly string[], callbacks: ConversationCallbacks, options?: ConversationOptions, signal?: AbortSignal): Promise<ConversationResult>;
export default runConversationWorkflow;
//# sourceMappingURL=conversation.d.ts.map