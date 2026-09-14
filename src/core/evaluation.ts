import { ProtocolError } from './protocol.js'
import { SHIPPED_PRESET_NAMES } from './scenario.js'
import type { ShippedPresetName } from './scenario.js'

export interface EvaluationSnapshot {
  readonly successRate: number
  readonly totalTokens: number
  readonly latencyMs: number
}

export interface EvaluationThresholds {
  readonly minAccuracyUplift?: number
  readonly minTokenReduction?: number
  readonly minLatencyReduction?: number
}

export interface EvaluationGateResult {
  readonly delta: { readonly successRate: number; readonly totalTokens: number; readonly latencyMs: number }
  readonly reduction: { readonly totalTokens: number | null; readonly latency: number | null }
  readonly thresholds: Required<EvaluationThresholds>
  readonly checks: { readonly accuracyUplift: boolean; readonly tokenReduction: boolean; readonly latencyReduction: boolean }
  readonly accepted: boolean
}

export interface EvaluationRun {
  readonly baseline: EvaluationSnapshot
  readonly candidate: EvaluationSnapshot
}

/** One matched baseline/candidate run for a shipped extension scenario. */
export interface ScenarioEvaluationRun extends EvaluationRun {
  readonly scenario: ShippedPresetName
}

export interface EvaluationAggregate {
  readonly runs: number
  readonly baseline: EvaluationSnapshot
  readonly candidate: EvaluationSnapshot
  readonly deltas: { readonly successRate: number; readonly totalTokens: number; readonly latencyMs: number }
  readonly tokenReduction: number | null
  readonly latencyReduction: number | null
}

/** Per-scenario release result for a complete four-scenario batch. */
export interface ScenarioBatchGateResult {
  readonly accepted: boolean
  readonly byScenario: Readonly<Record<ShippedPresetName, EvaluationGateResult>>
}

function rate(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new ProtocolError(`${field} must be between 0 and 1`, 'INVALID_ARGUMENT')
  return value
}

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new ProtocolError(`${field} must be non-negative`, 'INVALID_ARGUMENT')
  return value
}

/** Apply the release criteria without coupling them to a dataset or runner. */
export function evaluateReleaseGate(baseline: EvaluationSnapshot, candidate: EvaluationSnapshot, thresholds: EvaluationThresholds = {}): EvaluationGateResult {
  const base = { successRate: rate(baseline.successRate, 'baseline.successRate'), totalTokens: nonNegative(baseline.totalTokens, 'baseline.totalTokens'), latencyMs: nonNegative(baseline.latencyMs, 'baseline.latencyMs') }
  const next = { successRate: rate(candidate.successRate, 'candidate.successRate'), totalTokens: nonNegative(candidate.totalTokens, 'candidate.totalTokens'), latencyMs: nonNegative(candidate.latencyMs, 'candidate.latencyMs') }
  const resolved = { minAccuracyUplift: thresholds.minAccuracyUplift ?? 0.1, minTokenReduction: thresholds.minTokenReduction ?? 0.1, minLatencyReduction: thresholds.minLatencyReduction ?? 0 }
  if (!Number.isFinite(resolved.minAccuracyUplift) || resolved.minAccuracyUplift < 0 || !Number.isFinite(resolved.minTokenReduction) || resolved.minTokenReduction < 0 || !Number.isFinite(resolved.minLatencyReduction)) throw new ProtocolError('evaluation thresholds must be finite and non-negative', 'INVALID_ARGUMENT')
  const delta = { successRate: next.successRate - base.successRate, totalTokens: next.totalTokens - base.totalTokens, latencyMs: next.latencyMs - base.latencyMs }
  const reduction = { totalTokens: base.totalTokens > 0 ? (base.totalTokens - next.totalTokens) / base.totalTokens : null, latency: base.latencyMs > 0 ? (base.latencyMs - next.latencyMs) / base.latencyMs : null }
  const checks = { accuracyUplift: delta.successRate >= resolved.minAccuracyUplift, tokenReduction: reduction.totalTokens !== null && reduction.totalTokens >= resolved.minTokenReduction, latencyReduction: reduction.latency !== null && reduction.latency >= resolved.minLatencyReduction }
  return { delta, reduction, thresholds: resolved, checks, accepted: Object.values(checks).every(Boolean) }
}

/** Aggregate independent matched runs before applying a release gate. */
export function aggregateEvaluationRuns(runs: readonly EvaluationRun[]): EvaluationAggregate {
  if (!Array.isArray(runs) || runs.length === 0) throw new ProtocolError('runs must be non-empty', 'INVALID_ARGUMENT')
  const baseline = runs.reduce((sum, run) => ({ successRate: sum.successRate + rate(run.baseline.successRate, 'baseline.successRate'), totalTokens: sum.totalTokens + nonNegative(run.baseline.totalTokens, 'baseline.totalTokens'), latencyMs: sum.latencyMs + nonNegative(run.baseline.latencyMs, 'baseline.latencyMs') }), { successRate: 0, totalTokens: 0, latencyMs: 0 })
  const candidate = runs.reduce((sum, run) => ({ successRate: sum.successRate + rate(run.candidate.successRate, 'candidate.successRate'), totalTokens: sum.totalTokens + nonNegative(run.candidate.totalTokens, 'candidate.totalTokens'), latencyMs: sum.latencyMs + nonNegative(run.candidate.latencyMs, 'candidate.latencyMs') }), { successRate: 0, totalTokens: 0, latencyMs: 0 })
  const count = runs.length
  const average = { baseline: { successRate: baseline.successRate / count, totalTokens: baseline.totalTokens / count, latencyMs: baseline.latencyMs / count }, candidate: { successRate: candidate.successRate / count, totalTokens: candidate.totalTokens / count, latencyMs: candidate.latencyMs / count } }
  const deltas = { successRate: average.candidate.successRate - average.baseline.successRate, totalTokens: average.candidate.totalTokens - average.baseline.totalTokens, latencyMs: average.candidate.latencyMs - average.baseline.latencyMs }
  return { runs: count, ...average, deltas, tokenReduction: average.baseline.totalTokens > 0 ? (average.baseline.totalTokens - average.candidate.totalTokens) / average.baseline.totalTokens : null, latencyReduction: average.baseline.latencyMs > 0 ? (average.baseline.latencyMs - average.candidate.latencyMs) / average.baseline.latencyMs : null }
}

/**
 * Aggregate one matched batch and reject partial batches. Keeping this check
 * in the domain module prevents an evaluator from silently optimizing only
 * one preset while reporting a package-level result.
 */
export function aggregateScenarioEvaluationRuns(runs: readonly ScenarioEvaluationRun[]): Readonly<Record<ShippedPresetName, EvaluationAggregate>> {
  if (!Array.isArray(runs) || runs.length === 0) throw new ProtocolError('scenario runs must be non-empty', 'INVALID_ARGUMENT')
  const groups = new Map<ShippedPresetName, EvaluationRun[]>()
  for (const run of runs) {
    if (!SHIPPED_PRESET_NAMES.includes(run.scenario)) throw new ProtocolError(`unknown scenario ${String(run.scenario)}`, 'INVALID_ARGUMENT')
    const group = groups.get(run.scenario) ?? []
    group.push(run)
    groups.set(run.scenario, group)
  }
  const missing = SHIPPED_PRESET_NAMES.filter(name => !groups.has(name))
  if (missing.length > 0) throw new ProtocolError(`scenario batch is incomplete; missing: ${missing.join(', ')}`, 'INCOMPLETE_BATCH')
  return Object.fromEntries(SHIPPED_PRESET_NAMES.map(name => [name, aggregateEvaluationRuns(groups.get(name)!)])) as Record<ShippedPresetName, EvaluationAggregate>
}

/** Apply the release gate independently to all four scenarios. */
export function evaluateScenarioBatchRelease(
  runs: readonly ScenarioEvaluationRun[],
  thresholds: EvaluationThresholds = {},
): ScenarioBatchGateResult {
  const aggregates = aggregateScenarioEvaluationRuns(runs)
  const byScenario = Object.fromEntries(SHIPPED_PRESET_NAMES.map(name => {
    const aggregate = aggregates[name]
    return [name, evaluateReleaseGate(aggregate.baseline, aggregate.candidate, thresholds)]
  })) as Record<ShippedPresetName, EvaluationGateResult>
  return { accepted: SHIPPED_PRESET_NAMES.every(name => byScenario[name].accepted), byScenario }
}

export default evaluateReleaseGate
