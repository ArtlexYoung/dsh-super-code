import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gitSnapshot, gitWorktreeRoot, workspaceChanges } from '../../src/connection/git.js'

const exec = promisify(execFile)
async function fixture(t: test.TestContext, name = '') {
  const base = await mkdtemp(join(tmpdir(), 'super-code-git-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = name ? join(base, name) : base
  if (name) await mkdir(root)
  const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args])).stdout
  await git('init', '--quiet')
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await git('add', 'tracked.txt')
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture')
  return { root, git }
}

for (const name of ['中文 目录\u3000', 'workspace ', 'workspace\r\n']) test(`Git preserves the exact worktree root ${JSON.stringify(name)}`,
  { skip: process.platform === 'win32' && name !== '中文 目录\u3000' }, async t => {
    const f = await fixture(t, name), root = await realpath(f.root), nested = join(root, 'nested')
    await mkdir(nested)
    assert.equal(resolve(String(await gitWorktreeRoot(f.root))), root)
    assert.equal(resolve(String(await gitWorktreeRoot(nested))), root)
    const path = join(nested, '未跟踪.txt')
    await writeFile(path, 'original')
    const baseline = await gitSnapshot(nested)
    assert.equal(baseline.available, true)
    assert.equal(resolve(baseline.root), root)
    assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, false)
    await writeFile(path, 'updated')
    assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, true)
    await writeFile(path, 'original')
    assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, false)
  })

test('Git observation detects content transferred between existing untracked files', async t => {
  const f = await fixture(t)
  const write = async (a: string, b: string) => {
    await writeFile(join(f.root, 'a'), a)
    await writeFile(join(f.root, 'b'), b)
  }
  await write('', 'b')
  const baseline = await gitSnapshot(f.root)
  assert.equal(baseline.available, true)
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
  await write('b', '')
  const changed = await workspaceChanges(f.root, baseline)
  assert.equal(changed.available, true)
  assert.deepEqual(changed.currentDirty, baseline.dirty, 'file names and Git status stay the same')
  assert.equal(changed.changedSinceStart, true, 'file boundaries are part of content identity')
  await write('', 'b')
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
})

test('Git observation detects staged-only changes with an unchanged worktree and status', async t => {
  const f = await fixture(t), path = join(f.root, 'tracked.txt')
  const stage = async (content: string) => {
    await writeFile(path, content)
    await f.git('add', 'tracked.txt')
    await writeFile(path, 'base\n')
  }
  await stage('first staged content\n')
  const baseline = await gitSnapshot(f.root), head = await f.git('rev-parse', 'HEAD')
  assert.equal(baseline.available, true)
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
  await stage('second staged content\n')
  const changed = await workspaceChanges(f.root, baseline)
  assert.equal(changed.available, true)
  assert.deepEqual(changed.currentDirty, baseline.dirty, 'the porcelain status remains MM')
  assert.equal(changed.changedSinceStart, true, 'the index has changed even though the worktree has not')
  assert.equal(changed.headChanged, false)
  assert.equal(await f.git('show', ':tracked.txt'), 'second staged content\n', 'observation preserves the index')
  assert.equal(await readFile(path, 'utf8'), 'base\n')
  assert.equal(await f.git('rev-parse', 'HEAD'), head)
  await stage('first staged content\n')
  assert.equal((await workspaceChanges(f.root, baseline)).changedSinceStart, false)
})

test('old persisted Git baselines remain readable without inventing a comparison result', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'a'), 'Existing user work')
  const baseline = { ...await gitSnapshot(f.root), fingerprint: 'a'.repeat(64) }
  const original = structuredClone(baseline), changed = await workspaceChanges(f.root, baseline)
  assert.equal(changed.available, false, 'the previous algorithm did not record enough information')
  assert.equal(changed.truncated, true)
  assert.equal(changed.changedSinceStart, false)
  assert.deepEqual(changed.baselineDirty, baseline.dirty)
  assert.deepEqual(changed.currentDirty, baseline.dirty, 'current Git status is still available')
  assert.deepEqual(baseline, original, 'reading never rewrites a persisted baseline')
})

test('Git observations keep nested workspaces scoped and support Unicode and newline file names', async t => {
  const f = await fixture(t), nested = join(f.root, '中文 目录')
  await mkdir(nested)
  const file = join(nested, process.platform === 'win32' ? 'a b.txt' : 'a\nb.txt')
  await writeFile(file, 'original')
  const baseline = await gitSnapshot(nested)
  assert.equal(baseline.available, true)
  await writeFile(join(f.root, 'tracked.txt'), 'unrelated parent change')
  assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, false)
  await writeFile(file, 'inside the workspace')
  assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, true)
  await writeFile(file, 'original')
  assert.equal((await workspaceChanges(nested, baseline)).changedSinceStart, false)
})

test('Git observes symlink targets without following or modifying their contents', async t => {
  const f = await fixture(t), first = join(f.root, 'first'), second = join(f.root, 'second'), link = join(f.root, 'link')
  await writeFile(first, 'first content')
  await writeFile(second, 'second content')
  await f.git('add', 'first', 'second')
  await symlink('first', link)
  const baseline = await gitSnapshot(f.root)
  assert.equal(baseline.available, true)
  await rm(link)
  await symlink('second', link)
  const changed = await workspaceChanges(f.root, baseline)
  assert.equal(changed.available, true)
  assert.equal(changed.changedSinceStart, true)
  assert.equal(await readFile(first, 'utf8'), 'first content')
  assert.equal(await readFile(second, 'utf8'), 'second content')
})

for (const boundary of ['count', 'bytes'] as const) test(`Git observations disclose the untracked ${boundary} limit and recover after cleanup`, async t => {
  const f = await fixture(t), baseline = await gitSnapshot(f.root)
  const names = boundary === 'count' ? Array.from({ length: 161 }, (_, i) => `file-${i}`) : ['large.bin']
  for (const name of names) await writeFile(join(f.root, name), boundary === 'bytes' ? Buffer.alloc(1024 * 1024 + 1) : '')
  const unavailable = await workspaceChanges(f.root, baseline)
  assert.equal(unavailable.available, false)
  assert.equal(unavailable.truncated, true)
  assert.equal(unavailable.changedSinceStart, false, 'unavailable observations are never a verified comparison')
  if (boundary === 'count') await rm(join(f.root, names.pop()!))
  else await writeFile(join(f.root, names[0]!), Buffer.alloc(1024 * 1024))
  const exact = await workspaceChanges(f.root, baseline)
  assert.equal(exact.available, true, 'the configured limit itself is still supported')
  assert.equal(exact.changedSinceStart, true)
  for (const name of names) await rm(join(f.root, name))
  const recovered = await workspaceChanges(f.root, baseline)
  assert.equal(recovered.available, true)
  assert.equal(recovered.changedSinceStart, false)
})
