export type GuidanceMode = 'standard' | 'guided';
export interface GuidedRoute {
    readonly provider: string;
    readonly model: string;
}
/** Exact deployment policy, not a guess about capability from a model name. */
export declare function createGuidanceSelector(routes?: readonly GuidedRoute[]): (provider: unknown, model: unknown) => GuidanceMode;
/** Only selected routes pay for concrete reminders; standards remain identical. */
export declare const GUIDED_INSTRUCTIONS = "Inspect definitions and working callers for uncertain APIs; do not add aliases to satisfy imagined tests. A cause remains unconfirmed until an observation distinguishes it. Run the relevant check and inspect the result: a started command, exit code alone, zero tests or a teammate's claim does not establish acceptance. Before calling a failure pre-existing or environmental, compare the same check on the baseline; otherwise report it as unresolved. Never assume hidden tests will fix a failure. When stuck, change the hypothesis or reduce the reproduction, not the agent count. Use only necessary checks; no mandatory checklist or extra narration.";
//# sourceMappingURL=guidance.d.ts.map