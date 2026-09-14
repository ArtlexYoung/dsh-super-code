import type { WorkflowGeneration, WorkflowMessage, WorkflowUsage } from './programming.js';
import type { ConversationContract } from './conversation-contract.js';
import type { ScenarioProfile, ScenarioProfileInput } from './scenario.js';
export { extractConversationContract } from './conversation-contract.js';
export type { ConversationContract } from './conversation-contract.js';
export interface ConversationContext {
    readonly turn: number;
    readonly user: string;
    readonly messages: readonly WorkflowMessage[];
    readonly contract: ConversationContract;
    readonly profile: ScenarioProfile;
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
    /** Explicit execution mode and work scenario for host composition. */
    readonly profile?: ScenarioProfileInput;
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