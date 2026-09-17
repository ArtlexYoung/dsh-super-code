/** Host-neutral page integration for dsh-super-agent. */
export type ModelTier = 'high' | 'normal' | 'low';
export interface ModelOption {
    id: string;
    /** Provider id for a Host model route; omitted keeps legacy id-only configs valid. */
    provider?: string;
    strengths?: readonly string[];
    /** Strength selected for this invocation from the configured strengths. */
    strength?: string;
    available?: boolean;
}
export interface ModelPoolConfig {
    high: readonly ModelOption[];
    normal: readonly ModelOption[];
    low: readonly ModelOption[];
}
export interface TokenUsage {
    model: string;
    cacheHit: number;
    uncachedInput: number;
    cacheRead: number;
    output: number;
}
export interface AgentNode {
    id: string;
    label: string;
    parentId?: string;
    status?: 'idle' | 'running' | 'done' | 'failed';
    conversation?: readonly unknown[];
}
/** Select an available model, promoting to stronger tiers when necessary. */
export declare function selectModel(pool: ModelPoolConfig, tier: ModelTier, difficulty?: number): ModelOption | undefined;
export interface TokenSummary {
    total: number;
    averageCacheHitRate: number;
    details: {
        cacheHit: number;
        uncachedInput: number;
        cacheRead: number;
        output: number;
    };
}
/** Constant-space usage accumulation for a process serving long conversations. */
export declare class TokenCounter {
    private cached;
    private uncached;
    private reads;
    private output;
    add(usage: TokenUsage): void;
    summary(): TokenSummary;
}
export declare function summarizeTokens(usages: readonly TokenUsage[]): TokenSummary;
/** Dynamic preset injection: derives entries from the host roster at runtime. */
export declare function injectPresets<T extends {
    id: string;
}>(roster: readonly T[], presets: readonly T[]): T[];
export declare function buildAgentTree(nodes: readonly AgentNode[]): unknown[];
//# sourceMappingURL=ui.d.ts.map