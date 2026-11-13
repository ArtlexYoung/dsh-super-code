import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { validationRoot } from '../../validation-root.js'

for (const backend of ['native', 'builtin'] as const) test(`${backend}：侧栏统计合并暂存与未暂存差异，覆盖新增、删除、二进制、超限和失效版本`, async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, `git-statistics-${backend}-`))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'missing-git')), signal = new AbortController().signal
  const run = (input: unknown) => repo.execute(input, undefined, signal)
  const state = async () => { const result = await run({ action: 'status' }); if (result.kind !== 'state') throw new Error('state'); return result.state }
  const act = async (input: object) => run({ ...input, version: (await state()).version })
  await run({ action: 'init', branch: 'main' })
  await fs.writeFile(join(root, '空格 文件.txt'), 'original\r\nunchanged\r\n')
  await fs.writeFile(join(root, 'delete.txt'), 'removed\n')
  await act({ action: 'stage', paths: ['空格 文件.txt', 'delete.txt'] })
  await act({ action: 'commit', message: 'base', author: { name: 'Demo', email: 'demo@example.invalid' } })
  await fs.writeFile(join(root, '空格 文件.txt'), 'staged\r\nunchanged\r\n')
  await act({ action: 'stage', paths: ['空格 文件.txt'] })
  await fs.writeFile(join(root, '空格 文件.txt'), 'current\r\nunchanged\r\nextra\r\n')
  await fs.unlink(join(root, 'delete.txt'))
  await fs.writeFile(join(root, 'new.txt'), 'new\nfile')
  await fs.writeFile(join(root, 'binary'), Buffer.from([0, 255]))
  await fs.writeFile(join(root, 'large.txt'), 'x'.repeat(2 * 1024 * 1024 + 1))
  const version = (await state()).version
  const result = await run({ action: 'stats', paths: ['空格 文件.txt', 'delete.txt', 'new.txt', 'binary', 'large.txt'], version })
  assert.equal(result.kind, 'stats')
  if (result.kind !== 'stats') return
  assert.deepEqual(result.stats, [
    { path: '空格 文件.txt', added: 2, removed: 1, binary: false },
    { path: 'delete.txt', added: 0, removed: 1, binary: false },
    { path: 'new.txt', added: 2, removed: 0, binary: false },
    { path: 'binary', added: 0, removed: 0, binary: true },
    { path: 'large.txt', added: 0, removed: 0, binary: false, limited: true },
  ])
  const diff = await run({ action: 'diff', path: '空格 文件.txt', side: 'total', version })
  assert.equal(diff.kind === 'diff' && diff.diff.before, 'original\r\nunchanged\r\n')
  assert.equal(diff.kind === 'diff' && diff.diff.after, 'current\r\nunchanged\r\nextra\r\n')
  await fs.writeFile(join(root, 'external.txt'), 'external')
  await assert.rejects(run({ action: 'stats', paths: ['new.txt'], version }), /WORKBENCH_GIT_STALE/)
  await assert.rejects(act({ action: 'stats', paths: ['not-changed'] }), /WORKBENCH_GIT_STALE/)
})

for (const backend of ['native', 'builtin'] as const) test(`${backend}：无初次提交时可以比较与统计新增文件`, async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, `git-statistics-empty-${backend}-`))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'missing-git')), signal = new AbortController().signal
  await repo.execute({ action: 'init', branch: 'main' }, undefined, signal)
  await fs.writeFile(join(root, 'new.txt'), 'first\n')
  const state = await repo.execute({ action: 'status' }, undefined, signal)
  assert.equal(state.kind, 'state'); if (state.kind !== 'state') return
  const stats = await repo.execute({ action: 'stats', paths: ['new.txt'], version: state.state.version }, undefined, signal)
  assert.equal(stats.kind, 'stats'); if (stats.kind === 'stats') assert.equal(stats.stats[0]?.added, 1)
  const diff = await repo.execute({ action: 'diff', path: 'new.txt', side: 'total', version: state.state.version }, undefined, signal)
  assert.equal(diff.kind === 'diff' && diff.diff.before, '')
})
