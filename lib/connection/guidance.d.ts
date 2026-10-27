/** Advice for the calling client; never injected into DSH model context. */
export declare const connectionInstructions: string;
export interface Recovery {
    action: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
}
export declare function connectionRecovery(code: string): Recovery;
//# sourceMappingURL=guidance.d.ts.map