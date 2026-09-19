import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSuperCodeBatch } from '../src/core/evaluation.js'
import type { SuperCodeManifest, SuperCodeMeasurement } from '../src/core/evaluation.js'

export const conditions = { task: 'task-hash', evaluator: 'test-hash', model: 'm', reasoning: 'high', tools: 'tools', resources: 'cpu', environment: 'image', harness: 'rc.2' }
export const manifest: SuperCodeManifest = {
  protocol: 'super-code/v3', baseline: { preset: 'super-code', version: '0.0.8', artifact: 'base-hash' }, candidate: { preset: 'super-code', version: '0.0.9', artifact: 'next-hash' },
  cases: [{ taskId: 'fix', category: 'bugfix', conditions }, { taskId: 'opt', category: 'algorithm', conditions }],
  gates: { minAccuracyUplift: 0, maxLostSuccesses: 0, minCostReduction: 0.1 },
  rates: [{ id: 'price', provider: 'p', model: 'm', currency: 'USD', source: 'fixture-not-real-pricing', effectiveAt: '2026-09-19', uncachedInput: 1, cacheRead: 0.1, cacheWrite: 2, output: 5, perRequest: 0 }],
}
export const row = (taskId: string, side: 'baseline' | 'candidate'): SuperCodeMeasurement => ({ protocol: 'super-code/v3', taskId, side, identity: manifest[side], category: taskId === 'fix' ? 'bugfix' : 'algorithm', conditions, mode: 'real', outcome: 'passed',
  latencyMs: 10, requestManifestComplete: true, expectedRequests: ['r'], requests: [{ id: 'r', sessionId: `${taskId}-${side}`, attemptId: 'first', kind: 'root', provider: 'p', model: 'm', rateId: 'price', toolCharge: 0,
    usage: { uncachedInput: side === 'baseline' ? 100 : 50, cacheRead: 20, cacheWrite: 0, output: 10 } }] })
export const rows = (): SuperCodeMeasurement[] => manifest.cases.flatMap(({ taskId }) => [row(taskId, 'baseline'), row(taskId, 'candidate')])

test('same-preset version comparison accepts unchanged quality with measured cost reduction', () => {
  const result = evaluateSuperCodeBatch(manifest, rows())
  assert.equal(result.accepted, true)
  assert.equal(result.status, 'measured')
  assert.equal(result.pairs.paired, 2)
  assert.deepEqual(result.pairs.lost, [])
  assert.equal(result.baseline.requests, 2)
  assert.equal(result.baseline.accounting.status, 'measured')
})

test('arbitrary category names remain own data and cannot bypass category regression gates', () => {
  const categories = ['__proto__', 'constructor']
  const input = rows().map(item => ({ ...item, category: categories[item.taskId === 'fix' ? 0 : 1]! }))
  input[1]!.outcome = 'failed'; input[2]!.outcome = 'failed'
  const result = evaluateSuperCodeBatch({ ...manifest,
    cases: manifest.cases.map((item, index) => ({ ...item, category: categories[index]! })),
    gates: { minAccuracyUplift: 0, maxLostSuccesses: 1 },
  }, input)
  assert.equal(result.accepted, false)
  assert.deepEqual(JSON.parse(JSON.stringify(result.categories)), JSON.parse('{"__proto__":{"paired":1,"gained":0,"lost":1},"constructor":{"paired":1,"gained":1,"lost":0}}'))
  assert.equal(Object.hasOwn(Object.prototype, 'paired'), false)
})

test('all failed attempts, members, retries and compaction are billed exactly once', () => {
  const input = rows()
  input[0]!.outcome = 'agent_failed'
  for (const kind of ['member', 'retry', 'compaction'] as const) {
    input[0]!.expectedRequests.push(kind)
    input[0]!.requests.push({ ...input[0]!.requests[0]!, id: kind, attemptId: kind, kind })
  }
  const result = evaluateSuperCodeBatch(manifest, input)
  assert.equal(result.baseline.requests, 5)
  assert.equal(result.baseline.attempts, 5)
  assert.equal(result.baseline.tokens.output, 50)
  assert.deepEqual(result.pairs.gained, ['fix'])
  assert.equal(result.baseline.outcomes.agent_failed, 1)
  assert.throws(() => evaluateSuperCodeBatch(manifest, [...input, input[0]!]), /Duplicate/)
  input[1]!.requests[0]!.sessionId = input[0]!.requests[0]!.sessionId
  assert.throws(() => evaluateSuperCodeBatch(manifest, input), /Duplicate session request/)
})

test('missing, mismatched, mocked and infrastructure results remain visible and cannot pass', () => {
  const incomplete = evaluateSuperCodeBatch(manifest, rows().slice(1))
  assert.equal(incomplete.status, 'incomplete')
  assert.equal(incomplete.baseline.recorded, 1)
  for (const patch of [{ mode: 'mock' }, { outcome: 'infrastructure_error' }, { requestManifestComplete: false }] as Partial<SuperCodeMeasurement>[]) {
    const input = rows(); input[0] = { ...input[0]!, ...patch }
    const result = evaluateSuperCodeBatch(manifest, input)
    assert.equal(result.status, 'unmeasured')
    assert.equal(result.accepted, false)
    assert.equal(result.baseline.requests, 2)
  }
  const input = rows(); input[0]!.identity = { ...manifest.baseline, artifact: 'wrong' }
  assert.equal(evaluateSuperCodeBatch(manifest, input).status, 'unmatched')
  input[0]!.identity = manifest.baseline; input[0]!.expectedRequests.push('missing')
  assert.equal(evaluateSuperCodeBatch(manifest, input).status, 'unmeasured')
})

test('price identity, unknown usage and mixed currencies never become a zero-cost win', () => {
  for (const patch of [{ rateId: 'absent' }, { usage: undefined }, { toolCharge: undefined }, { model: 'different' }]) {
    const input = rows(); input[1]!.requests[0] = { ...input[1]!.requests[0]!, ...patch }
    assert.equal(evaluateSuperCodeBatch(manifest, input).candidate.accounting.status, 'unmeasured')
  }
  const input = rows(); input[1]!.requests[0]!.rateId = 'eur'
  assert.equal(evaluateSuperCodeBatch({ ...manifest, rates: [...manifest.rates, { ...manifest.rates[0]!, id: 'eur', currency: 'EUR' }] }, input).status, 'unmeasured')
  assert.throws(() => evaluateSuperCodeBatch({ ...manifest, rates: [...manifest.rates, manifest.rates[0]!] }, rows()), /Duplicate price/)
})

test('fewer tokens can cost more; lost successes cannot hide in another category', () => {
  const input = rows(); input[1]!.requests[0]!.usage = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 40 }
  const result = evaluateSuperCodeBatch(manifest, input)
  assert.equal(result.checks.cost, false)
  assert.equal(result.accepted, false)
  const changed = rows(); changed[1]!.outcome = 'failed'; changed[2]!.outcome = 'failed'
  const compared = evaluateSuperCodeBatch({ ...manifest, gates: { minAccuracyUplift: 0, maxLostSuccesses: 1 } }, changed)
  assert.deepEqual(compared.pairs.gained, ['opt'])
  assert.deepEqual(compared.pairs.lost, ['fix'])
  assert.equal(compared.checks.quality, false)
})
