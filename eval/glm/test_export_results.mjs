import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate, exportRun } from './export-results.mjs'

async function fixture(t, summary) {
  const root = await mkdtemp(join(tmpdir(), 'public-eval-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'runs', summary.instance_id), { recursive: true })
  await writeFile(join(root, 'runs', summary.instance_id, 'summary.json'), JSON.stringify(summary))
  return root
}
const summary = () => ({
  instance_id: 'instance_fixture', task_index: 1, selection_id: 'fixed-selection',
  repo: 'fixture/repo', base_commit: 'base', valid_score: true,
  official_result: { passed: true }, patch: { sha256: 'patch-hash' },
  source_attempt: '/private/session', candidate: { credentials: 'sensitive-fixture-value' },
  metrics: { usage: { model_calls: 2, input_tokens: 100, cached_input_tokens: 80,
    uncached_input_tokens: 20, output_tokens: 10, total_tokens: 110 },
  accounting: { unknown_usage_requests: 1 }, timing: { response_ms: 1000, excluded_retry_ms: 50 } },
})

test('exports only audited public fields, retaining unknown usage and source fingerprint', async t => {
  const result = await exportRun(await fixture(t, summary()))
  assert.equal(result.passed, 1)
  assert.equal(result.means.total_tokens, 110)
  assert.equal(result.records[0].patch_sha256, 'patch-hash')
  assert.match(result.records[0].summary_sha256, /^[a-f0-9]{64}$/u)
  assert.equal(result.unknown_usage_requests, 1)
  assert(!JSON.stringify(result).includes('sensitive-fixture-value'))
  assert(!JSON.stringify(result).includes('/private/session'))
})

test('new-host canonical source requires verified net time, not raw elapsed time', async t => {
  const input = summary()
  delete input.metrics.timing
  delete input.valid_score
  input.grading_observation = { kind: 'scored', passed: true }
  const root = await fixture(t, input)
  input.source_attempt = join(root, 'attempt')
  await mkdir(input.source_attempt)
  await writeFile(join(input.source_attempt, 'NetResponseTiming.json'), JSON.stringify({ status: 'complete', response_ms: 750, excluded_retry_ms: 250 }))
  await writeFile(join(root, 'runs', input.instance_id, 'summary.json'), JSON.stringify(input))
  const result = await exportRun(root)
  assert.equal(result.valid_scores, 1)
  assert.equal(result.means.response_ms, 750)
  assert.equal(result.records[0].excluded_retry_ms, 250)
})

test('missing timing fails instead of silently using wall time', async t => {
  const input = summary()
  delete input.metrics.timing
  input.source_attempt = 'missing-final-attempt'
  await assert.rejects(exportRun(await fixture(t, input)), /ENOENT/u)
})

test('invalid token accounting fails instead of publishing inconsistent costs', async t => {
  const input = summary()
  input.metrics.usage.total_tokens++
  await assert.rejects(exportRun(await fixture(t, input)), /token components disagree/u)
})

test('duplicate task identities are rejected', () => {
  assert.throws(() => aggregate([{ instance_id: 'same' }, { instance_id: 'same' }]), /duplicate task identity/u)
})

test('pending scores retain task identity but do not affect valid counts or means', () => {
  const scored = { instance_id: 'scored', valid_score: true, passed: true, model_calls: 2,
    input_tokens: 100, cached_input_tokens: 80, uncached_input_tokens: 20,
    output_tokens: 10, total_tokens: 110, response_ms: 1000, unknown_usage_requests: 1 }
  const pending = { ...scored, instance_id: 'pending', valid_score: false,
    passed: false, total_tokens: 10000, response_ms: 60000 }
  const result = aggregate([scored, pending])
  assert.equal(result.task_count, 2)
  assert.equal(result.valid_scores, 1)
  assert.equal(result.passed, 1)
  assert.equal(result.means.total_tokens, 110)
  assert.equal(result.means.response_ms, 1000)
  assert.equal(result.unknown_usage_requests, 1)
})

test('all six published groups reconcile exactly across the same 100 tasks', async () => {
  const groups = []
  for (const file of ['GLMComparison.json', 'HarnessRc2Results.json']) {
    const data = JSON.parse(await readFile(new URL(`../results/swebench-pro-final-100/${file}`, import.meta.url)))
    for (const group of data.runs) {
      const result = aggregate(group.records)
      assert.equal(result.task_count, 100)
      assert.equal(result.valid_scores, group.valid_scores)
      const pending = group.records.filter(row => !row.valid_score)
      assert.equal(pending.length, group.pending_reviews ?? 0)
      assert(pending.every(row => row.grading_status === 'pending-review' && row.score_review))
      assert.equal(result.passed, group.passed)
      assert.equal(result.unknown_usage_requests, group.unknown_usage_requests)
      assert.deepEqual(result.means, group.means)
      groups.push(group.records.map(row => row.instance_id).sort())
    }
  }
  assert.equal(groups.length, 6)
  assert(groups.every(tasks => JSON.stringify(tasks) === JSON.stringify(groups[0])))
})
