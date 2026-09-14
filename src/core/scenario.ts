import { ProtocolError } from './protocol.js'

/** How a coding task is organized at runtime. */
export type ExecutionMode = 'solo' | 'team' | 'auto'

/** The acceptance discipline applied to a task. */
export type WorkScenario = 'delivery' | 'research' | 'optimization'

/** Optimization target when {@link WorkScenario} is `optimization`. */
export type OptimizationTarget = 'performance' | 'quality' | 'both'

/** The two independent axes used to describe a preset. */
export interface ScenarioProfile {
  readonly executionMode: ExecutionMode
  readonly workScenario: WorkScenario
  readonly optimizationTarget: OptimizationTarget
}

export type ScenarioProfileInput = Partial<ScenarioProfile>

const DEFAULT_PROFILE: ScenarioProfile = {
  executionMode: 'auto',
  workScenario: 'delivery',
  optimizationTarget: 'both',
}

/** Stable compatibility mapping for the four shipped preset names. */
export const PRESET_PROFILES: Readonly<Record<string, ScenarioProfile>> = Object.freeze({
  solo: { executionMode: 'solo', workScenario: 'delivery', optimizationTarget: 'both' },
  team: { executionMode: 'team', workScenario: 'delivery', optimizationTarget: 'both' },
  research: { executionMode: 'auto', workScenario: 'research', optimizationTarget: 'both' },
  optimization: { executionMode: 'auto', workScenario: 'optimization', optimizationTarget: 'both' },
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

/** Resolve a shipped preset name to its two-axis profile. */
export function profileForPreset(name: string): ScenarioProfile {
  if (typeof name !== 'string' || name.trim() === '') throw new ProtocolError('preset name must be a non-empty string', 'INVALID_ARGUMENT')
  const profile = PRESET_PROFILES[name.trim()]
  if (profile === undefined) throw new ProtocolError(`unknown preset ${name}`, 'INVALID_ARGUMENT')
  return { ...profile }
}

export default resolveScenarioProfile
