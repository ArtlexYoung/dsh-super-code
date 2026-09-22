export type GuidanceMode = 'standard' | 'guided';
export interface GuidedRoute {
    readonly provider: string;
    readonly model: string;
}
/** Exact deployment policy, not a guess about capability from a model name. */
export declare function createGuidanceSelector(routes?: readonly GuidedRoute[]): (provider: unknown, model: unknown) => GuidanceMode;
/** Only selected routes pay for concrete reminders; standards remain identical. */
export declare const GUIDED_INSTRUCTIONS = "For uncertain APIs, inspect definitions and working callers. State the observed mismatch before editing; choose a check that distinguishes competing causes. For a changed state transition, test its relevant entry condition (e.g. saved in-progress state for restart), not only a fresh success. Match the final diff to the user's requested behaviors. A started command, exit code alone, zero tests or a teammate's claim is not acceptance. Keep a failing check unresolved until it passes or baseline evidence/an explicit contract change explains it; never predict that replacement tests will fix it. When stuck, reduce the reproduction or change the hypothesis, not the agent count. Reuse evidence already present; no extra checklist or narration.";
//# sourceMappingURL=guidance.d.ts.map