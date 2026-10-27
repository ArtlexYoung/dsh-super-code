import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

test('published reconciliations bind original patches and preserve raw verdicts', async () => {
  const base = new URL('../results/swebench-pro-final-100/', import.meta.url)
  const bytes = await readFile(new URL('GradingReconciliation.json', base))
  const review = JSON.parse(bytes)
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert.equal(review.new_model_calls, 0)
  assert.equal(review.records.length, 7)
  assert(!/\/Users\/|\/Volumes\/|\.development\//u.test(bytes.toString()))
  const nodes = review.records.filter(row => row.id.startsWith('nodebb-'))
  assert.equal(nodes.length, 6)
  for (const file of ['GLMComparison.json', 'HarnessRc2Results.json']) {
    const snapshot = JSON.parse(await readFile(new URL(file, base)))
    assert.equal(snapshot.reconciliation.sha256, digest)
    for (const group of snapshot.runs) {
      const receipt = nodes.find(row => row.group === group.name)
      assert(receipt)
      const row = group.records.find(item => item.instance_id === receipt.instance_id)
      assert.equal(row.patch_sha256, receipt.patch_sha256)
      assert.equal(row.summary_sha256, receipt.corrected_summary_sha256)
      assert.equal(row.original_passed, receipt.previous_passed)
      assert.equal(row.passed, receipt.passed)
      assert.equal(row.grader_passed, receipt.grader_passed)
      assert.equal(row.grading_review.id, receipt.id)
      assert.equal(receipt.model_calls_added, 0)
      assert.equal(receipt.original_answer_and_accounting_preserved, true)
      assert.equal(receipt.confirmations.length, 2)
      for (const confirmation of receipt.confirmations) {
        assert.equal(confirmation.passed, row.passed)
        assert.equal(confirmation.no_test_assertion_or_status_changed, true)
        assert.deepEqual(confirmation.missing, [])
        assert.deepEqual(confirmation.extra_failures_require_attribution, [])
        if (row.passed) assert.deepEqual(confirmation.failed, [])
      }
    }
  }
})

test('all official presets include the reconciled task set and exact per-task means', async () => {
  const base = new URL('../results/swebench-pro-final-100/', import.meta.url)
  const snapshot = JSON.parse(await readFile(new URL('OfficialPresetResults.json', base)))
  const bytes = await readFile(new URL('GradingReconciliation.json', base))
  const review = JSON.parse(bytes)
  assert.equal(snapshot.audit.reconciliation.sha256, createHash('sha256').update(bytes).digest('hex'))
  const expected = snapshot.modes[0].rows.map(row => row.instance_id).sort()
  for (const mode of snapshot.modes) {
    assert.equal(mode.status, 'complete')
    assert.equal(mode.rows.length, 100)
    assert.equal(new Set(mode.rows.map(row => row.instance_id)).size, 100)
    assert.deepEqual(mode.rows.map(row => row.instance_id).sort(), expected)
    assert.equal(mode.summary.valid_scores, 100)
    assert.equal(mode.summary.passed, mode.rows.filter(row => row.passed).length)
    for (const key of ['model_calls', 'tool_calls', 'input_tokens', 'cached_input_tokens',
      'uncached_input_tokens', 'output_tokens', 'total_tokens']) {
      assert.equal(mode.summary[`average_${key}`], mode.rows.reduce((sum, row) => sum + row[key], 0) / 100)
    }
    for (const [key, field] of [['raw_response_ms', 'average_raw_minutes'], ['response_ms', 'average_net_minutes']]) {
      const mean = mode.rows.reduce((sum, row) => sum + row[key], 0) / 100 / 60000
      assert(Math.abs(mode.summary[field] - mean) < 1e-10)
    }
  }
  const restored = review.records.find(row => row.id === 'official-standard-max-task610')
  const mode = snapshot.modes.find(row => row.preset === 'standard' && row.reasoning_effort === 'max')
  assert.deepEqual(mode.rows.find(row => row.instance_id === restored.added_row.instance_id), restored.added_row)
  assert.equal(restored.grading_runs_added, 0)
  assert.equal(restored.model_calls_added, 0)
})
