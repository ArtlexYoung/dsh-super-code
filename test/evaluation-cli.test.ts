import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('evaluation CLI distinguishes accepted, incomplete and malformed evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'super-code-eval-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const conditions = { task: 'task', evaluator: 'test', model: 'model', reasoning: 'high', tools: 'tools', resources: 'cpu', environment: 'image', harness: 'rc.1' }
  const manifest = { protocol: 'super-code/v2', baselineVersion: 'base', candidateVersion: 'next', cases: [{ taskId: 'fix', category: 'bugfix', conditions }] }
  const manifestPath = join(dir, 'manifest.json'), rowsPath = join(dir, 'rows.jsonl')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const invoke = () => spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/evaluate.ts', import.meta.url)), manifestPath, rowsPath], { encoding: 'utf8' })
  await writeFile(rowsPath, '')
  const incomplete = invoke()
  assert.equal(incomplete.status, 1, incomplete.stderr)
  assert.equal(JSON.parse(incomplete.stdout).status, 'incomplete')
  const rows = ['minimal', 'super-code'].map(preset => ({ protocol: manifest.protocol, taskId: 'fix', category: 'bugfix', conditions, preset, mode: 'real', version: preset === 'minimal' ? 'base' : 'next', outcome: preset === 'minimal' ? 'failed' : 'passed', cost: { uncachedInput: preset === 'minimal' ? 100 : 50, cachedInput: 0, output: 10, toolCalls: 1, latencyMs: 10, complete: true } }))
  await writeFile(rowsPath, rows.map(row => JSON.stringify(row)).join('\n'))
  const accepted = invoke()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).accepted, true)
  await writeFile(rowsPath, '{invalid')
  const invalid = invoke()
  assert.equal(invalid.status, 2)
  assert.equal(JSON.parse(invalid.stderr).status, 'invalid')
})
