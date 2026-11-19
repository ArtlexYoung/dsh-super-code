import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles } from '../../src/workbench/files.js'
import type { WorkbenchRoot } from '../../src/workbench/files.js'
import { ProjectIndex, INDEX_BYTES } from '../../src/workbench/project-index.js'
import { textFilter } from '../../src/workbench/text-filter.js'
import { searchProject } from '../../src/workbench/search.js'
import { SymbolIndex, analyze } from '../../builtin/workbench/analysis/index.js'
import { validationRoot } from '../validation-root.js'

const signal = new AbortController().signal, cachePath = '.dsh-super-code/index/workbench-v1.json'
async function fixture(t: any) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'project-cache-')), ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const options: WorkbenchRoot = { cwd: root }
  const create = () => new WorkbenchFiles(ctx.fs, async () => options)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, ctx, options, create }
}
async function metadata(files: WorkbenchFiles, path: string) {
  const file = await files.read('demo', path), index = new SymbolIndex()
  await index.change(path, file.text)
  return { path, version: file.version, key: index.files.get(path)!.key, filter: Array.from(textFilter(file.text)),
    symbols: index.declarations(path).map(({ name, offset, line, character, kind }: any) => ({ name, offset, line, character, kind })) }
}

test('冷启动复用版本与精简符号，不落盘源码；详细文档仍按需解析', async t => {
  const { root, create } = await fixture(t), files = create()
  const text = '/** 私有说明不能写入缓存。 */\nexport function execute(input: string) { return input + "private-source-body"; }\nexecute("a");\n'
  await writeFile(join(root, 'main.ts'), text)
  const value = await metadata(files, 'main.ts')
  assert.deepEqual(await files.storeIndex('demo', [value], signal), { persisted: true })
  const stored = await readFile(join(root, cachePath), 'utf8')
  assert.doesNotMatch(stored, /private-source-body|私有说明|function execute|input: string/)
  assert.ok(Buffer.byteLength(stored) < INDEX_BYTES)
  assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), text)
  const cold = create(), listing = await cold.project('demo', signal)
  assert.deepEqual(listing.files, ['main.ts'])
  assert.deepEqual(listing.cached?.['main.ts'], value)
  let calls = 0
  const index = new SymbolIndex(async (...args: any[]) => { calls++; return analyze(...args) }, { read: async () => text })
  index.restore('main.ts', listing.cached!['main.ts'])
  assert.equal(calls, 0)
  assert.equal(index.candidates('main.ts', 'execute').length, 1)
  const result = await index.describe(index.candidates('main.ts', 'execute'))
  assert.match(result[0]!.documentation.description, /私有说明/)
  assert.equal(calls, 1)
  await writeFile(join(root, 'main.ts'), 'export const changed = 1')
  assert.equal((await create().project('demo', signal)).cached, undefined)
})

test('重启后搜索跳过未变文件，新增、删除与外部修改即时生效，不搜索索引自身', async t => {
  const { root, ctx, options, create } = await fixture(t)
  await writeFile(join(root, 'a.txt'), 'alpha-target')
  await writeFile(join(root, 'b.txt'), 'beta-target')
  const collect = async (files: WorkbenchFiles, search: string) => Array.fromAsync(searchProject(ctx.fs, files, options, 'demo', { search, replace: '', caseSensitive: true, locations: true }, signal))
  await collect(create(), 'alpha-target')
  const cold = create(), reads: string[] = [], original = cold.read.bind(cold)
  cold.read = async (...args) => { reads.push(args[1]); return original(...args) }
  assert.equal((await collect(cold, 'beta-target')).filter(event => event.kind === 'matches').length, 1)
  assert.deepEqual(reads, ['b.txt'])
  const before = await stat(join(root, cachePath)); await collect(cold, 'beta-target')
  assert.equal((await stat(join(root, cachePath))).mtimeMs, before.mtimeMs, '无变化搜索不能反复重写缓存')
  await writeFile(join(root, 'a.txt'), 'new beta-target')
  await rm(join(root, 'b.txt')); await writeFile(join(root, 'c.txt'), 'beta-target')
  const result = await collect(create(), 'beta-target')
  assert.deepEqual(result.filter(event => event.kind === 'matches').map(event => event.path).sort(), ['a.txt', 'c.txt'])
  assert.deepEqual(result.at(-1), { kind: 'done', scanned: 2, skipped: 0 })
  assert.ok(!JSON.parse(await readFile(join(root, cachePath), 'utf8')).entries.some((entry: any) => entry.path === 'b.txt'))
})

for (const contents of ['user-owned-file', '{"owner":"dsh-super-code-workbench","format":999,"entries":[]}', '{broken']) test('未知或损坏缓存不覆盖用户内容：' + contents.slice(0, 20), async t => {
  const { root, create } = await fixture(t)
  await mkdir(join(root, '.dsh-super-code/index'), { recursive: true }); await writeFile(join(root, cachePath), contents)
  await writeFile(join(root, 'main.ts'), 'export const value = 1')
  const files = create()
  assert.deepEqual(await files.storeIndex('demo', [await metadata(files, 'main.ts')], signal), { persisted: false })
  assert.equal((await files.project('demo', signal)).files.length, 1)
  assert.equal(await readFile(join(root, cachePath), 'utf8'), contents)
})

test('只读和不可写时使用临时索引；文件占用缓存目录、越界链接不影响源码', async t => {
  const { root, options, create } = await fixture(t)
  await writeFile(join(root, 'main.ts'), 'export const value = 1')
  const files = create(), value = await metadata(files, 'main.ts')
  options.policy = { mode: 'read-only', workspaceRoot: root }
  assert.equal((await files.storeIndex('demo', [value], signal)).persisted, false)
  await assert.rejects(stat(join(root, '.dsh-super-code')), { code: 'ENOENT' })
  assert.equal((await files.project('demo', signal)).cached?.['main.ts']?.key, value.key)
  options.policy = undefined
  await writeFile(join(root, '.dsh-super-code'), 'user data')
  assert.equal((await create().storeIndex('demo', [value], signal)).persisted, false)
  assert.equal(await readFile(join(root, '.dsh-super-code'), 'utf8'), 'user data')
  await rm(join(root, '.dsh-super-code'))
  const outside = await mkdtemp(join(validationRoot, 'cache-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(root, '.dsh-super-code'))
  assert.equal((await create().storeIndex('demo', [value], signal)).persisted, false)
  await assert.rejects(stat(join(outside, 'index')), { code: 'ENOENT' })
})

test('缓存请求拒绝源码、非法路径及位置；晚到的旧版本不能覆盖新符号', async t => {
  const { root, create } = await fixture(t), files = create()
  await writeFile(join(root, 'main.ts'), 'export const value = 1')
  const value = await metadata(files, 'main.ts')
  for (const invalid of [{ ...value, text: 'source' }, { ...value, path: '../outside' }, { ...value, path: '/absolute' }, { ...value, path: '.dsh-super-code/index/self.ts' }, { ...value, symbols: [{ ...value.symbols[0], offset: -1 }] }, { ...value, key: undefined }]) {
    await assert.rejects(files.storeIndex('demo', [invalid], signal))
  }
  await writeFile(join(root, 'main.ts'), 'export const updated = 2')
  const latest = await metadata(files, 'main.ts')
  await Promise.all([files.storeIndex('demo', [latest], signal), files.storeIndex('demo', [value], signal)])
  assert.deepEqual((await create().project('demo', signal)).cached?.['main.ts']?.symbols.map(item => item.name), ['updated'])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(files.storeIndex('demo', [latest], abort.signal), { name: 'AbortError' })
})

test('容量预算淘汰缓存但不截断项目；并发写入结果可冷启动读取', async t => {
  const { root, ctx, options } = await fixture(t), index = await ProjectIndex.open(ctx.fs, options, signal)
  const filter = Array<number>(64).fill(0xffffffff)
  for (let i = 0; i < 5000; i++) index.set({ path: `${'x'.repeat(3500)}${i}.ts`, version: 'v1', filter })
  assert.equal(index.get('x'.repeat(3500) + '0.ts', 'v1'), undefined)
  assert.ok(index.get('x'.repeat(3500) + '4999.ts', 'v1'))
  await Promise.all([index.flush(options, signal), index.flush(options, signal)])
  assert.ok((await stat(join(root, cachePath))).size <= INDEX_BYTES)
  const cold = await ProjectIndex.open(ctx.fs, options, signal)
  assert.ok(cold.get('x'.repeat(3500) + '4999.ts', 'v1'))
})

test('远程文件系统使用远端目标和原子写入，不把项目地址当成本机路径', async t => {
  const { root, ctx, create } = await fixture(t)
  await writeFile(join(root, 'main.ts'), 'export const remoteValue = 1')
  const value = await metadata(create(), 'main.ts'), writes: string[] = []
  const remoteRoot = 'ssh://fixture/workspace'
  const remote = Object.create(ctx.fs)
  remote.resolve = (path: string, options: any = {}) => ctx.fs.resolve(path === remoteRoot ? root : path, { ...options, cwd: options.cwd === remoteRoot ? root : options.cwd })
  remote.processPath = () => remoteRoot
  remote.writeText = async (...args: any[]) => { writes.push(args[0].targetKey); return ctx.fs.writeText(...args) }
  const options = { cwd: remoteRoot }, index = await ProjectIndex.open(remote, options, signal)
  index.set(value)
  assert.equal(await index.flush(options, signal), true)
  assert.deepEqual(writes, [join(root, cachePath)])
  assert.deepEqual((await ProjectIndex.open(remote, options, signal)).get('main.ts', value.version), value)
})

test('写入失败和取消不破坏旧缓存，另一宿主写入不被覆盖', async t => {
  const { root, ctx, options, create } = await fixture(t)
  await writeFile(join(root, 'main.ts'), 'export const value = 1')
  const value = await metadata(create(), 'main.ts'), first = await ProjectIndex.open(ctx.fs, options, signal), second = await ProjectIndex.open(ctx.fs, options, signal)
  first.set(value); second.set({ ...value, symbols: [] })
  assert.equal(await first.flush(options, signal), true)
  const before = await readFile(join(root, cachePath), 'utf8')
  assert.equal(await second.flush(options, signal), false)
  assert.equal(await readFile(join(root, cachePath), 'utf8'), before)
  const writing = ctx.fs.writeText.bind(ctx.fs)
  ctx.fs.writeText = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
  first.set({ ...value, symbols: [] })
  assert.equal(await first.flush(options, signal), false)
  ctx.fs.writeText = writing
  assert.equal(await readFile(join(root, cachePath), 'utf8'), before)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(first.flush(options, abort.signal), { name: 'AbortError' })
  assert.equal(await readFile(join(root, cachePath), 'utf8'), before)
  assert.equal(await first.flush(options, signal), true)
})

test('校验和不符和其他项目的缓存均不复用，仍可完整搜索', async t => {
  const { root, ctx, options, create } = await fixture(t)
  await writeFile(join(root, 'main.ts'), 'export const value = 1')
  const files = create(), value = await metadata(files, 'main.ts')
  await files.storeIndex('demo', [value], signal)
  const original = await readFile(join(root, cachePath), 'utf8'), altered = JSON.parse(original)
  altered.entries[0].filter.fill(0)
  await writeFile(join(root, cachePath), JSON.stringify(altered))
  assert.equal((await create().project('demo', signal)).cached, undefined)
  const result = await Array.fromAsync(searchProject(ctx.fs, create(), options, 'demo', { search: 'value', replace: '', caseSensitive: true }, signal))
  assert.equal(result.filter(event => event.kind === 'file').length, 1)
  const other = await mkdtemp(join(validationRoot, 'other-cache-'))
  t.after(() => rm(other, { recursive: true, force: true }))
  await mkdir(join(other, '.dsh-super-code/index'), { recursive: true }); await writeFile(join(other, cachePath), original)
  assert.equal((await ProjectIndex.open(ctx.fs, { cwd: other }, signal)).get('main.ts', value.version), undefined)
})
