import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
export interface SuperAgentUsageBuckets {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface SuperAgentUsageModel extends SuperAgentUsageBuckets {
    readonly provider: string;
    readonly model: string;
}
export interface SuperAgentUsageProjection {
    readonly totals: SuperAgentUsageBuckets;
    readonly models: Readonly<Record<string, SuperAgentUsageModel>>;
}
interface LastSample {
    readonly turn: number;
    readonly step: number;
    readonly key: string;
    readonly buckets: SuperAgentUsageBuckets;
}
export interface SuperAgentUsageState {
    readonly totals: Readonly<Record<string, SuperAgentUsageModel>>;
    readonly last: LastSample | null;
    /** Most recent request route, used by attempt-only events with no message source. */
    readonly route?: {
        readonly provider: string;
        readonly model: string;
    };
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        superAgentUsage: SuperAgentUsageState;
    }
    interface SessionProjectionMap {
        superAgentUsage: SuperAgentUsageProjection;
    }
}
/** Durable per-model projection; retries replace the same step's sample. */
export declare const superAgentUsageProjectionDefinition: ProjectionDefinition<'superAgentUsage', SuperAgentUsageState> & {
    wire: NonNullable<ProjectionDefinition<'superAgentUsage', SuperAgentUsageState>['wire']>;
};
export {};
//# sourceMappingURL=super-agent-usage.d.ts.map