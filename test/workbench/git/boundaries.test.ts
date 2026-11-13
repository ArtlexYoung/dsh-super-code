import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { validationRoot } from '../../validation-root.js'
import { remoteUrl, gitRequestSchema } from '../../../src/workbench/git/request.js'
import { textDiff } from '../../../src/workbench/git/diff.js'
const exec = promisify(execFile), author = { name: 'Developer', email: 'developer@example.invalid' }

for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：批量暂存边界、取消暂存、外部更新、只读、异常文件和冲突对比`, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, `git-boundary-${backend}-`))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'missing-git')), signal = new AbortController().signal
    const request = (input: unknown) => repo.execute(input, undefined, signal)
    const state = async () => { const value = await request({ action: 'status' }); if (value.kind !== 'state') throw new Error('state'); return value.state }
    const act = async (input: object) => request({ ...input, version: (await state()).version })
    await request({ action: 'init', branch: 'main' })
    const paths = ['中文 空格.txt', '[literal].txt', '-option.txt']
    for (const name of paths) await fs.writeFile(join(root, name), 'base\n')
    await act({ action: 'stage', paths })
    assert.equal((await state()).changes.filter(file => file.head !== file.stage).length, 3)
    await act({ action: 'unstage', paths })
    assert.equal((await state()).changes.filter(file => file.head !== file.stage).length, 0)
    await act({ action: 'stage', paths }); await act({ action: 'commit', message: 'base', author })
    const previous = await state()
    await request({ action: 'remote', remote: 'origin', url: 'https://example.invalid/repository.git', version: previous.version })
    await assert.rejects(request({ action: 'branch', branch: 'stale', version: previous.version }), /WORKBENCH_GIT_STALE/)
    const readOnly = { mode: 'read-only' as const, workspaceRoot: root }, current = await state()
    const confinedReads = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'missing-git'), argv => argv)
    await assert.rejects(confinedReads.execute({ action: 'branch', branch: 'readonly', version: current.version }, readOnly, signal), /WORKBENCH_GIT_READONLY/)
    const before = await fs.readFile(join(root, '.git/index'))
    assert.equal((await confinedReads.execute({ action: 'status' }, readOnly, signal)).kind, 'state')
    assert.deepEqual(await fs.readFile(join(root, '.git/index')), before)
    await fs.writeFile(join(root, '.git/index.lock'), 'external')
    await fs.writeFile(join(root, paths[0]!), 'modified\n')
    await assert.rejects(act({ action: 'stage', paths: [paths[0]] }), /WORKBENCH_GIT_BUSY/)
    assert.equal(await fs.readFile(join(root, '.git/index.lock'), 'utf8'), 'external'); await fs.unlink(join(root, '.git/index.lock'))
    const version = (await state()).version
    const requests = await Promise.allSettled([request({ action: 'stage', paths: [paths[0]], version }), request({ action: 'unstage', paths: [paths[0]], version })])
    assert.equal(requests[0].status, 'fulfilled'); assert.equal(requests[1].status, 'rejected')
    await fs.writeFile(join(root, 'binary'), Buffer.from([0, 255]))
    const binary = await act({ action: 'diff', path: 'binary', side: 'worktree' }); assert.equal(binary.kind === 'diff' && binary.diff.binary, true)
    await fs.writeFile(join(root, 'large'), 'x'.repeat(2 * 1024 * 1024 + 1))
    await assert.rejects(act({ action: 'diff', path: 'large', side: 'worktree' }), /WORKBENCH_FILE_SIZE/)
    const cancel = new AbortController(); cancel.abort(new Error('cancelled'))
    await assert.rejects(repo.execute({ action: 'status' }, undefined, cancel.signal), /cancelled/)
    if (backend === 'native') {
      const confined = new GitRepository(root, 'git')
      await assert.rejects(confined.execute({ action: 'stage', paths: ['binary'], version: (await state()).version }, { mode: 'workspace-write', workspaceRoot: root }, signal), /WORKBENCH_GIT_SANDBOX/)
    }
  })
}

test('请求拒绝无效路径、重复清单、非法分支、身份和凭据地址', () => {
  const version = 'a'.repeat(64)
  for (const path of ['../secret', '/secret', 'C:/secret', '.git/config', 'a\\b', 'x/../b', 'a\0b']) assert.equal(gitRequestSchema.safeParse({ action: 'stage', paths: [path], version }).success, false)
  for (const paths of [[], ['a', 'a']]) assert.equal(gitRequestSchema.safeParse({ action: 'stage', paths, version }).success, false)
  for (const branch of ['HEAD', '@', '-f', 'a..b', 'a.lock', 'a b', 'a/', '/a', 'a@{b']) assert.equal(gitRequestSchema.safeParse({ action: 'branch', branch, version }).success, false)
  assert.equal(remoteUrl('git@example.invalid:team/repo.git', true), 'git@example.invalid:team/repo.git')
  for (const url of ['https://u:secret@example.invalid/repo', 'https://example.invalid/repo?token=value', 'file:///repo', 'ssh://example.invalid/repo']) assert.throws(() => remoteUrl(url))
  assert.equal(gitRequestSchema.safeParse({ action: 'commit', author: { name: 'injected\nname', email: 'x@example.invalid' }, message: 'm', version }).success, false)
})

test('差异保持 CRLF、无末尾换行、空文件和二进制语义，并限制总行数', () => {
  const bytes = (value: string) => Buffer.from(value)
  for (const [before, after] of [['a\r\n', 'b\r\n'], ['', ''], ['a', 'a\n'], ['a\n', '']]) {
    const diff = textDiff('sample', bytes(before), bytes(after)); assert.equal(diff.before, before); assert.equal(diff.after, after)
  }
  assert.equal(textDiff('binary', Buffer.from([0xFF]), bytes('')).binary, true)
  assert.throws(() => textDiff('large', bytes('a\n'.repeat(21000)), bytes('a\n'.repeat(21000))), /WORKBENCH_GIT_DIFF_LIMIT/)
})

test('本机 Git 支持 linked worktree，内置引擎明确拒绝该布局', async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'git-worktree-')), main = join(root, 'main'), linked = join(root, 'linked')
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(main); const signal = new AbortController().signal
  const repo = new GitRepository(main)
  await repo.execute({ action: 'init', branch: 'main' }, undefined, signal)
  await fs.writeFile(join(main, 'file'), 'base')
  const read = async (repository: GitRepository) => { const result = await repository.execute({ action: 'status' }, undefined, signal); if (result.kind !== 'state') throw new Error('state'); return result.state }
  await repo.execute({ action: 'stage', paths: ['file'], version: (await read(repo)).version }, undefined, signal)
  await repo.execute({ action: 'commit', message: 'base', author, version: (await read(repo)).version }, undefined, signal)
  await exec('git', ['-C', main, 'worktree', 'add', '-b', 'linked', linked])
  const native = new GitRepository(linked)
  assert.equal((await read(native)).branch, 'linked')
  await fs.writeFile(join(linked, 'file'), 'new')
  await native.execute({ action: 'stage', paths: ['file'], version: (await read(native)).version }, undefined, signal)
  await native.execute({ action: 'commit', message: 'worktree', author, version: (await read(native)).version }, undefined, signal)
  assert.equal((await read(native)).changes.length, 0)
  assert.equal(await fs.readFile(join(main, 'file'), 'utf8'), 'base')
  await assert.rejects(new GitRepository(linked, join(root, 'no-git')).execute({ action: 'status' }, undefined, signal), /WORKBENCH_GIT_LAYOUT/)
})
