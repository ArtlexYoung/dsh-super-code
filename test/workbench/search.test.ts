import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles, MAX_FILE_BYTES } from '../../src/workbench/files.js'
import { searchProject } from '../../src/workbench/search.js'
import { literalMatches, locationBatches, searchMatches, searchPathFilter } from '../../src/workbench/search-query.js'
import { validationRoot } from '../validation-root.js'

test('全局替换使用字面文本，保留正则符号、中文、换行及大小写的准确偏移', () => {
  assert.deepEqual([...literalMatches('A.$甲\nA.$', 'a.$', false)], [{ from: 0, to: 3 }, { from: 5, to: 8 }])
  assert.deepEqual([...literalMatches('😀Foo\r\nfoo', 'Foo', true)], [{ from: 2, to: 5 }])
  assert.deepEqual([...literalMatches('a\nb', '\nb', true)], [{ from: 1, to: 3 }])
  assert.deepEqual([...literalMatches('anything', '', false)], [])
})

test('全局替换遍历超过2000个文本文件，不借有限索引，明确统计二进制和大文件', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-project-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  for (let i = 0; i < 2005; i += 50) await Promise.all(Array.from({ length: Math.min(50, 2005 - i) }, (_, index) => writeFile(join(root, `file${i + index}.txt`), 'hello 项目')))
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules/skip.txt'), 'hello')
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2])); await writeFile(join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1))
  const signal = new AbortController().signal, matches = []
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: 'HELLO', replace: '你好', caseSensitive: false }, signal)) matches.push(event)
  assert.equal(matches.filter(event => event.kind === 'file').length, 2005)
  assert.deepEqual(matches.at(-1), { kind: 'done', scanned: 2005, skipped: 2 })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: 'hello', replace: '', caseSensitive: true }, abort.signal)) {} })
  await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: '', replace: '', caseSensitive: true }, signal)) {} })
})

test('全局替换跳过任意名称的Python虚拟环境，包含嵌套目录但保留普通文本', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-environment-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const path of ['environment', 'tools/custom-runtime', 'source']) {
    await mkdir(join(root, path, 'nested'), { recursive: true })
    if (path !== 'source') await writeFile(join(root, path, 'pyvenv.cfg'), 'home=demo')
    await writeFile(join(root, path, 'dependency.py'), 'needle=1')
    await writeFile(join(root, path, 'nested/dependency.py'), 'needle=2')
  }
  await writeFile(join(root, 'notes.txt'), 'needle')
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), paths: string[] = []
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'demo', { search: 'needle', replace: '', caseSensitive: true }, new AbortController().signal)) {
    if (event.kind === 'file') paths.push(event.path)
    else assert.deepEqual(event, { kind: 'done', scanned: 3, skipped: 0 })
  }
  assert.deepEqual(paths.sort(), ['notes.txt', 'source/dependency.py', 'source/nested/dependency.py'])
})

test('项目位置查询与替换覆盖相同文本范围，分批返回超过500处匹配且每个文件只读取一次', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-locations-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const name of ['main.ts', 'notes.txt', 'Dockerfile']) await writeFile(join(root, name), 'needle\n'.repeat(name === 'Dockerfile' ? 650 : 1))
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), read = files.read.bind(files), reads = new Map<string, number>()
  files.read = async (id, path, signal) => { reads.set(path, (reads.get(path) || 0) + 1); return read(id, path, signal) }
  const query = { search: 'needle', replace: '', caseSensitive: true }, positions: any[] = [], preview: string[] = []
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'demo', { ...query, locations: true }, new AbortController().signal)) positions.push(event)
  assert.equal(positions.filter(event => event.kind === 'matches').reduce((n, event) => n + event.matches.length, 0), 652)
  assert(positions.filter(event => event.kind === 'matches').every(event => event.matches.length <= 256))
  assert.deepEqual([...reads.values()], [1, 1, 1])
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'demo', query, new AbortController().signal)) if (event.kind === 'file') preview.push(event.path)
  assert.deepEqual([...new Set(positions.filter(event => event.kind === 'matches').map(event => event.path))].sort(), preview.sort())
  assert.deepEqual(positions.at(-1), { kind: 'done', scanned: 3, skipped: 0 })
})

test('位置查询保留UTF-16列、CRLF与跨行长度，长行只返回匹配附近片段', () => {
  const text = '😀甲\r\nfoo\rbar\n' + 'x'.repeat(10000) + 'needle'
  assert.deepEqual([...locationBatches(text, '甲\r\nfoo', true)].flat(), [{ line: 0, character: 2, length: 5, lineText: '😀甲' }])
  assert.deepEqual([...locationBatches(text, 'bar', true)].flat(), [{ line: 2, character: 0, length: 3, lineText: 'bar' }])
  const last = [...locationBatches(text, 'needle', true)].flat()[0]!
  assert.equal(last.line, 3); assert.equal(last.character, 10000); assert(last.lineText.includes('needle')); assert(last.lineText.length <= 240)
  assert.deepEqual([...locationBatches('', 'needle', false)], [])
  assert.deepEqual([...locationBatches('anything', '', false)], [])
})

test('位置查询不能用缓冲清单绕过排除或文本校验，失败与取消不返回完成', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-locations-boundary-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'notes.txt'), 'disk only')
  await writeFile(join(root, 'many.txt'), 'needle\n'.repeat(650))
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules/hidden.txt'), 'needle')
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2])); await writeFile(join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1))
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), query = { search: 'needle', replace: '', caseSensitive: true, locations: true, buffers: ['notes.txt', 'node_modules/hidden.txt', 'binary', 'large'] }, events: any[] = []
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'demo', query, new AbortController().signal)) events.push(event)
  assert.deepEqual(events.filter(event => event.kind === 'matches' && !event.matches.length).map(event => event.path), ['notes.txt'])
  assert.deepEqual(events.at(-1), { kind: 'done', scanned: 2, skipped: 2 })
  for (const invalid of [{ ...query, locations: 'yes' }, { ...query, buffers: ['../outside'] }, { ...query, unknown: true }]) {
    await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'demo', invalid, new AbortController().signal)) {} })
  }
  const abort = new AbortController(), stream = searchProject(ctx.fs, files, { cwd: root }, 'demo', { ...query, buffers: [] }, abort.signal)
  const first = await stream.next(); assert.equal(first.value?.kind, 'matches'); abort.abort(); await assert.rejects(stream.next(), { name: 'AbortError' })
  files.read = async () => { throw new Error('ACCESS_DENIED') }
  await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'demo', query, new AbortController().signal)) {} }, /ACCESS_DENIED/)
})

test('重复搜索用文件版本过滤不可能命中的文本，修改后重新读取且不漏新增匹配', async t => {
  await mkdir(validationRoot, {recursive:true});const root=await mkdtemp(join(validationRoot,'search-filter-'))
  const ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd:root})
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
  await writeFile(join(root,'first.txt'),'needle-first');await writeFile(join(root,'last.txt'),'needle-last')
  const files=new WorkbenchFiles(ctx.fs,async()=>({cwd:root})),read=files.read.bind(files),reads:string[]=[]
  files.read=async(...args)=>{reads.push(args[1]);return read(...args)}
  const run=async(query:string)=>{const rows:any[]=[];for await(const event of searchProject(ctx.fs,files,{cwd:root},'demo',{search:query,replace:'',caseSensitive:true,locations:true},new AbortController().signal))rows.push(event);return rows}
  await run('needle-first');reads.length=0
  const second=await run('needle-last')
  assert.deepEqual(reads,['last.txt'])
  assert.deepEqual(second.at(-1),{kind:'done',scanned:2,skipped:0})
  await writeFile(join(root,'first.txt'),'new needle-last');reads.length=0
  assert.equal((await run('needle-last')).filter(event=>event.kind==='matches').length,2)
  assert.deepEqual(reads.sort(),['first.txt','last.txt'])
})

test('索引版本不可用时完整读取，Unicode与短查询不被过滤', async t => {
  await mkdir(validationRoot,{recursive:true});const root=await mkdtemp(join(validationRoot,'search-no-version-'))
  const ctx=new Context();await ctx.plugin(LocalFileSystem,{cwd:root})
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
  await writeFile(join(root,'sample.txt'),'甲乙 ſK S k ab')
  const files=new WorkbenchFiles(ctx.fs,async()=>({cwd:root})),list=ctx.fs.listDir.bind(ctx.fs),read=files.read.bind(files)
  let reads=0;files.read=async(...args)=>{reads++;return read(...args)}
  ctx.fs.listDir=async(...args)=>(await list(...args)).map(entry=>({...entry,version:undefined}))
  for(const query of ['xyz','甲','ſ','ab']){
    const events:any[]=[];for await(const event of searchProject(ctx.fs,files,{cwd:root},'demo',{search:query,replace:'',caseSensitive:false,locations:true},new AbortController().signal))events.push(event)
    assert.equal(events.filter(event=>event.kind==='matches').length,query==='xyz'?0:1)
  }
  assert.equal(reads,4)
})

test('全词和正则支持Unicode词边界、跨行、零长度和非法表达式', () => {
  const query = { search: 'foo', caseSensitive: false, wholeWord: true }
  assert.deepEqual([...searchMatches('Foo food _foo foo甲 foo', query)].map(match => match.index), [0, 19])
  assert.deepEqual([...locationBatches('id=12\r\nid=34', '^id=(\\d+)$', true, { regexp: true })].flat().map(item => [item.line, item.character, item.length]), [[0, 0, 5], [1, 0, 5]])
  assert.deepEqual([...searchMatches('😀a', { search: '(?=.)', caseSensitive: true, regexp: true })].map(match => match.index), [0, 2])
  assert.throws(() => [...searchMatches('a', { search: '[', caseSensitive: true, regexp: true })], /WORKBENCH_SEARCH_REGEXP/)
})

test('目录及包含排除规则支持多规则、任意深度和根目录文件，按路径区分大小写', () => {
  const filter = searchPathFilter({ directory: 'src', include: '*.ts, **/*.tsx', exclude: '**/*.test.ts\ngenerated' })
  assert.deepEqual(['src/main.ts', 'src/ui/view.tsx', 'src/main.test.ts', 'src/generated/code.ts', 'other/src/main.ts', 'src/data.json'].filter(filter.file), ['src/main.ts', 'src/ui/view.tsx'])
  assert.equal(searchPathFilter({ include: '**/*.ts' }).file('root.ts'), true)
  assert.equal(searchPathFilter({ include: 'a?.ts' }).file('dir/ab.ts'), true)
  assert.equal(searchPathFilter({ include: 'a?.ts' }).file('dir/abc.ts'), false)
  assert.equal(searchPathFilter({ directory: 'Src' }).file('src/main.ts'), false)
  assert.throws(() => searchPathFilter({ include: '../outside' }), /WORKBENCH_SEARCH_SCOPE/)
})

test('真实磁盘：范围与正则在查找和替换预览中一致，缓存不能把正则当字面文本过滤', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-options-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  for (const path of ['src/main.ts', 'src/nested/main.ts', 'src/skip.test.ts', 'src/info.txt', 'outside.ts']) {
    await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), 'Token12 token34 tokenLong')
  }
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root })), signal = new AbortController().signal
  const query = { search: 'token', replace: 'new', caseSensitive: false }
  for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'demo', query, signal)) {}
  for (const locations of [true, false]) {
    const paths = []
    for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'demo', { ...query, search: 'token\\d+', regexp: true, wholeWord: true, directory: 'src', include: '*.ts', exclude: '*.test.ts', locations }, signal)) {
      if (event.kind !== 'done') { paths.push(event.path); assert.equal(event.kind === 'file' ? event.count : event.matches.length, 2) }
      else assert.deepEqual(event, { kind: 'done', scanned: 2, skipped: 0 })
    }
    assert.deepEqual(paths.sort(), ['src/main.ts', 'src/nested/main.ts'])
  }
  for (const invalid of [{ regexp: true, search: '[' }, { directory: '../outside' }, { include: '../outside' }]) {
    await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'demo', { ...query, ...invalid }, signal)) {} })
  }
})
