/** Stable requirements extracted from the user side of a multi-turn task. */
export interface ConversationContract {
    readonly requirements: readonly string[];
    readonly text: string;
}
/** Build a bounded contract without interpreting or rewriting task semantics. */
export declare function extractConversationContract(turns: readonly string[], maxChars?: number): ConversationContract;
//# sourceMappingURL=conversation-contract.d.ts.map