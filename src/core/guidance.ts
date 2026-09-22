import { z } from 'zod'

export type GuidanceMode = 'standard' | 'guided'
export interface GuidedRoute { readonly provider: string; readonly model: string }

const guidedRoutesSchema = z.array(z.object({
  provider: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(256),
}).strict()).max(128)

/** Exact deployment policy, not a guess about capability from a model name. */
export function createGuidanceSelector(routes: readonly GuidedRoute[] = []): (provider: unknown, model: unknown) => GuidanceMode {
  const configured = guidedRoutesSchema.parse(routes)
  const keys = new Set(configured.map(route => JSON.stringify([route.provider, route.model])))
  if (keys.size !== configured.length) throw new Error('Duplicate guided model route')
  return (provider, model) => typeof provider === 'string' && typeof model === 'string' && keys.has(JSON.stringify([provider, model])) ? 'guided' : 'standard'
}

/** Only selected routes pay for concrete reminders; standards remain identical. */
export const GUIDED_INSTRUCTIONS = `For uncertain APIs, inspect definitions and working callers. State the observed mismatch before editing; choose a check that distinguishes competing causes. For a changed state transition, test its relevant entry condition (e.g. saved in-progress state for restart), not only a fresh success. Match the final diff to the user's requested behaviors. A started command, exit code alone, zero tests or a teammate's claim is not acceptance. Keep a failing check unresolved until it passes or baseline evidence/an explicit contract change explains it; never predict that replacement tests will fix it. When stuck, reduce the reproduction or change the hypothesis, not the agent count. Reuse evidence already present; no extra checklist or narration.`
