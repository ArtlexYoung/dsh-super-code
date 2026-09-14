import z from '@deepseek-ai/schemastery';
/** Settings namespace persisted by the Harness settings provider. */
export const SUPER_AGENT_SETTINGS_NAMESPACE = 'super-agent';
export const SuperAgentModelSchema = z.object({
    id: z.string(),
    strengths: z.array(z.string()),
    available: z.boolean(),
});
export const SuperAgentSettingsSchema = z.object({
    modelPools: z.object({
        high: z.array(SuperAgentModelSchema),
        normal: z.array(SuperAgentModelSchema),
        low: z.array(SuperAgentModelSchema),
    }),
    tokenStats: z.boolean(),
});
//# sourceMappingURL=settings.js.map