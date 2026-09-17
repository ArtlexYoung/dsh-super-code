import { ProtocolError } from './protocol.js'

/** How a coding task is organized at runtime. */
export type ExecutionMode = 'solo' | 'team' | 'auto'

/** The acceptance discipline applied to a task. */
export type WorkScenario = 'delivery' | 'research' | 'optimization'

/** Optimization target when {@link WorkScenario} is `optimization`. */
export type OptimizationTarget = 'performance' | 'quality' | 'both'

/** One user-facing preset; professional teams are selected inside a session. */
export const SHIPPED_PRESET_NAMES = ['super-code'] as const
export type ShippedPresetName = typeof SHIPPED_PRESET_NAMES[number]

/** The two independent axes used to describe a preset. */
export interface ScenarioProfile {
  readonly executionMode: ExecutionMode
  readonly workScenario: WorkScenario
  readonly optimizationTarget: OptimizationTarget
}

export type ScenarioProfileInput = Partial<ScenarioProfile>

/** Planning default shared by programming workflows for all shipped modes. */
export type ScenarioPlanning = 'separate' | 'auto'

const DEFAULT_PROFILE: ScenarioProfile = {
  executionMode: 'auto',
  workScenario: 'delivery',
  optimizationTarget: 'both',
}

/** Default workflow axes; a task's professional discipline is independent. */
export const PRESET_PROFILES: Readonly<Record<ShippedPresetName, ScenarioProfile>> = Object.freeze({
  'super-code': { executionMode: 'auto', workScenario: 'delivery', optimizationTarget: 'both' },
})

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ProtocolError(`${field} must be one of ${values.join(', ')}`, 'INVALID_ARGUMENT')
  }
  return value as T
}

/** Normalize an explicit profile while preserving the delivery defaults. */
export function resolveScenarioProfile(input: ScenarioProfileInput = {}): ScenarioProfile {
  const executionMode = oneOf(input.executionMode ?? DEFAULT_PROFILE.executionMode, ['solo', 'team', 'auto'], 'executionMode')
  const workScenario = oneOf(input.workScenario ?? DEFAULT_PROFILE.workScenario, ['delivery', 'research', 'optimization'], 'workScenario')
  const optimizationTarget = oneOf(input.optimizationTarget ?? DEFAULT_PROFILE.optimizationTarget, ['performance', 'quality', 'both'], 'optimizationTarget')
  return { executionMode, workScenario, optimizationTarget }
}

/**
 * Choose an adaptive planning default from the two axes. The programming
 * workflow creates a separate analysis record for team execution, while
 * routine solo/research/optimization tasks stay adaptive to control cost.
 */
export function defaultPlanningForProfile(profile: ScenarioProfile): ScenarioPlanning {
  const resolved = resolveScenarioProfile(profile)
  return resolved.executionMode === 'team' ? 'separate' : 'auto'
}

/** Resolve a shipped preset name to its two-axis profile. */
export function profileForPreset(name: string): ScenarioProfile {
  if (typeof name !== 'string' || name.trim() === '') throw new ProtocolError('preset name must be a non-empty string', 'INVALID_ARGUMENT')
  const key = name.trim()
  if (!(SHIPPED_PRESET_NAMES as readonly string[]).includes(key)) throw new ProtocolError(`unknown preset ${name}`, 'INVALID_ARGUMENT')
  const profile = PRESET_PROFILES[key as ShippedPresetName]
  return { ...profile }
}

export default resolveScenarioProfile
