import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validationRoot } from '../../validation-root.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { library } from '../../../src/workbench/git/library.js'

const exec = promisify(execFile)
const author = { name: 'Test Developer', email: 'developer@example.invalid' }
for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：真实仓库的分支、文件对比、合并冲突、解决和取消`, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, `git-${backend}-`))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const repo = new GitRepository(root, backend === 'builtin' ? join(root, 'absent-git') : 'git')
    const signal = new AbortController().signal
    const request = (input: unknown) => repo.execute(input, undefined, signal)
    const state = async () => { const result = await request({ action: 'status' }); assert.equal(result.kind, 'state'); if (result.kind !== 'state') throw new Error('state'); return result.state }
    const act = async (input: object) => request({ ...input, version: (await state()).version })
    const commit = async (message: string) => {
      const files = (await state()).changes.map(file => file.path)
      await act({ action: 'stage', paths: files })
      await act({ action: 'commit', message, author })
      assert.equal((await state()).changes.length, 0)
    }
    assert.equal((await state()).backend, backend)
    await request({ action: 'init', branch: 'main' })
    await fs.writeFile(join(root, '中文 文件.ts'), 'export const value = 1;\n')
    await fs.writeFile(join(root, 'a.txt'), 'base\n')
    await commit('base')
    const base = (await state()).head!
    const files = await act({ action: 'commitFiles', oid: base })
    assert.deepEqual(files.kind === 'commitFiles' && files.files, ['a.txt', '中文 文件.ts'])
    const diff = await act({ action: 'historyDiff', oid: base, path: '中文 文件.ts' })
    assert.equal(diff.kind === 'diff' && diff.diff.before, '')
    assert.equal(diff.kind === 'diff' && diff.diff.after, 'export const value = 1;\n')
    await act({ action: 'branch', branch: 'feature' })
    await act({ action: 'checkout', branch: 'feature' })
    assert.equal((await state()).branch, 'feature')
    await fs.writeFile(join(root, 'new.txt'), 'new\n')
    await commit('feature')
    await act({ action: 'checkout', branch: 'main' })
    await fs.writeFile(join(root, 'main.txt'), 'main\n')
    await commit('main')
    await act({ action: 'merge', branch: 'feature', author })
    assert.equal(await fs.readFile(join(root, 'new.txt'), 'utf8'), 'new\n')
    assert.equal((await state()).changes.length, 0)
    const merged = await library.git.readCommit({ fs, dir: root, oid: (await state()).head! })
    assert.equal(merged.commit.parent.length, 2)
    await act({ action: 'deleteBranch', branch: 'feature' })
    assert.deepEqual((await state()).branches, ['main'])

    await act({ action: 'branch', branch: 'conflict' })
    await act({ action: 'checkout', branch: 'conflict' })
    await fs.writeFile(join(root, 'a.txt'), 'theirs\n')
    await commit('theirs')
    const theirs = (await state()).head!
    await act({ action: 'checkout', branch: 'main' })
    await fs.writeFile(join(root, 'a.txt'), 'ours\n')
    await commit('ours')
    const ours = (await state()).head!
    await assert.rejects(act({ action: 'deleteBranch', branch: 'conflict' }), /WORKBENCH_GIT_BRANCH_UNMERGED/)
    await act({ action: 'merge', branch: 'conflict', author })
    assert.equal((await state()).merging, true)
    assert.equal((await state()).changes.find(file => file.path === 'a.txt')?.conflict, true)
    assert.match(await fs.readFile(join(root, 'a.txt'), 'utf8'), /<<<<<<< /)
    const conflictDiff = await act({ action: 'diff', path: 'a.txt', side: 'worktree' })
    assert.equal(conflictDiff.kind === 'diff' && conflictDiff.diff.before, 'ours\n')
    assert.match(conflictDiff.kind === 'diff' ? conflictDiff.diff.after : '', /<<<<<<< /)
    await assert.rejects(act({ action: 'commit', message: 'unresolved', author }), /WORKBENCH_GIT_CONFLICT/)
    const beforeStatus = await fs.readFile(join(root, '.git/index'))
    await state()
    assert.deepEqual(await fs.readFile(join(root, '.git/index')), beforeStatus)
    await act({ action: 'abortMerge' })
    assert.equal(await fs.readFile(join(root, 'a.txt'), 'utf8'), 'ours\n')
    assert.equal((await state()).changes.length, 0)
    assert.equal((await state()).merging, false)
    await act({ action: 'merge', branch: 'conflict', author })
    await fs.writeFile(join(root, 'a.txt'), 'resolved\n')
    await act({ action: 'stage', paths: ['a.txt'] })
    assert.equal((await state()).changes.some(file => file.conflict), false)
    await act({ action: 'commit', message: 'resolve', author })
    const result = await library.git.readCommit({ fs, dir: root, oid: (await state()).head! })
    assert.deepEqual(result.commit.parent, [ours, theirs])
    assert.equal((await state()).merging, false)
    assert.equal((await state()).changes.length, 0)
    // 另一种实现独立读取最终状态，不能只相信面板的返回值。
    assert.equal((await exec('git', ['-C', root, 'status', '--porcelain'])).stdout, '')
  })
}

test('原生 Git 钩子失败时不改用内置引擎重放提交', async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-hook-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repo = new GitRepository(root)
  const request = (input: unknown) => repo.execute(input, undefined, new AbortController().signal)
  const state = async () => { const result = await request({ action: 'status' }); if (result.kind !== 'state') throw new Error('state'); return result.state }
  await request({ action: 'init', branch: 'main' })
  await fs.writeFile(join(root, 'a'), 'a')
  await request({ action: 'stage', paths: ['a'], version: (await state()).version })
  await fs.writeFile(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await assert.rejects(request({ action: 'commit', message: 'blocked', author, version: (await state()).version }), /WORKBENCH_GIT_NATIVE/)
  assert.equal((await state()).head, null)
  assert.equal((await state()).backend, 'native')
})
