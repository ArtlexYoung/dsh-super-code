import z from '@deepseek-ai/schemastery';
/** Settings namespace persisted by the Harness settings provider. */
export declare const SUPER_AGENT_SETTINGS_NAMESPACE = "super-agent";
export declare const SuperAgentModelSchema: z<{
    id: string;
    strengths: string[];
    available: boolean;
}>;
export declare const SuperAgentSettingsSchema: z<{
    modelPools: {
        high: {
            id: string;
            strengths: string[];
            available: boolean;
        }[];
        normal: {
            id: string;
            strengths: string[];
            available: boolean;
        }[];
        low: {
            id: string;
            strengths: string[];
            available: boolean;
        }[];
    };
    tokenStats: boolean;
}>;
export interface SuperAgentSettings {
    readonly modelPools: import('./ui.js').ModelPoolConfig;
    readonly tokenStats: boolean;
}
//# sourceMappingURL=settings.d.ts.map