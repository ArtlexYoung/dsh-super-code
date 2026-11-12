import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { applyPtcBudget } from '../../src/dsh/ptc-budget.js'
import type { Budgets } from '../../src/dsh/budgets.js'
import { gitSnapshot, workspaceChanges } from '../../src/connection/git.js'

const deadlines: { label: string; budgets: Budgets; request: { timeoutMs?: number | null }; expected: number | null }[] = [
  { label: 'unconfigured null', budgets: {}, request: { timeoutMs: null }, expected: null },
  { label: 'default-only null', budgets: { ptcTimeoutMs: 300 }, request: { timeoutMs: null }, expected: null },
  { label: 'ceiling-only null', budgets: { ptcMaxTimeoutMs: 400 }, request: { timeoutMs: null }, expected: 400 },
  { label: 'default-and-ceiling null', budgets: { ptcTimeoutMs: 300, ptcMaxTimeoutMs: 400 }, request: { timeoutMs: null }, expected: 400 },
  { label: 'omitted deadline', budgets: { ptcTimeoutMs: 300, ptcMaxTimeoutMs: 400 }, request: {}, expected: 300 },
  { label: 'explicit long deadline', budgets: { ptcTimeoutMs: 300, ptcMaxTimeoutMs: 400 }, request: { timeoutMs: 500 }, expected: 400 },
  { label: 'explicit short deadline', budgets: { ptcTimeoutMs: 300, ptcMaxTimeoutMs: 400 }, request: { timeoutMs: 50 }, expected: 50 },
  { label: 'ceiling-only host default', budgets: { ptcMaxTimeoutMs: 400 }, request: {}, expected: 120 },
]

for (const row of deadlines) test(`PTC preserves explicit deadline semantics: ${row.label}`, async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const runtime = {
    timeout: { defaultMs: 120, maxMs: 600 },
    resolve: (request: { timeoutMs?: number | null; program: string }) => ({ ...request,
      timeoutMs: request.timeoutMs === null ? null : Math.min(request.timeoutMs ?? 120, 600) }),
  }
  const original = runtime.resolve
  ctx.provide('ptcRuntime', runtime)
  const feature = ctx.plugin({ apply(owner: Context) { applyPtcBudget(owner, row.budgets) } })
  await feature
  const request = { program: 'Keep program and request unchanged', ...row.request }, before = structuredClone(request)
  const result = await ctx.waterfall('tools/execute', { name: 'run_code' } as any,
    async () => ({ isError: false, content: [], value: runtime.resolve(request) }))
  assert.equal(result.value.timeoutMs, row.expected)
  assert.equal(result.value.program, before.program)
  assert.deepEqual(request, before, 'the caller and recorded tool arguments stay unchanged')
  await feature.dispose()
  assert.equal(runtime.resolve, original)
  assert.equal(runtime.resolve({ program: '', timeoutMs: null }).timeoutMs, null)
})

const exec = promisify(execFile)
async function workspace(t: test.TestContext) {
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, '工作目录 边界-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args])).stdout
  await git('init', '--quiet')
  await writeFile(join(root, 'tracked.txt'), 'Retain the existing worktree and index\n')
  await git('add', 'tracked.txt')
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture')
  const script = join(root, '未跟踪 脚本.sh')
  await writeFile(script, '#!/bin/sh\nprintf ready\n', { mode: 0o600 })
  return { root, script, git }
}

test('untracked executable-only changes are visible without changing Git or file contents', { skip: process.platform === 'win32' }, async t => {
  const f = await workspace(t), original = await readFile(f.script, 'utf8')
  const index = await f.git('ls-files', '--stage'), head = await f.git('rev-parse', 'HEAD')
  const baseline = await gitSnapshot(f.root)
  assert.equal(baseline.available, true)
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
  await chmod(f.script, 0o700)
  const changed = await workspaceChanges(f.root, baseline)
  assert.equal(changed.available, true)
  assert.deepEqual(changed.currentDirty, baseline.dirty, 'the porcelain status is still the same untracked path')
  assert.equal(changed.changedSinceStart, true, 'making an existing script runnable is a real change')
  assert.equal(changed.headChanged, false)
  assert.equal(await readFile(f.script, 'utf8'), original)
  assert.equal(await f.git('ls-files', '--stage'), index)
  assert.equal(await f.git('rev-parse', 'HEAD'), head)
  await chmod(f.script, 0o600)
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
})

test('untracked observation ignores permission bits outside the Git executable identity', { skip: process.platform === 'win32' }, async t => {
  const f = await workspace(t), baseline = await gitSnapshot(f.root)
  await chmod(f.script, 0o644)
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
  await chmod(f.script, 0o700)
  const executable = await gitSnapshot(f.root)
  await chmod(f.script, 0o755)
  assert.equal((await workspaceChanges(f.root, executable)).changedSinceStart, false)
})

test('persisted v2 Git observations remain readable without inventing missing permission evidence', async t => {
  const f = await workspace(t), baseline = { ...await gitSnapshot(f.root), fingerprint: 'v2:' + 'e'.repeat(64) }
  const original = structuredClone(baseline), result = await workspaceChanges(f.root, baseline)
  assert.equal(result.available, false)
  assert.equal(result.truncated, true)
  assert.equal(result.changedSinceStart, false)
  assert.deepEqual(result.baselineDirty, original.dirty)
  assert.deepEqual(result.currentDirty, original.dirty)
  assert.deepEqual(baseline, original)
})
