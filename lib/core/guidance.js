import { z } from 'zod';
const guidedRoutesSchema = z.array(z.object({
    provider: z.string().trim().min(1).max(256),
    model: z.string().trim().min(1).max(256),
}).strict()).max(128);
/** Exact deployment policy, not a guess about capability from a model name. */
export function createGuidanceSelector(routes = []) {
    const configured = guidedRoutesSchema.parse(routes);
    const keys = new Set(configured.map(route => JSON.stringify([route.provider, route.model])));
    if (keys.size !== configured.length)
        throw new Error('Duplicate guided model route');
    return (provider, model) => typeof provider === 'string' && typeof model === 'string' && keys.has(JSON.stringify([provider, model])) ? 'guided' : 'standard';
}
/** Only selected routes pay for concrete reminders; standards remain identical. */
export const GUIDED_INSTRUCTIONS = `Inspect definitions and working callers for uncertain APIs; do not add aliases to satisfy imagined tests. A cause remains unconfirmed until an observation distinguishes it. Run the relevant check and inspect the result: a started command, exit code alone, zero tests or a teammate's claim does not establish acceptance. Before calling a failure pre-existing or environmental, compare the same check on the baseline; otherwise report it as unresolved. Never assume hidden tests will fix a failure. When stuck, change the hypothesis or reduce the reproduction, not the agent count. Use only necessary checks; no mandatory checklist or extra narration.`;
//# sourceMappingURL=guidance.js.map