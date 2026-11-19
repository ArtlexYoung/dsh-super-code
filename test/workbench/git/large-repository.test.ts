import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { GitRepository } from '../../../src/workbench/git/repository.js'
import { gitRequestSchema } from '../../../src/workbench/git/request.js'
import { validationRoot } from '../../validation-root.js'

const count = 2107
const paths = Array.from({ length: count }, (_, index) => `changes/file-${String(index).padStart(5, '0')}.txt`)
const author = { name: 'Developer', email: 'developer@example.invalid' }

test('批量路径不设文件数上限，仍拒绝重复或越界路径', () => {
  const request = { action: 'stage', paths, version: 'a'.repeat(64) }
  assert.equal(gitRequestSchema.safeParse(request).success, true)
  assert.equal(gitRequestSchema.safeParse({ ...request, action: 'unstage' }).success, true)
  assert.equal(gitRequestSchema.safeParse({ ...request, paths: [...paths, paths[0]] }).success, false)
  assert.equal(gitRequestSchema.safeParse({ ...request, paths: [...paths, '../outside'] }).success, false)
})

for (const backend of ['native', 'builtin'] as const) {
  test(`${backend}：完整读取、暂存、取消暂存和查看超过 2,000 文件的提交`, { timeout: 120000 }, async t => {
    await fs.mkdir(validationRoot, { recursive: true })
    const root = await fs.mkdtemp(join(validationRoot, `git-large-${backend}-`))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const repo = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'no-git'))
    const signal = new AbortController().signal
    const request = (input: unknown) => repo.execute(input, undefined, signal)
    const state = async (input: unknown) => {
      const result = await request(input)
      if (result.kind !== 'state') throw new Error('Expected state')
      return result.state
    }
    await state({ action: 'init', branch: 'main' })
    await fs.mkdir(join(root, 'changes'))
    for (let offset = 0; offset < paths.length; offset += 100) {
      await Promise.all(paths.slice(offset, offset + 100).map(path => fs.writeFile(join(root, path), 'base\n')))
    }
    let current = await state({ action: 'status' })
    assert.equal(current.backend, backend)
    assert.deepEqual(current.changes.map(file => file.path).sort(), paths)
    current = await state({ action: 'stage', paths, version: current.version })
    assert.equal(current.changes.filter(file => file.head !== file.stage).length, count)
    current = await state({ action: 'unstage', paths, version: current.version })
    assert.equal(current.changes.filter(file => file.head !== file.stage).length, 0)
    assert.equal(current.changes.length, count)
    current = await state({ action: 'stage', paths, version: current.version })
    current = await state({ action: 'commit', message: 'many files', author, version: current.version })
    assert.equal(current.changes.length, 0)
    const history = await request({ action: 'commitFiles', oid: current.head, version: current.version })
    assert.equal(history.kind, 'commitFiles')
    if (history.kind !== 'commitFiles') throw new Error('Expected commit files')
    assert.deepEqual(history.files.sort(), paths)
    const diff = await request({ action: 'historyDiff', oid: current.head, path: paths.at(-1), version: current.version })
    assert.equal(diff.kind === 'diff' && diff.diff.after, 'base\n')
  })
}
