import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { library } from '../../../src/workbench/git/library.js'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { mapRange } from '../../../src/workbench/git/history-range.js'
import { validationRoot } from '../../validation-root.js'

const author = { name: 'Developer', email: 'developer@example.invalid' }
const functionText = (value: number) => `function compute(input) {\n  return input + ${value}\n}\n`

test('行范围映射排除前方插行，保留改动、删除与函数移动', () => {
  const code = functionText(1)
  assert.deepEqual(mapRange(code, '// heading\n' + code, { start: 2, end: 4 }), { range: { start: 1, end: 3 }, changed: false, ambiguous: false })
  assert.equal(mapRange(code, functionText(2), { start: 1, end: 3 }).changed, true)
  const other = 'function other() {\n  return 10\n}\n'
  assert.deepEqual(mapRange(code + other, other + code, { start: 4, end: 6 }).range, { start: 1, end: 3 })
  assert.equal(mapRange('', code, { start: 1, end: 3 }).range, null)
  assert.equal(mapRange(code, code + code, { start: 4, end: 6 }).range, null)
})

for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：函数历史超过30次，追踪改名、移动和未保存缓冲，只读且按需对比`, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, 'git-line-history-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const options = { fs, dir: root }, signal = new AbortController().signal
    await library.git.init({ ...options, defaultBranch: 'main' })
    const commits: string[] = []
    let file = '旧 文件.ts', text = ''
    async function commit(message: string, content: string) {
      await fs.writeFile(join(root, file), content)
      await library.git.add({ ...options, filepath: file })
      const oid = await library.git.commit({ ...options, message, author })
      commits.push(oid); text = content; return oid
    }
    for (let i = 0; i < 35; i++) await commit(`function ${i}`, functionText(i))
    const changed = commits.at(-1)!
    await commit('unrelated heading', '// heading\n' + text)
    const old = file; file = '新 [文件].ts'
    await fs.rename(join(root, old), join(root, file)); await library.git.remove({ ...options, filepath: old })
    const renamed = await commit('rename file', text)
    const other = 'function other() {\n  return 100\n}\n'
    await commit('append other', text + other)
    const moved = await commit('move function', '// heading\n' + other + functionText(34))
    const repository = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'missing-git'), argv => argv)
    const policy = { mode: 'read-only' as const, workspaceRoot: root }
    const run = (input: object) => repository.execute(input, policy, signal)
    const state = await run({ action: 'status' }); assert.equal(state.kind, 'state')
    if (state.kind !== 'state') throw new Error('state')
    const index = await fs.readFile(join(root, '.git/index'))
    const content = '// unsaved heading\n' + text
    const result = await run({ action: 'lineHistory', target: { path: file, start: 6, end: 8 }, text: content, version: state.state.version })
    assert.equal(result.kind, 'lineHistory'); if (result.kind !== 'lineHistory') throw new Error('history')
    assert.equal(result.history.entries.length, 37)
    assert.equal(result.history.uncommitted, false)
    assert.deepEqual(result.history.warnings, [])
    assert.deepEqual(new Set(result.history.entries.map(entry => entry.oid)), new Set([...commits.slice(0, 35), renamed, moved]))
    const entry = result.history.entries.find(entry => entry.oid === changed)!
    const { oid, parent, before, after } = entry
    const diff = await run({ action: 'lineHistoryDiff', entry: { oid, parent, before, after }, version: state.state.version })
    assert.equal(diff.kind, 'diff'); if (diff.kind !== 'diff') throw new Error('diff')
    assert.equal(diff.diff.before, functionText(33)); assert.equal(diff.diff.after, functionText(34))
    assert.equal(diff.diff.beforeStart, 1); assert.equal(diff.diff.afterStart, 1)
    assert.deepEqual(await fs.readFile(join(root, '.git/index')), index)
    assert.equal(await fs.readFile(join(root, file), 'utf8'), text)
  })
}
