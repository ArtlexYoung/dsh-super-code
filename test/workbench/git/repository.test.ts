import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { validationRoot } from '../../validation-root.js'
import { library } from '../../../src/workbench/git/library.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'

async function fixture(t: any) {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-workbench-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repository = new GitRepository(root, join(root, 'not-installed-git'))
  const signal = new AbortController().signal
  const request = (input: unknown) => repository.execute(input, undefined, signal)
  const state = async () => { const result = await request({ action: 'status' }); if (result.kind !== 'state') throw new Error('Expected state'); return result.state }
  const author = { name: 'Test Developer', email: 'developer@example.invalid' }
  return { root, request, state, repository, signal, author }
}

test('内置 Git 不运行 Git 程序，支持空仓库、中文文件、暂存、提交和历史', async t => {
  const { root, request, state, author } = await fixture(t)
  assert.equal((await state()).exists, false)
  await request({ action: 'init', branch: 'main' })
  await fs.writeFile(join(root, '中文 文件.ts'), 'export const value = 1;\r\n')
  let current = await state()
  assert.deepEqual(current.changes.map(file => file.path), ['中文 文件.ts'])
  await request({ action: 'stage', paths: ['中文 文件.ts'], version: current.version })
  current = await state()
  await request({ action: 'commit', message: '初始化', author, version: current.version })
  current = await state()
  assert.equal(current.changes.length, 0)
  assert.equal(current.history[0]?.message, '初始化\n')
  assert.equal(current.branch, 'main')
  assert.equal(await fs.readFile(join(root, '中文 文件.ts'), 'utf8'), 'export const value = 1;\r\n')
  assert.equal(await library.git.resolveRef({ fs, dir: root, ref: 'HEAD' }), current.head)
})

test('差异区分暂存与未暂存，删除和二进制文件仍可查看状态', async t => {
  const { root, request, state, author } = await fixture(t)
  await request({ action: 'init', branch: 'main' })
  await fs.writeFile(join(root, 'a.txt'), 'one\n')
  await request({ action: 'stage', paths: ['a.txt'], version: (await state()).version })
  await request({ action: 'commit', message: 'base', author, version: (await state()).version })
  await fs.writeFile(join(root, 'a.txt'), 'two\n')
  await request({ action: 'stage', paths: ['a.txt'], version: (await state()).version })
  await fs.writeFile(join(root, 'a.txt'), 'three\n')
  for (const [side, before, after] of [['staged', 'one\n', 'two\n'], ['worktree', 'two\n', 'three\n']]) {
    const result = await request({ action: 'diff', path: 'a.txt', side, version: (await state()).version })
    assert.equal(result.kind, 'diff'); if (result.kind !== 'diff') throw new Error('Expected diff')
    assert.equal(result.diff.before, before); assert.equal(result.diff.after, after)
  }
  await request({ action: 'unstage', paths: ['a.txt'], version: (await state()).version })
  await fs.unlink(join(root, 'a.txt'))
  await request({ action: 'stage', paths: ['a.txt'], version: (await state()).version })
  assert.equal((await state()).changes[0]?.stage, 0)
  await fs.writeFile(join(root, 'binary.bin'), Buffer.from([0, 255, 1]))
  const result = await request({ action: 'diff', path: 'binary.bin', side: 'worktree', version: (await state()).version })
  assert.equal(result.kind === 'diff' && result.diff.binary, true)
})

test('旧页面操作被拒绝，分支切换保留未提交改动', async t => {
  const { root, request, state, author } = await fixture(t)
  await request({ action: 'init', branch: 'main' })
  await fs.writeFile(join(root, 'a.txt'), 'base')
  const previous = await state()
  await fs.writeFile(join(root, 'a.txt'), 'changed')
  await assert.rejects(request({ action: 'stage', paths: ['a.txt'], version: previous.version }), /WORKBENCH_GIT_STALE/)
  await request({ action: 'stage', paths: ['a.txt'], version: (await state()).version })
  await request({ action: 'commit', message: 'base', author, version: (await state()).version })
  await request({ action: 'branch', branch: 'feature', version: (await state()).version })
  await fs.writeFile(join(root, 'a.txt'), 'unfinished')
  await assert.rejects(request({ action: 'checkout', branch: 'feature', version: (await state()).version }), /WORKBENCH_GIT_DIRTY/)
  assert.equal(await fs.readFile(join(root, 'a.txt'), 'utf8'), 'unfinished')
})

test('只读、越界、符号链接、无效请求和外部索引锁不会被绕过', async t => {
  const { root, repository, request, state, signal } = await fixture(t)
  const policy = { mode: 'read-only' as const, workspaceRoot: root }
  await assert.rejects(repository.execute({ action: 'init', branch: 'main' }, policy, signal), /WORKBENCH_GIT_READONLY/)
  await request({ action: 'init', branch: 'main' })
  assert.equal((await repository.execute({ action: 'status' }, policy, signal)).kind, 'state')
  await fs.writeFile(join(root, 'a.txt'), 'a')
  for (const path of ['../outside', '/etc/passwd', 'C:/secret', '.git/config', 'x\\y']) await assert.rejects(request({ action: 'stage', paths: [path], version: (await state()).version }))
  await fs.writeFile(join(root, '.git/index.lock'), 'owned elsewhere')
  await assert.rejects(request({ action: 'stage', paths: ['a.txt'], version: (await state()).version }), /WORKBENCH_GIT_BUSY/)
  assert.equal(await fs.readFile(join(root, '.git/index.lock'), 'utf8'), 'owned elsewhere')
  await fs.unlink(join(root, '.git/index.lock'))
  const outside = await fs.mkdtemp(join(validationRoot, 'git-outside-'))
  t.after(() => fs.rm(outside, { recursive: true, force: true }))
  await fs.writeFile(join(outside, 'secret'), 'private')
  await fs.symlink(join(outside, 'secret'), join(root, 'link'))
  const result = await request({ action: 'diff', path: 'link', side: 'worktree', version: (await state()).version })
  assert.equal(result.kind === 'diff' && result.diff.after.includes('private'), false)
  await assert.rejects(request({ action: 'status', extra: true }))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(repository.execute({ action: 'status' }, undefined, abort.signal))
})
