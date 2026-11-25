import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { textDiff } from '../../../src/workbench/git/diff.js'
import { conflictBlocks, diffBlocks, restoreTextHunk } from '../../../src/workbench/git/text-diff.js'
import { gitRequestSchema } from '../../../src/workbench/git/request.js'
import { validationRoot } from '../../validation-root.js'

const exec = promisify(execFile), author = { name: 'Demo', email: 'demo@example.invalid' }
async function fixture(t: any, backend: string) {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, `git-edits-${backend}-`))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'absent-git'), argv => argv)
  const signal = new AbortController().signal
  const run = (request: unknown, policy?: any, abort = signal) => repo.execute(request, policy, abort)
  const state = async () => { const result = await run({ action: 'status' }); if (result.kind !== 'state') throw new Error('state'); return result.state }
  const act = async (request: object) => run({ ...request, version: (await state()).version })
  await run({ action: 'init', branch: 'main' })
  const commit = async (message: string) => {
    await act({ action: 'stage', paths: (await state()).changes.map(file => file.path) })
    await act({ action: 'commit', message, author })
  }
  return { root, run, state, act, commit, write: (path: string, text: string) => fs.writeFile(join(root, path), text),
    read: (path: string) => fs.readFile(join(root, path), 'utf8'),
    index: async (path: string) => (await exec('git', ['-C', root, 'show', ':' + path])).stdout }
}

test('按段还原使用原文边界，保留空文本、BOM、CRLF、末尾换行和其他差异', () => {
  for (const [before, after, restored] of [
    ['one\nkeep\nlast\n', 'two\nkeep\nchanged\n', 'one\nkeep\nchanged\n'],
    ['\ufeff中文\r\nlast', '\ufeff变化\r\nlast', '\ufeff中文\r\nlast'],
    ['', 'new\n', ''], ['deleted', '', 'deleted'], ['a\n', 'a', 'a\n'],
  ]) {
    const diff = textDiff('a', Buffer.from(before!), Buffer.from(after!))
    assert.equal(restoreTextHunk(diff, 0), restored)
    assert.throws(() => restoreTextHunk(diff, -1), /WORKBENCH_GIT_HUNK/)
    assert.throws(() => restoreTextHunk(diff, 999), /WORKBENCH_GIT_HUNK/)
  }
  assert.equal(diffBlocks(textDiff('a', Buffer.from('one\nkeep\nlast\n'), Buffer.from('two\nkeep\nchanged\n')).lines).length, 2)
})

test('冲突段支持普通、diff3、CRLF、自定义标记长度和文件末尾，保留非冲突内容', () => {
  for (const size of [7, 9]) for (const newline of ['\n', '\r\n']) {
    const marker = (value: string) => value.repeat(size)
    const text = ['prefix', marker('<') + ' ours', 'left', marker('|') + ' base', 'ancestor', marker('='), 'right', marker('>') + ' theirs', 'tail'].join(newline)
    const blocks = conflictBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]!.ours, 'left' + newline); assert.equal(blocks[0]!.theirs, 'right' + newline)
    assert.equal(text.slice(0, blocks[0]!.from) + blocks[0]!.ours + text.slice(blocks[0]!.to), 'prefix' + newline + 'left' + newline + 'tail')
  }
  assert.equal(conflictBlocks('<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs').length, 1)
  assert.deepEqual(conflictBlocks('ordinary text'), [])
  const orphan = '<<<<<<< incomplete\nnot a complete conflict\n', complete = '<<<<<<< ours\nleft\n=======\nright\n>>>>>>> theirs\n'
  assert.deepEqual(conflictBlocks(orphan + complete), [{ from: orphan.length, to: orphan.length + complete.length, ours: 'left\n', theirs: 'right\n' }])
  assert.deepEqual(conflictBlocks('<<<<<<< incomplete\n'.repeat(50000)), [])
})

test('文本编辑请求拒绝越界路径、无效段号、超限文本和额外字段', () => {
  const version = 'a'.repeat(64)
  for (const path of ['', '../a', '.git/index', '/a', 'C:/a', 'a\\b', 'a\0b']) {
    for (const request of [{ action: 'conflict', path, version }, { action: 'restoreHunk', path, version, side: 'total', hunk: 0 }, { action: 'resolveConflict', path, version, text: '' }]) assert.equal(gitRequestSchema.safeParse(request).success, false)
  }
  for (const hunk of [-1, 0.5, NaN, 20001]) assert.equal(gitRequestSchema.safeParse({ action: 'restoreHunk', path: 'a', version, side: 'total', hunk }).success, false)
  for (const text of ['a\0b', '中'.repeat(700000)]) assert.equal(gitRequestSchema.safeParse({ action: 'resolveConflict', path: 'a', version, text }).success, false)
  assert.equal(gitRequestSchema.safeParse({ action: 'resolveConflict', path: 'a', version, text: null }).success, true)
  assert.equal(gitRequestSchema.safeParse({ action: 'conflict', path: 'a', version, extra: true }).success, false)
})

test('native：保存冲突结果遵守 Git 换行属性，工作区保留 CRLF，暂存区使用规范换行', async t => {
  const { root, act, commit, write, read, index, state } = await fixture(t, 'native')
  await write('.gitattributes', '*.txt text eol=crlf\n')
  await write('a.txt', 'base\r\n'); await commit('base')
  await act({ action: 'branch', branch: 'feature' }); await act({ action: 'checkout', branch: 'feature' })
  await write('a.txt', 'theirs\r\n'); await commit('theirs')
  await act({ action: 'checkout', branch: 'main' })
  await write('a.txt', 'ours\r\n'); await commit('ours')
  await act({ action: 'merge', branch: 'feature', author })
  const before = await read('a.txt'), current = await state()
  const blocked = new GitRepository(root, 'git', argv => { if (argv.includes('hash-object')) throw new Error('clean filter unavailable'); return argv })
  await assert.rejects(blocked.execute({ action: 'resolveConflict', path: 'a.txt', text: 'resolved\r\n', version: current.version }, { mode: 'workspace-write', workspaceRoot: root }, new AbortController().signal), /clean filter unavailable/)
  assert.equal(await read('a.txt'), before)
  await act({ action: 'resolveConflict', path: 'a.txt', text: 'resolved\r\n' })
  assert.equal(await read('a.txt'), 'resolved\r\n')
  assert.equal(await index('a.txt'), 'resolved\n')
  const result = await state(), file = result.changes.find(file => file.path === 'a.txt')!
  assert.equal(file.worktree, file.stage)
  assert.equal(file.conflict, false)
  assert.equal((await fs.stat(join(root, '.git/index'))).isFile(), true)
})

test('native：按块暂存遵守 CRLF 属性，保持磁盘字节和规范化的索引内容', async t => {
  const { act, state, commit, write, read, index } = await fixture(t, 'native')
  await write('.gitattributes', '*.txt text eol=crlf\n')
  await write('a.txt', 'base\r\nkeep\r\n'); await commit('base')
  await write('a.txt', 'changed\r\nkeep\r\n')
  await act({ action: 'stageHunk', path: 'a.txt', hunk: 0 })
  assert.equal(await index('a.txt'), 'changed\nkeep\n')
  assert.equal(await read('a.txt'), 'changed\r\nkeep\r\n')
  const change = (await state()).changes.find(file => file.path === 'a.txt')!
  assert.equal(change.stage, change.worktree)
})

for (const backend of ['native', 'builtin']) {
  test(`${backend}：按块暂存只写入选中差异，保留原有暂存和工作区字节`, async t => {
    const { run, state, act, commit, write, read, index } = await fixture(t, backend)
    const file = '中文 "改动".txt', base = '\ufefffirst\r\nkeep\r\nlast'
    await write(file, base); await commit('base')
    const staged = base.replace('keep', 'already staged')
    await write(file, staged); await act({ action: 'stage', paths: [file] })
    const current = staged.replace('first', 'edited first').replace('last', 'edited last')
    await write(file, current)
    const request = { action: 'stageHunk', path: file, hunk: 1, version: (await state()).version }
    await assert.rejects(run(request, { mode: 'read-only' }), /WORKBENCH_GIT_READONLY/)
    await run(request)
    assert.equal(await index(file), staged.replace('last', 'edited last'))
    assert.equal(await read(file), current)
    await assert.rejects(run(request), /WORKBENCH_GIT_STALE/)
    await assert.rejects(act({ ...request, hunk: 99 }), /WORKBENCH_GIT_HUNK/)
    await act({ ...request, hunk: 0 })
    assert.equal(await index(file), current)
  })

  test(`${backend}：按段还原隔离暂存区与工作区，拒绝过期、只读和占用`, async t => {
    const { root, run, state, act, commit, write, read, index } = await fixture(t, backend)
    await write('a.txt', 'base\nkeep\nlast\n'); await commit('base')
    await write('a.txt', 'staged\nkeep\nstaged last\n'); await act({ action: 'stage', paths: ['a.txt'] })
    await write('a.txt', 'working\nkeep\nworking last\n')
    await act({ action: 'restoreHunk', path: 'a.txt', side: 'worktree', hunk: 0 })
    assert.equal(await read('a.txt'), 'staged\nkeep\nworking last\n')
    assert.equal(await index('a.txt'), 'staged\nkeep\nstaged last\n')
    await act({ action: 'restoreHunk', path: 'a.txt', side: 'staged', hunk: 1 })
    assert.equal(await index('a.txt'), 'staged\nkeep\nlast\n')
    assert.equal(await read('a.txt'), 'staged\nkeep\nworking last\n')
    const version = (await state()).version
    const abort = new AbortController(); abort.abort(new Error('cancelled edit'))
    await assert.rejects(run({ action: 'restoreHunk', path: 'a.txt', side: 'total', hunk: 0, version }, undefined, abort.signal), /cancelled edit/)
    assert.equal(await read('a.txt'), 'staged\nkeep\nworking last\n')
    await assert.rejects(run({ action: 'restoreHunk', path: 'a.txt', side: 'total', hunk: 0, version }, { mode: 'read-only' }), /WORKBENCH_GIT_READONLY/)
    await fs.writeFile(join(root, '.git/index.lock'), 'other task')
    await assert.rejects(run({ action: 'restoreHunk', path: 'a.txt', side: 'total', hunk: 0, version }), /WORKBENCH_GIT_BUSY/)
    assert.equal(await read('a.txt'), 'staged\nkeep\nworking last\n')
    await fs.unlink(join(root, '.git/index.lock'))
    await write('a.txt', 'outside\nkeep\nworking last\n')
    await assert.rejects(run({ action: 'restoreHunk', path: 'a.txt', side: 'total', hunk: 0, version }), /WORKBENCH_GIT_STALE/)
    await act({ action: 'restoreHunk', path: 'a.txt', side: 'total', hunk: 0 })
    assert.equal(await read('a.txt'), 'base\nkeep\nworking last\n')
    assert.equal(await index('a.txt'), 'staged\nkeep\nlast\n')
  })
  test(`${backend}：新增、删除、无初次提交和特殊路径均可还原，字节及文件权限保留`, async t => {
    const { root, act, commit, write, read, index, state } = await fixture(t, backend)
    await write('new', 'new\n'); await act({ action: 'restoreHunk', path: 'new', side: 'worktree', hunk: 0 })
    await assert.rejects(read('new'), { code: 'ENOENT' })
    await write('new', 'staged\n'); await act({ action: 'stage', paths: ['new'] })
    await act({ action: 'restoreHunk', path: 'new', side: 'staged', hunk: 0 })
    assert.equal(await read('new'), 'staged\n'); assert.equal((await state()).changes[0]!.stage, 0)
    const path = '中文 "引号"\t文件.txt', original = '\ufeff原文\r\nlast'
    await write(path, original); await fs.chmod(join(root, path), 0o755); await commit('base')
    await write(path, '\ufeff改变\r\nlast')
    await act({ action: 'restoreHunk', path, side: 'worktree', hunk: 0 }); assert.equal(await read(path), original)
    await fs.unlink(join(root, path)); await act({ action: 'restoreHunk', path, side: 'worktree', hunk: 0 })
    assert.equal(await read(path), original)
    if (process.platform !== 'win32') assert.equal((await fs.stat(join(root, path))).mode & 0o111, 0o111)
    assert.equal(await index(path), original)
  })
  test(`${backend}：三栏读取不改文件，保存结果只解决当前冲突并暂存，提交仍显式进行`, async t => {
    const { root, act, commit, write, read, index, state, run } = await fixture(t, backend)
    await write('a.txt', 'base\n'); await write('other', 'base\n'); await commit('base')
    await act({ action: 'branch', branch: 'feature' }); await act({ action: 'checkout', branch: 'feature' })
    await write('a.txt', 'theirs\n'); await write('other', 'theirs\n'); await commit('theirs')
    await act({ action: 'checkout', branch: 'main' })
    await write('a.txt', 'ours\n'); await write('other', 'ours\n'); await commit('ours')
    const head = (await state()).head
    await act({ action: 'merge', branch: 'feature', author })
    const before = await read('a.txt'), result = await act({ action: 'conflict', path: 'a.txt' })
    assert.equal(result.kind, 'conflict'); if (result.kind !== 'conflict') return
    assert.equal(result.conflict.ours, 'ours\n'); assert.equal(result.conflict.theirs, 'theirs\n')
    assert.equal(result.conflict.result, before); assert.equal(result.conflict.version, (await state()).version)
    await assert.rejects(act({ action: 'resolveConflict', path: 'a.txt', text: before }), /WORKBENCH_GIT_UNRESOLVED/)
    await assert.rejects(act({ action: 'restoreHunk', path: 'a.txt', side: 'worktree', hunk: 0 }), /WORKBENCH_GIT_CONFLICT/)
    await assert.rejects(run({ action: 'resolveConflict', path: 'a.txt', text: 'resolved\n', version: result.conflict.version }, { mode: 'read-only' }), /WORKBENCH_GIT_READONLY/)
    await fs.writeFile(join(root, '.git/index.lock'), 'other task')
    await assert.rejects(act({ action: 'resolveConflict', path: 'a.txt', text: 'resolved\n' }), /WORKBENCH_GIT_BUSY/)
    assert.equal(await read('a.txt'), before); await fs.unlink(join(root, '.git/index.lock'))
    await act({ action: 'resolveConflict', path: 'a.txt', text: 'resolved\r\nwithout final newline' })
    assert.equal(await read('a.txt'), 'resolved\r\nwithout final newline')
    assert.equal(await index('a.txt'), 'resolved\r\nwithout final newline')
    assert.equal((await state()).head, head); assert.equal((await state()).merging, true)
    assert.equal((await state()).changes.some(file => file.path === 'a.txt' && file.conflict), false)
    assert.equal((await state()).changes.some(file => file.path === 'other' && file.conflict), true)
    await act({ action: 'resolveConflict', path: 'other', text: null })
    await assert.rejects(read('other'), { code: 'ENOENT' })
    assert.equal((await state()).changes.some(file => file.conflict), false)
    await act({ action: 'commit', message: 'resolve', author })
    assert.equal((await state()).merging, false); assert.equal((await state()).changes.length, 0)
  })
  test(`${backend}：非普通文本不能逐段还原，未写入文件或暂存区`, async t => {
    const { root, act, commit, write, state } = await fixture(t, backend)
    await write('binary', 'base\n'); await write('target', 'target\n'); await commit('base')
    const index = await fs.readFile(join(root, '.git/index'))
    for (const bytes of [Buffer.from([0, 1]), Buffer.from([255]), Buffer.alloc(2 * 1024 * 1024 + 1, 'x')]) {
      await fs.writeFile(join(root, 'binary'), bytes)
      await assert.rejects(act({ action: 'restoreHunk', path: 'binary', side: 'total', hunk: 0 }), /WORKBENCH_(GIT_TEXT_FILE|GIT_HUNK|FILE_SIZE)/)
      assert.deepEqual(await fs.readFile(join(root, 'binary')), bytes)
      assert.deepEqual(await fs.readFile(join(root, '.git/index')), index)
    }
    if (process.platform !== 'win32') {
      await fs.unlink(join(root, 'binary')); await fs.symlink('target', join(root, 'binary'))
      await assert.rejects(act({ action: 'restoreHunk', path: 'binary', side: 'total', hunk: 0 }), /WORKBENCH_GIT_TEXT_FILE/)
      assert.equal(await fs.readlink(join(root, 'binary')), 'target')
      assert.equal(await fs.readFile(join(root, 'target'), 'utf8'), 'target\n')
      assert.deepEqual(await fs.readFile(join(root, '.git/index')), index)
    }
    assert.equal((await state()).changes.some(file => file.path === 'binary'), true)
  })
}
