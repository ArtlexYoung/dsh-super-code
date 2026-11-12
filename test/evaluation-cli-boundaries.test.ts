import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-eval-boundaries-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const conditions = Object.fromEntries(['task', 'evaluator', 'model', 'reasoning', 'tools', 'resources', 'environment', 'harness'].map(key => [key, 'fixture']))
  const manifest = { protocol: 'super-code/v3', baseline: { preset: 'base', version: '1', artifact: 'base' },
    candidate: { preset: 'next', version: '1', artifact: 'next' }, cases: [{ taskId: 'fix', category: 'bugfix', conditions }],
    gates: { minAccuracyUplift: 0, maxLostSuccesses: 0 }, rates: [] }
  const path = join(directory, 'manifest.json')
  await writeFile(path, JSON.stringify(manifest))
  const invoke = (measurements: string) => spawnSync(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('../src/evaluate.ts', import.meta.url)), path, measurements],
    { encoding: 'utf8', timeout: 10000 })
  return { directory, manifest, invoke }
}

test('evaluation CLI reports input stream failures as one structured invalid result', async t => {
  const { directory, invoke } = await fixture(t)
  for (const path of [join(directory, 'missing.jsonl'), directory]) {
    const result = invoke(path)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.deepEqual(Object.keys(JSON.parse(result.stderr)).sort(), ['accepted', 'error', 'status'])
    assert.equal(JSON.parse(result.stderr).status, 'invalid')
    assert.equal(JSON.parse(result.stderr).accepted, false)
  }
})

test('evaluation CLI rejects surplus measurements before producing acceptance totals', async t => {
  const { directory, manifest, invoke } = await fixture(t)
  const row = { protocol: manifest.protocol, side: 'baseline', identity: manifest.baseline,
    ...manifest.cases[0], mode: 'real', outcome: 'failed', latencyMs: 1,
    expectedRequests: [], requestManifestComplete: true, requests: [] }
  const path = join(directory, 'rows.jsonl')
  await writeFile(path, Array(3).fill(JSON.stringify(row)).join('\n'))
  const result = invoke(path)
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(JSON.parse(result.stderr).status, 'invalid')
  assert.match(JSON.parse(result.stderr).error, /Too many measurements/)
})
