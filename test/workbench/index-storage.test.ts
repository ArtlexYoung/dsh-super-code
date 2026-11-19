import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { GitRepository } from '../../src/workbench/git/repository.js'
import { WorkbenchFiles } from '../../src/workbench/files.js'
import { SymbolIndex } from '../../builtin/workbench/analysis/index.js'
import { validationRoot } from '../validation-root.js'

async function footprint(root: string): Promise<Record<string, object>> {
  const result: Record<string, object> = {}
  async function walk(path: string): Promise<void> {
    const full = join(root, path), stat = await fs.lstat(full)
    result[path] = { size: stat.size, mtime: stat.mtimeMs,
      ...(stat.isFile() ? { sha256: createHash('sha256').update(await fs.readFile(full)).digest('hex') } : {}) }
    if (stat.isDirectory()) for (const name of await fs.readdir(full)) await walk(path ? `${path}/${name}` : name)
  }
  await walk('')
  return result
}

for (const backend of ['native', 'builtin'] as const) test(`${backend}：重复源码、状态、统计和差异读取不写入项目或 Git 索引`, async t => {
  await fs.mkdir(validationRoot, { recursive: true })
  const root = await fs.mkdtemp(join(validationRoot, `index-storage-${backend}-`)), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await fs.rm(root, { recursive: true, force: true }) })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  const git = new GitRepository(root, backend === 'native' ? 'git' : join(root, 'not-installed-git'))
  const signal = new AbortController().signal
  const request = (input: unknown) => git.execute(input, undefined, signal)
  const state = async () => { const result = await request({ action: 'status' }); if (result.kind !== 'state') throw new Error('Expected state'); return result.state }
  await request({ action: 'init', branch: 'main' })
  for (let i = 0; i < 32; i++) await fs.writeFile(join(root, `source-${i}.ts`), `export const value${i} = ${i};\n`)
  await request({ action: 'stage', paths: (await state()).changes.map(file => file.path), version: (await state()).version })
  await request({ action: 'commit', message: 'Test fixture', author: { name: 'Test', email: 'test@example.invalid' }, version: (await state()).version })
  // 内容不变但文件元数据已变：Git 通常会尝试刷新磁盘索引的场景。
  for (let i = 0; i < 32; i++) await fs.writeFile(join(root, `source-${i}.ts`), `export const value${i} = ${i};\n`)
  await fs.writeFile(join(root, 'source-0.ts'), 'export const value0 = 100;\n')
  const before = await footprint(root), initialGitIndex = await fs.readFile(join(root, '.git/index')), index = new SymbolIndex()
  for (let iteration = 0; iteration < 5; iteration++) {
    for (const path of (await files.project('test', signal)).files) await index.change(path, (await files.read('test', path, signal)).text)
    const current = await state()
    assert.equal(current.backend, backend)
    assert.equal(current.changes.length, 1)
    await request({ action: 'stats', paths: ['source-0.ts'], version: current.version })
    const diff = await request({ action: 'diff', path: 'source-0.ts', side: 'total', version: current.version })
    assert.equal(diff.kind === 'diff' && diff.diff.after, 'export const value0 = 100;\n')
    await request({ action: 'commitFiles', oid: current.head, version: current.version })
    await request({ action: 'historyDiff', oid: current.head, path: 'source-0.ts', version: current.version })
  }
  assert.equal(index.files.size, 32)
  assert.deepEqual(await footprint(root), before)
  index.clear()
  assert.equal(index.files.size, 0)
  assert.equal(index.names.size, 0)
  // 正常暂存仍然修改真实 Git 索引，不用临时索引代替用户的暂存区。
  const staged = await request({ action: 'stage', paths: ['source-0.ts'], version: (await state()).version })
  assert.equal(staged.kind === 'state' && staged.state.changes[0]?.stage, 2)
  assert.notDeepEqual(await fs.readFile(join(root, '.git/index')), initialGitIndex)
})
