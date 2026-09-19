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
  const manifest = { protocol: 'super-code/v3', baseline: { preset: 'super-code', version: '0.0.8', artifact: 'base' }, candidate: { preset: 'super-code', version: '0.0.9', artifact: 'next' },
    cases: [{ taskId: 'fix', category: 'bugfix', conditions }], gates: { minAccuracyUplift: 0, maxLostSuccesses: 0 },
    rates: [{ id: 'fixture', provider: 'p', model: 'model', currency: 'USD', source: 'test', effectiveAt: '2026-09-19', uncachedInput: 1, cacheRead: 0.1, cacheWrite: 2, output: 5, perRequest: 0 }] }
  const manifestPath = join(dir, 'manifest.json'), rowsPath = join(dir, 'rows.jsonl')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const invoke = () => spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/evaluate.ts', import.meta.url)), manifestPath, rowsPath], { encoding: 'utf8' })
  await writeFile(rowsPath, '')
  const incomplete = invoke()
  assert.equal(incomplete.status, 1, incomplete.stderr)
  assert.equal(JSON.parse(incomplete.stdout).status, 'incomplete')
  const rows = (['baseline', 'candidate'] as const).map(side => ({ protocol: manifest.protocol, taskId: 'fix', category: 'bugfix', conditions, side, identity: manifest[side], mode: 'real', outcome: 'passed', latencyMs: 10,
    requestManifestComplete: true, expectedRequests: ['r'], requests: [{ id: 'r', sessionId: side, attemptId: 'a', kind: 'root', provider: 'p', model: 'model', rateId: 'fixture', toolCharge: 0,
      usage: { uncachedInput: 100, cacheRead: 0, cacheWrite: 0, output: 10 } }] }))
  await writeFile(rowsPath, rows.map(row => JSON.stringify(row)).join('\n'))
  const accepted = invoke()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).accepted, true)
  await writeFile(rowsPath, '{invalid')
  const invalid = invoke()
  assert.equal(invalid.status, 2)
  assert.equal(JSON.parse(invalid.stderr).status, 'invalid')
  await writeFile(manifestPath, JSON.stringify({ ...manifest, protocol: 'super-code/v2' }))
  assert.equal(invoke().status, 2)
})
