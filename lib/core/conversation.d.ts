import type { WorkflowGeneration, WorkflowMessage, WorkflowUsage } from './programming.js';
export interface ConversationContext {
    readonly turn: number;
    readonly user: string;
    readonly messages: readonly WorkflowMessage[];
    readonly signal: AbortSignal;
}
export interface ConversationCallbacks {
    readonly generate: (context: ConversationContext) => Promise<WorkflowGeneration>;
}
export interface ConversationOptions {
    readonly maxHistoryChars?: number;
    readonly retainGenerations?: boolean;
}
export interface ConversationResult {
    readonly messages: readonly WorkflowMessage[];
    readonly generations: readonly WorkflowGeneration[];
    readonly usage: Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>;
}
/** Run a multi-turn conversation while bounding the history sent to the host. */
export declare function runConversationWorkflow(turns: readonly string[], callbacks: ConversationCallbacks, options?: ConversationOptions, signal?: AbortSignal): Promise<ConversationResult>;
export default runConversationWorkflow;
//# sourceMappingURL=conversation.d.ts.map