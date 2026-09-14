/** How a coding task is organized at runtime. */
export type ExecutionMode = 'solo' | 'team' | 'auto';
/** The acceptance discipline applied to a task. */
export type WorkScenario = 'delivery' | 'research' | 'optimization';
/** Optimization target when {@link WorkScenario} is `optimization`. */
export type OptimizationTarget = 'performance' | 'quality' | 'both';
/** Names of the four shipped compatibility preset entries. */
export declare const SHIPPED_PRESET_NAMES: readonly ["solo", "team", "research", "optimization"];
export type ShippedPresetName = typeof SHIPPED_PRESET_NAMES[number];
/** The two independent axes used to describe a preset. */
export interface ScenarioProfile {
    readonly executionMode: ExecutionMode;
    readonly workScenario: WorkScenario;
    readonly optimizationTarget: OptimizationTarget;
}
export type ScenarioProfileInput = Partial<ScenarioProfile>;
/** Planning default shared by programming workflows for all shipped modes. */
export type ScenarioPlanning = 'separate' | 'auto';
/** Stable compatibility mapping for the four shipped preset names. */
export declare const PRESET_PROFILES: Readonly<Record<ShippedPresetName, ScenarioProfile>>;
/** Normalize an explicit profile while preserving the delivery defaults. */
export declare function resolveScenarioProfile(input?: ScenarioProfileInput): ScenarioProfile;
/**
 * Choose an adaptive planning default from the two axes. The programming
 * workflow still creates a separate analysis record for structurally complex
 * requests; routine tasks in every scenario avoid an extra model turn.
 */
export declare function defaultPlanningForProfile(profile: ScenarioProfile): ScenarioPlanning;
/** Resolve a shipped preset name to its two-axis profile. */
export declare function profileForPreset(name: string): ScenarioProfile;
export default resolveScenarioProfile;
//# sourceMappingURL=scenario.d.ts.map