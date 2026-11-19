import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { library } from '../../../src/workbench/git/library.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { gitRequestSchema } from '../../../src/workbench/git/request.js'
import { lineHistory } from '../../../src/workbench/git/history.js'
import { validationRoot } from '../../validation-root.js'

const author = { name: 'Developer', email: 'developer@example.invalid' }, exec = promisify(execFile)
const source = (n: number) => `function compute(input) {\n  const factor = 2\n  return input * factor + ${n}\n}\n`
async function fixture(t: any, backend: 'native' | 'builtin') {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, 'history-boundaries-')), options = { fs, dir: root }, signal = new AbortController().signal
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await library.git.init({ ...options, defaultBranch: 'main' })
  const repository = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'no-git'), argv => argv)
  const request = (input: object) => repository.execute(input, undefined, signal)
  const state = async () => { const result = await request({ action: 'status' }); if (result.kind !== 'state') throw new Error('state'); return result.state }
  async function commit(files: Record<string, string | null>, message: string, parent?: string[]) {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) { await fs.unlink(join(root, path)); await library.git.remove({ ...options, filepath: path }) }
      else { await fs.writeFile(join(root, path), text); await library.git.add({ ...options, filepath: path }) }
    }
    return library.git.commit({ ...options, message, author, parent })
  }
  async function history(text: string, path = 'main.ts', start = 1, end = text.trimEnd().split('\n').length) {
    const result = await request({ action: 'lineHistory', text, target: { path, start, end }, version: (await state()).version })
    if (result.kind !== 'lineHistory') throw new Error('history')
    return result.history
  }
  return { root, options, repository, request, state, commit, history, signal }
}

for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：合并历史遍历所有父提交，忽略未合并分支，保持拓扑顺序`, async t => {
    const { options, commit, history } = await fixture(t, backend)
    const base = await commit({ 'main.ts': source(0) }, 'base')
    await library.git.branch({ ...options, ref: 'side' }); await library.git.branch({ ...options, ref: 'unmerged' })
    const main = await commit({ 'main.ts': source(1) }, 'main change')
    await library.git.checkout({ ...options, ref: 'side' })
    const side = await commit({ 'main.ts': source(2) }, 'side change')
    await library.git.checkout({ ...options, ref: 'unmerged' })
    const unmerged = await commit({ 'main.ts': source(99) }, 'unmerged')
    await library.git.checkout({ ...options, ref: 'main' })
    const merged = await commit({ 'main.ts': source(3) }, 'merge', [main, side])
    const result = await history(source(3))
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(new Set(result.entries.map(entry => entry.oid)), new Set([base, main, side, merged]))
    assert.equal(result.entries.filter(entry => entry.oid === merged).length, 2)
    assert.equal(result.entries[0]!.oid, merged)
    assert.equal(result.entries.at(-1)!.oid, base)
    assert.equal(result.entries.some(entry => entry.oid === unmerged), false)
  })

  test(`${backend}：改名同时修改内容、函数改名及未提交的新代码不串到同名函数`, async t => {
    const { commit, history } = await fixture(t, backend)
    const base = await commit({ 'main.ts': source(0) }, 'base')
    const renamed = await commit({ 'main.ts': null, 'renamed.ts': source(1) }, 'rename and edit')
    const text = source(2).replace('compute', 'calculate')
    const changed = await commit({ 'renamed.ts': text }, 'rename function')
    const result = await history(text, 'renamed.ts')
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.entries.map(entry => entry.oid), [changed, renamed, base])
    const edited = await history(text.replace(' + 2', ' + 3'), 'renamed.ts')
    assert.equal(edited.uncommitted, true)
    assert.equal(edited.entries.length, 3)
    const appended = text + '\nfunction newFunction() {\n  return 100\n}\n'
    const fresh = await history(appended, 'renamed.ts', 6, 8)
    assert.equal(fresh.uncommitted, true); assert.deepEqual(fresh.entries, [])
  })

  test(`${backend}：重复旧文件不猜测改名来源，保留历史不完整标记`, async t => {
    const { commit, history } = await fixture(t, backend)
    await commit({ 'main.ts': source(0), 'copy.ts': source(0) }, 'two identical files')
    await commit({ 'main.ts': null, 'copy.ts': null, 'new.ts': source(0) }, 'ambiguous rename')
    const result = await history(source(0), 'new.ts')
    assert.deepEqual(result.entries, [])
    assert.deepEqual(result.warnings, ['ambiguous'])
  })

  test(`${backend}：复制函数属于新代码，移动并修改仍追踪原函数，保留 CRLF 与无末尾换行`, async t => {
    const { commit, history, request, state } = await fixture(t, backend)
    const base = source(0).replaceAll('\n', '\r\n'), other = 'function other() {\r\n  return 20\r\n}\r\n'
    const initial = await commit({ 'main.ts': base + other }, 'base')
    const moved = other + source(1).replaceAll('\n', '\r\n')
    const movedOid = await commit({ 'main.ts': moved }, 'move and edit')
    const result = await history(moved, 'main.ts', 4, 7)
    assert.deepEqual(result.entries.map(entry => entry.oid), [movedOid, initial])
    assert.deepEqual(result.warnings, [])
    const { oid, parent, before, after } = result.entries[0]!
    const diff = await request({ action: 'lineHistoryDiff', entry: { oid, parent, before, after }, version: (await state()).version })
    assert.equal(diff.kind === 'diff' && diff.diff.after, source(1).replaceAll('\n', '\r\n'))
    const copy = await commit({ 'main.ts': moved + source(1).replaceAll('\n', '\r\n').trimEnd() }, 'copy function')
    const copied = await history(moved + source(1).replaceAll('\n', '\r\n').trimEnd(), 'main.ts', 8, 11)
    assert.deepEqual(copied.entries.map(entry => entry.oid), [copy])
    assert.equal(copied.entries[0]!.before, null)
  })

  test(`${backend}：不可比较的旧版本保留不完整说明，不创建索引或复原二进制`, async t => {
    const { root, commit, history } = await fixture(t, backend)
    await commit({ 'main.ts': '\0old binary' }, 'binary')
    await commit({ 'main.ts': source(1) }, 'text')
    const result = await history(source(1))
    assert.deepEqual(result.warnings, ['unsupported'])
    assert.equal(await fs.readFile(join(root, 'main.ts'), 'utf8'), source(1))
    const entries = await fs.readdir(root)
    assert.deepEqual(entries.sort(), ['.git', 'main.ts'])
  })

  test(`${backend}：空仓库、新文件、非法行、二进制、取消、旧版本和伪造父关系`, async t => {
    const { root, commit, history, repository, state, request } = await fixture(t, backend)
    assert.deepEqual((await history('')).entries, [])
    assert.deepEqual((await history(source(0))).entries, [])
    await commit({ 'main.ts': source(0), 'binary': '\0content' }, 'base')
    await assert.rejects(history(source(0), 'main.ts', 1, 99), /WORKBENCH_GIT_RANGE/)
    await assert.rejects(history('\0content', 'binary'), /WORKBENCH_GIT_HISTORY_FILE/)
    const old = await state()
    const next = await commit({ 'main.ts': source(1) }, 'next')
    await assert.rejects(request({ action: 'lineHistory', target: { path: 'main.ts', start: 1, end: 4 }, text: source(0), version: old.version }), /WORKBENCH_GIT_STALE/)
    const version = (await state()).version, abort = new AbortController(); abort.abort(new Error('stopped'))
    await assert.rejects(repository.execute({ action: 'lineHistory', target: { path: 'main.ts', start: 1, end: 4 }, text: source(1), version }, undefined, abort.signal), /stopped/)
    const after = { path: 'main.ts', start: 1, end: 4 }
    await assert.rejects(request({ action: 'lineHistoryDiff', entry: { oid: next, parent: null, before: null, after }, version }), /WORKBENCH_GIT_STALE/)
    await assert.rejects(request({ action: 'lineHistoryDiff', entry: { oid: 'a'.repeat(40), parent: null, before: null, after }, version }), /WORKBENCH_GIT_STALE/)
    if (process.platform !== 'win32') {
      await fs.symlink('main.ts', join(root, 'link')); await library.git.add({ fs, dir: root, filepath: 'link' }); await library.git.commit({ fs, dir: root, message: 'link', author })
      await assert.rejects(history('main.ts', 'link'), /WORKBENCH_GIT_HISTORY_FILE/)
    }
  })

  test(`${backend}：浅克隆不把截断点冒充最初创建`, async t => {
    const { root, commit } = await fixture(t, backend)
    for (let i = 0; i < 4; i++) await commit({ 'main.ts': source(i) }, `revision ${i}`)
    const clone = join(root, 'shallow')
    await exec('git', ['clone', '--quiet', '--depth=2', pathToFileURL(root).href, clone])
    const repository = new GitRepository(clone, backend === 'native' ? 'git' : join(root, 'no-git')), signal = new AbortController().signal
    const state = await repository.execute({ action: 'status' }, undefined, signal)
    if (state.kind !== 'state') throw new Error('state')
    const result = await repository.execute({ action: 'lineHistory', text: source(3), target: { path: 'main.ts', start: 1, end: 4 }, version: state.state.version }, undefined, signal)
    if (result.kind !== 'lineHistory') throw new Error('history')
    assert.equal(result.history.entries.length, 1)
    assert.deepEqual(result.history.warnings, ['missing'])
  })
}

test('历史请求在入口拒绝非法路径、范围和额外字段', () => {
  const base = { action: 'lineHistory', text: 'a', target: { path: 'main.ts', start: 1, end: 1 }, version: 'a'.repeat(64) }
  assert.equal(gitRequestSchema.safeParse(base).success, true)
  for (const path of ['../a', '.git/config', '/a', 'C:/a', 'x\\y']) assert.equal(gitRequestSchema.safeParse({ ...base, target: { ...base.target, path } }).success, false)
  for (const range of [{ start: 0, end: 1 }, { start: 2, end: 1 }, { start: 1.5, end: 2 }]) assert.equal(gitRequestSchema.safeParse({ ...base, target: { path: 'main.ts', ...range } }).success, false)
  assert.equal(gitRequestSchema.safeParse({ ...base, target: { ...base.target, extra: true } }).success, false)
  assert.equal(gitRequestSchema.safeParse({ ...base, extra: true }).success, false)
})

test('追踪中取消时不继续读取父提交，权限错误不能被当成历史缺失', async () => {
  const abort = new AbortController(), oid = 'a'.repeat(40), target = { path: 'main.ts', start: 1, end: 4 }
  let commits = 0
  const reader = {
    file: async () => ({ oid, mode: 0o100644, content: async () => Buffer.from(source(0)) }),
    commit: async () => { commits++; abort.abort(new Error('stopped')); return { oid, parent: ['b'.repeat(40)], message: '', author: '', timestamp: 0 } },
    deleted: async () => [],
  }
  await assert.rejects(lineHistory(reader, oid, { action: 'lineHistory', text: source(0), target, version: 'a'.repeat(64) }, abort.signal), /stopped/)
  assert.equal(commits, 1)
  await assert.rejects(lineHistory({ ...reader, file: async () => { throw new Error('permission denied') } }, oid, { action: 'lineHistory', text: source(0), target, version: 'a'.repeat(64) }, new AbortController().signal), /permission denied/)
})
