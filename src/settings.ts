import z from '@deepseek-ai/schemastery'

/** Settings namespace persisted by the Harness settings provider. */
export const SUPER_AGENT_SETTINGS_NAMESPACE = 'super-agent'

export const SuperAgentModelSchema: z<{ id: string; provider?: string; strengths: string[]; available: boolean }> = z.object({
  id: z.string(),
  provider: z.string(),
  strengths: z.array(z.string()),
  available: z.boolean(),
})

export const SuperAgentSettingsSchema: z<{ modelPools: { high: { id: string; provider?: string; strengths: string[]; available: boolean }[]; normal: { id: string; provider?: string; strengths: string[]; available: boolean }[]; low: { id: string; provider?: string; strengths: string[]; available: boolean }[] }; tokenStats: boolean }> = z.object({
  modelPools: z.object({
    high: z.array(SuperAgentModelSchema),
    normal: z.array(SuperAgentModelSchema),
    low: z.array(SuperAgentModelSchema),
  }),
  tokenStats: z.boolean(),
})

export interface SuperAgentSettings {
  readonly modelPools: import('./ui.js').ModelPoolConfig
  readonly tokenStats: boolean
}
