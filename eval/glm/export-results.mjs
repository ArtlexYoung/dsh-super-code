#!/usr/bin/env node
/** Export sanitized canonical task records; never invokes a model. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const digest = data => createHash('sha256').update(data).digest('hex')
const number = (value, name) => {
  const result = typeof value === 'object' && value !== null ? value.total : value
  assert(Number.isFinite(result) && result >= 0, `missing or invalid ${name}`)
  return result
}

export function aggregate(records) {
  assert(records.length > 0, 'no task summaries found')
  assert(new Set(records.map(row => row.instance_id)).size === records.length, 'duplicate task identity')
  const valid = records.filter(row => row.valid_score)
  assert(valid.length > 0, 'no valid scores')
  const keys = ['model_calls', 'input_tokens', 'cached_input_tokens', 'uncached_input_tokens', 'output_tokens', 'total_tokens', 'response_ms']
  return {
    task_count: records.length,
    valid_scores: valid.length,
    passed: valid.filter(row => row.passed).length,
    means: Object.fromEntries(keys.map(key => [key, valid.reduce((sum, row) => sum + number(row[key], key), 0) / valid.length])),
    unknown_usage_requests: valid.reduce((sum, row) => sum + row.unknown_usage_requests, 0),
  }
}

export async function exportRun(root) {
  const runDir = join(root, 'runs')
  const entries = await readdir(runDir, { withFileTypes: true })
  const records = []
  const selections = new Set()
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const bytes = await readFile(join(runDir, entry.name, 'summary.json'))
    const summary = JSON.parse(bytes)
    const usage = summary.metrics?.usage ?? {}
    const accounting = summary.metrics?.accounting ?? {}
    const valid = summary.valid_score === true || (summary.valid_score !== false && summary.grading_observation?.kind === 'scored')
    assert(typeof summary.official_result?.passed === 'boolean', 'missing verdict')
    assert(summary.instance_id === entry.name, 'directory/task identity mismatch')
    selections.add(summary.selection_id)
    let timing = summary.metrics?.timing
    if (!timing) {
      // Read only the selected final attempt; never pick a better earlier answer.
      const source = summary.source_attempt
      assert(typeof source === 'string', 'missing canonical source attempt')
      timing = JSON.parse(await readFile(join(source, 'NetResponseTiming.json'), 'utf8'))
      assert(timing.status === 'complete', 'unverified net timing')
    }
    const row = {
      task_index: summary.task_index,
      instance_id: summary.instance_id,
      repo: summary.repo,
      base_commit: summary.base_commit,
      started_at: summary.started_at,
      completed_at: summary.completed_at,
      valid_score: valid,
      passed: summary.official_result.passed,
      model_calls: number(usage.model_calls, 'model_calls'),
      ...Object.fromEntries(['input_tokens', 'cached_input_tokens', 'uncached_input_tokens', 'output_tokens', 'total_tokens'].map(key => [key, number(usage[key], key)])),
      response_ms: number(timing.response_ms, 'response_ms'),
      excluded_retry_ms: number(timing.excluded_retry_ms, 'excluded_retry_ms'),
      unknown_usage_requests: number(accounting.unknown_usage_requests ?? 0, 'unknown_usage_requests'),
      patch_sha256: summary.patch?.sha256,
      summary_sha256: digest(bytes),
      grading_reason: summary.grading_decision?.reason ?? summary.grading_observation?.reason ?? 'scored',
    }
    assert(row.total_tokens === row.cached_input_tokens + row.uncached_input_tokens + row.output_tokens, 'token components disagree')
    assert(row.input_tokens === row.cached_input_tokens + row.uncached_input_tokens, 'input components disagree')
    records.push(row)
  }
  assert(selections.size === 1 && !selections.has(undefined), 'task selection mismatch')
  records.sort((a, b) => a.task_index - b.task_index)
  return { schema: 1, selection_id: [...selections][0], ...aggregate(records), records }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.split('=')
    return [key, rest.join('=')]
  }))
  assert(args.has('--root'), 'usage: node eval/glm/export-results.mjs --root=<canonical-run> [--output=<file>]')
  const result = await exportRun(resolve(args.get('--root')))
  const output = `${JSON.stringify(result, null, 2)}\n`
  if (args.has('--output')) await writeFile(resolve(args.get('--output')), output)
  else process.stdout.write(output)
}
