import { z } from 'zod'

export interface EvaluationUsage { uncachedInput: number; cacheRead: number; cacheWrite: number; output: number }
export interface EvaluationIdentity { preset: string; version: string; artifact: string }
export interface EvaluationConditions { task: string; evaluator: string; model: string; reasoning: string; tools: string; resources: string; environment: string; harness: string }
export interface EvaluationRate extends EvaluationUsage { id: string; provider: string; model: string; currency: string; source: string; effectiveAt: string; perRequest: number }
export interface EvaluationRequest {
  id: string; sessionId: string; attemptId: string; kind: 'root' | 'member' | 'retry' | 'compaction'
  provider: string; model: string; rateId?: string; usage?: EvaluationUsage; toolCharge?: number
}
export interface SuperCodeManifest {
  protocol: 'super-code/v3'; baseline: EvaluationIdentity; candidate: EvaluationIdentity
  cases: { taskId: string; category: string; conditions: EvaluationConditions }[]
  gates: { minAccuracyUplift: number; maxLostSuccesses: number; minCostReduction?: number; minLatencyReduction?: number }
  rates: EvaluationRate[]
}
export interface SuperCodeMeasurement {
  protocol: 'super-code/v3'; side: 'baseline' | 'candidate'; identity: EvaluationIdentity
  taskId: string; category: string; conditions: EvaluationConditions; mode: 'real' | 'mock' | 'replay'
  outcome: 'passed' | 'failed' | 'agent_failed' | 'audit_failed' | 'infrastructure_error' | 'evaluation_error' | 'unknown'
  latencyMs: number; expectedRequests: string[]; requestManifestComplete: boolean; requests: EvaluationRequest[]
}

const label = z.string().trim().min(1)
const count = z.number().int().nonnegative().safe()
const amount = z.number().finite().nonnegative()
const ratio = z.number().min(0).max(1)
const sides = ['baseline', 'candidate'] as const
type Side = typeof sides[number]
const buckets = ['uncachedInput', 'cacheRead', 'cacheWrite', 'output'] as const
const usageSchema = z.object({ uncachedInput: count, cacheRead: count, cacheWrite: count, output: count }).strict()
const identitySchema = z.object({ preset: label, version: label, artifact: label }).strict()
const conditionsSchema = z.object({ task: label, evaluator: label, model: label, reasoning: label, tools: label, resources: label, environment: label, harness: label }).strict()
const rateSchema = z.object({ id: label, provider: label, model: label, currency: label, source: label, effectiveAt: label,
  uncachedInput: amount, cacheRead: amount, cacheWrite: amount, output: amount, perRequest: amount }).strict()
export const evaluationManifestSchema: z.ZodType<SuperCodeManifest> = z.object({
  protocol: z.literal('super-code/v3'),
  baseline: identitySchema, candidate: identitySchema,
  cases: z.array(z.object({ taskId: label, category: label, conditions: conditionsSchema }).strict()).min(1),
  // Explicit before the run: equivalence refactors need not claim a quality uplift.
  gates: z.object({ minAccuracyUplift: ratio, maxLostSuccesses: count, minCostReduction: ratio.optional(), minLatencyReduction: ratio.optional() }).strict(),
  rates: z.array(rateSchema),
}).strict()
const requestSchema = z.object({ id: label, sessionId: label, attemptId: label,
  kind: z.enum(['root', 'member', 'retry', 'compaction']), provider: label, model: label,
  rateId: label.optional(), usage: usageSchema.optional(), toolCharge: amount.optional(),
}).strict()
const outcomeSchema = z.enum(['passed', 'failed', 'agent_failed', 'audit_failed', 'infrastructure_error', 'evaluation_error', 'unknown'])
export const evaluationMeasurementSchema: z.ZodType<SuperCodeMeasurement> = z.object({
  protocol: z.literal('super-code/v3'), side: z.enum(sides), identity: identitySchema,
  taskId: label, category: label, conditions: conditionsSchema, mode: z.enum(['real', 'mock', 'replay']), outcome: outcomeSchema,
  latencyMs: amount, expectedRequests: z.array(label), requestManifestComplete: z.boolean(), requests: z.array(requestSchema),
}).strict()
export interface EvaluationSide {
  recorded: number; scored: number; passed: number; attempts: number; requests: number; expectedRequests: number
  latencyMs: number; tokens: EvaluationUsage; outcomes: Record<string, number>
  accounting: { status: 'measured'; currency: string; amount: number } | { status: 'unmeasured'; reasons: string[] }
}
export interface EvaluationPairs { paired: number; gained: string[]; lost: string[]; unchanged: string[]; unscored: string[] }
export interface SuperCodeBatchResult {
  status: 'incomplete' | 'unmatched' | 'unmeasured' | 'measured'; accepted: boolean; reasons: string[]
  planned: number; baseline: EvaluationSide; candidate: EvaluationSide; pairs: EvaluationPairs
  categories: Record<string, { paired: number; gained: number; lost: number }>
  checks: { quality: boolean; cost: boolean; latency: boolean }
}

function unique(values: readonly string[], subject: string): Set<string> {
  const result = new Set(values)
  if (result.size !== values.length) throw new Error(`Duplicate ${subject}`)
  return result
}

/** The adapter supplies a complete request manifest, including failed and maintenance calls. */
function summarize(rows: readonly SuperCodeMeasurement[], rates: SuperCodeManifest['rates']): EvaluationSide {
  const tokens: EvaluationUsage = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  const attempts = new Set<string>(), currencies = new Set<string>(), reasons: string[] = []
  const outcomes: Record<string, number> = {}
  const rateById = new Map(rates.map(rate => [rate.id, rate]))
  let total = 0, requests = 0, expectedRequests = 0, latencyMs = 0, scored = 0, passed = 0
  for (const row of rows) {
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1
    if (isScored(row)) { scored++; if (row.outcome === 'passed') passed++ }
    latencyMs += row.latencyMs
    const expected = unique(row.expectedRequests, 'expected request id')
    const observed = unique(row.requests.map(request => request.id), 'request id')
    expectedRequests += expected.size; requests += observed.size
    if (!row.requestManifestComplete) reasons.push(`${row.taskId}: incomplete request manifest`)
    if (row.outcome === 'passed' && expected.size === 0) reasons.push(`${row.taskId}: passed without model request evidence`)
    for (const id of expected) if (!observed.has(id)) reasons.push(`${row.taskId}: missing request ${id}`)
    for (const request of row.requests) {
      if (!expected.has(request.id)) throw new Error(`Unexpected request ${request.id}`)
      attempts.add(JSON.stringify([row.taskId, request.sessionId, request.attemptId]))
      if (request.usage) for (const key of buckets) tokens[key] += request.usage[key]
      const rate = request.rateId === undefined ? undefined : rateById.get(request.rateId)
      if (!rate || rate.provider !== request.provider || rate.model !== request.model) {
        reasons.push(`${row.taskId}/${request.id}: missing or mismatched price identity`); continue
      }
      currencies.add(rate.currency)
      if (!request.usage || request.toolCharge === undefined) {
        reasons.push(`${row.taskId}/${request.id}: incomplete usage or tool charges`); continue
      }
      total += buckets.reduce((sum, key) => sum + request.usage![key] * rate[key] / 1_000_000, rate.perRequest + request.toolCharge)
    }
  }
  // Empty cost is not automatically free. A single declared currency establishes the unit.
  if (!currencies.size && !requests && rates.length) for (const rate of rates) currencies.add(rate.currency)
  if (currencies.size !== 1) reasons.push('No single known currency; no implicit exchange rates')
  if (!Number.isFinite(total) || !Number.isFinite(latencyMs) || buckets.some(key => !Number.isSafeInteger(tokens[key]))) throw new Error('Evaluation totals exceed numeric capacity')
  return { recorded: rows.length, scored, passed, attempts: attempts.size, requests, expectedRequests, latencyMs, tokens, outcomes,
    accounting: reasons.length ? { status: 'unmeasured', reasons } : { status: 'measured', currency: [...currencies][0]!, amount: total } }
}

function isScored(row: SuperCodeMeasurement): boolean {
  return row.mode === 'real' && ['passed', 'failed', 'agent_failed', 'audit_failed'].includes(row.outcome)
}

function same<T extends object>(left: T, right: T): boolean {
  return (Object.keys(left) as (keyof T)[]).every(key => left[key] === right[key])
}

function meetsReduction(baseline: number, candidate: number, required: number): boolean {
  return baseline === 0 ? candidate === 0 && required === 0 : (baseline - candidate) / baseline + 1e-12 >= required
}

/** Fixed sides, fixed gates, full coverage. Partial reports never imply a release pass. */
export function evaluateSuperCodeBatch(input: SuperCodeManifest, measurements: readonly SuperCodeMeasurement[]): SuperCodeBatchResult {
  const manifest = evaluationManifestSchema.parse(input)
  unique(manifest.cases.map(item => item.taskId), 'manifest task id')
  unique(manifest.rates.map(item => item.id), 'price id')
  const rows = measurements.map(row => evaluationMeasurementSchema.parse(row))
  const cases = new Map(manifest.cases.map(item => [item.taskId, item]))
  const groups = new Map<string, Partial<Record<Side, SuperCodeMeasurement>>>()
  const mismatches: string[] = [], missing: string[] = [], unmeasured: string[] = []
  const requestIdentities = new Set<string>()
  for (const row of rows) {
    const expected = cases.get(row.taskId)
    if (!expected) throw new Error(`Unexpected task ${row.taskId}`)
    const group = groups.get(row.taskId) ?? {}
    if (group[row.side]) throw new Error(`Duplicate ${row.side} measurement for ${row.taskId}`)
    group[row.side] = row; groups.set(row.taskId, group)
    if (row.category !== expected.category || !same(row.conditions, expected.conditions) || !same(row.identity, manifest[row.side])) mismatches.push(`${row.taskId}/${row.side}: comparison identity differs`)
    if (!isScored(row)) unmeasured.push(`${row.taskId}/${row.side}: ${row.mode}/${row.outcome}`)
    for (const request of row.requests) {
      const identity = JSON.stringify([request.sessionId, request.id])
      if (requestIdentities.has(identity)) throw new Error('Duplicate session request across measurements')
      requestIdentities.add(identity)
    }
  }
  const baseline = summarize(rows.filter(row => row.side === 'baseline'), manifest.rates)
  const candidate = summarize(rows.filter(row => row.side === 'candidate'), manifest.rates)
  const pairs: EvaluationPairs = { paired: 0, gained: [], lost: [], unchanged: [], unscored: [] }
  const categories: SuperCodeBatchResult['categories'] = Object.create(null)
  for (const item of manifest.cases) {
    const group = groups.get(item.taskId)
    for (const side of sides) if (!group?.[side]) missing.push(`${item.taskId}/${side}`)
    const a = group?.baseline, b = group?.candidate
    if (!a || !b || !isScored(a) || !isScored(b)) { pairs.unscored.push(item.taskId); continue }
    pairs.paired++
    const category = categories[item.category] ??= { paired: 0, gained: 0, lost: 0 }
    category.paired++
    if (a.outcome !== 'passed' && b.outcome === 'passed') { pairs.gained.push(item.taskId); category.gained++ }
    else if (a.outcome === 'passed' && b.outcome !== 'passed') { pairs.lost.push(item.taskId); category.lost++ }
    else pairs.unchanged.push(item.taskId)
  }
  for (const [side, summary] of [['baseline', baseline], ['candidate', candidate]] as const) {
    if (summary.accounting.status === 'unmeasured') unmeasured.push(...summary.accounting.reasons.map(reason => `${side}: ${reason}`))
  }
  const a = baseline.accounting, b = candidate.accounting
  const comparableCost = a.status === 'measured' && b.status === 'measured' && a.currency === b.currency
  if (a.status === 'measured' && b.status === 'measured' && a.currency !== b.currency) unmeasured.push('Comparison currencies differ')
  const status = mismatches.length ? 'unmatched' : missing.length ? 'incomplete' : unmeasured.length ? 'unmeasured' : 'measured'
  const gates = manifest.gates
  const checks = {
    quality: pairs.paired === manifest.cases.length && (pairs.gained.length - pairs.lost.length) / pairs.paired + 1e-12 >= gates.minAccuracyUplift
      && pairs.lost.length <= gates.maxLostSuccesses && Object.values(categories).every(category => category.gained >= category.lost),
    cost: comparableCost && (gates.minCostReduction === undefined || meetsReduction(a.amount, b.amount, gates.minCostReduction)),
    latency: gates.minLatencyReduction === undefined || meetsReduction(baseline.latencyMs, candidate.latencyMs, gates.minLatencyReduction),
  }
  return { status, accepted: status === 'measured' && Object.values(checks).every(Boolean), reasons: [...mismatches, ...missing, ...unmeasured],
    planned: manifest.cases.length, baseline, candidate, pairs, categories, checks }
}
