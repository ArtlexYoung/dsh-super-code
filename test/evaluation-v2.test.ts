import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSuperCodeBatch } from '../src/core/evaluation-v2.js'
import type { SuperCodeManifest, SuperCodeMeasurement } from '../src/core/evaluation-v2.js'

const conditions = { task: 'task-hash', evaluator: 'test-v1', model: 'model-v1', reasoning: 'high', tools: 'tools-v1', resources: 'cpu-2', environment: 'image-hash', harness: '0.1.2-rc.1' }
const manifest: SuperCodeManifest = { protocol: 'super-code/v2', baselineVersion: 'baseline-hash', candidateVersion: 'candidate-hash', cases: [{ taskId: 'fix', category: 'bugfix', conditions }, { taskId: 'opt', category: 'algorithm', conditions }] }
const row = (taskId: string, preset: 'minimal' | 'super-code'): SuperCodeMeasurement => ({ protocol: 'super-code/v2', taskId, preset, category: taskId === 'fix' ? 'bugfix' : 'algorithm', mode: 'real', version: preset === 'minimal' ? 'baseline-hash' : 'candidate-hash', conditions, outcome: preset === 'super-code' || taskId === 'fix' ? 'passed' : 'failed', cost: { uncachedInput: preset === 'minimal' ? 100 : 60, cachedInput: 10, output: 10, toolCalls: 1, latencyMs: 10, complete: true } })
const rows = () => manifest.cases.flatMap(({ taskId }) => [row(taskId, 'minimal'), row(taskId, 'super-code')])

test('evaluates one fixed super-code candidate with failed baseline cost included', () => {
  const result = evaluateSuperCodeBatch(manifest, rows())
  assert.equal(result.status, 'measured')
  assert.equal(result.accepted, true)
  if (result.status !== 'measured') throw new Error('expected measurements')
  assert.equal(result.aggregate.baseline.totalTokens, 120)
  assert.equal(result.aggregate.baseline.successRate, 0.5)
  assert.equal(result.aggregate.candidate.totalTokens, 80)
})
test('partial, duplicate and unmatched results cannot be promoted', () => {
  assert.equal(evaluateSuperCodeBatch(manifest, rows().slice(1)).status, 'incomplete')
  assert.throws(() => evaluateSuperCodeBatch(manifest, [...rows(), row('fix', 'super-code')]), /Duplicate/)
  const changed = rows(); changed[0] = { ...changed[0]!, conditions: { ...conditions, environment: 'different' } }
  assert.equal(evaluateSuperCodeBatch(manifest, changed).status, 'unmatched')
})
test('replay, infrastructure failures and missing total cost remain unmeasured', () => {
  for (const patch of [{ mode: 'mock' }, { mode: 'replay' }, { outcome: 'infrastructure_error' }, { cost: { ...row('fix', 'minimal').cost, complete: false } }] as Partial<SuperCodeMeasurement>[]) {
    const changed = rows(); changed[0] = { ...changed[0]!, ...patch }
    assert.equal(evaluateSuperCodeBatch(manifest, changed).status, 'unmeasured')
  }
})
test('category regressions cannot hide behind pooled improvements', () => {
  const changed = rows(); changed[1] = { ...changed[1]!, outcome: 'failed' }
  assert.equal(evaluateSuperCodeBatch(manifest, changed, { minAccuracyUplift: 0 }).accepted, false)
})
