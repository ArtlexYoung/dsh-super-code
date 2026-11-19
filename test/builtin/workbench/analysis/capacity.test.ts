import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex, analyze } from '../../../../builtin/workbench/analysis/index.js'
import { textFilter, mayContain } from '../../../../builtin/workbench/analysis/text-filter.js'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'

test('大文件列举补全候选的声明访问量随数量线性增长', async () => {
  const count = 800, source = Array.from({ length: count }, (_, i) => `export const value${i} = ${i};`).join('\n')
  const index = new SymbolIndex()
  await index.change('dense.ts', source)
  const entry = index.files.get('dense.ts'), expected = index.declarations('dense.ts')
  let inspected = 0
  entry.symbols = new Proxy(entry.symbols, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) inspected++
    return Reflect.get(target, key, receiver)
  } })
  const result = index.candidates('dense.ts', 'value', false)
  assert.deepEqual(result, expected)
  assert.ok(inspected <= count * 2, `列举 ${count} 个候选不应访问 ${inspected} 个声明位置`)
})

test('补全保留最早声明及当前文件优先，精确查询保留全部同名位置', async () => {
  const index = new SymbolIndex()
  const texts = new Map([
    ['first.ts', 'function shared() {}\nfunction shared() {}\nconst local = 1;'],
    ['local.ts', 'const shared = 1;\nfunction shared() {}'],
    ['copy.ts', 'function shared() {}\nfunction shared() {}\nconst local = 1;'],
  ])
  for (const [file, text] of texts) await index.change(file, text)
  const completion = index.candidates('local.ts', 'SH', false)
  assert.equal(completion.length, 1)
  assert.equal(completion[0].file, 'local.ts')
  assert.equal(completion[0].offset, texts.get('local.ts')!.indexOf('shared'))
  assert.equal(completion[0].kind, 'variable')
  const definitions = index.candidates('local.ts', 'shared')
  assert.equal(definitions.length, 6)
  assert.equal(definitions[0].file, 'local.ts')
  assert.equal(definitions[1].file, 'local.ts')
  assert.deepEqual(definitions.filter(item => item.file === 'first.ts').map(item => item.offset), [9, 30])
  index.remove('local.ts')
  const fallback = index.candidates('caller.ts', 'sh', false)
  assert.equal(fallback[0].file, 'first.ts')
  assert.equal(fallback[0].offset, texts.get('first.ts')!.indexOf('shared'))
  index.remove('first.ts')
  assert.equal(index.candidates('caller.ts', 'sh', false)[0].file, 'copy.ts')
  await index.change('copy.ts', 'export const replaced = 1;')
  assert.equal(index.candidates('caller.ts', 'sh', false).length, 0)
  assert.equal(index.candidates('copy.ts', 'rep', false)[0].name, 'replaced')
  index.clear()
  assert.deepEqual(index.candidates('caller.ts', '', false), [])
})

test('空前缀、无匹配、语言家族和同内容副本的补全结果不截断或串用位置', async () => {
  const index = new SymbolIndex()
  for (const [file, source] of [
    ['a.ts', 'export const shared = 1;\nexport const second = 2;'],
    ['b.js', 'function shared() {}\nfunction other() {}'],
    ['c.py', 'def shared():\n    return 1\n'],
    ['d.php', '<?php function shared() { return 1; }'],
  ]) await index.change(file, source)
  const options = index.candidates('b.js', '', false)
  assert.deepEqual(options.map(item => [item.name, item.file]), [['shared', 'b.js'], ['other', 'b.js'], ['second', 'a.ts']])
  assert.deepEqual(index.candidates('c.py', 'SH', false).map(item => item.file), ['c.py'])
  assert.deepEqual(index.candidates('d.php', '$sh', false).map(item => item.file), ['d.php'])
  assert.deepEqual(index.candidates('a.ts', 'missing', false), [])
})

test('同一语言和后缀别名复用解析器，不随文件数量重复注册语言状态', async () => {
  for (const [first, next] of [['first.ts', 'next.mts'], ['first.rb', 'next.rb'], ['first.sh', 'next.bash']]) {
    const [a, b] = await Promise.all([loadLanguage(first), loadLanguage(next)])
    assert.ok(a === b, first)
  }
})

test('初始分析只传回声明和文本摘要，不往主线程复制整份源码及详细引用', async () => {
  const summary = await analyze('main.ts', 'export function total(value: number) { return value }', false)
  assert.equal(summary.text, undefined)
  assert.equal(summary.references, undefined)
  assert.equal(summary.symbols[0].name, 'total')
  assert.equal(summary.symbols[0].declaration, undefined)
})

test('紧凑位置保留长文件末尾的行列，结构文件的声明类别不丢失', async () => {
  const text = `${'\n'.repeat(70000)}${' '.repeat(70000)}export function tail() {}`
  const index = new SymbolIndex()
  await index.change('long.ts', text)
  const symbol = index.candidates('caller.ts', 'tail')[0]
  assert.equal(symbol.line, 70000)
  assert.equal(symbol.character, 70016)
  assert.equal(symbol.offset, text.indexOf('tail'))
  for (const [file, source, kind] of [['config.json', '{"key":1}', 'property'], ['style.css', '.card {}', 'selector'], ['index.html', '<section></section>', 'tag'], ['schema.sql', 'CREATE TABLE account (id INT);', 'schema']]) {
    await index.change(file, source)
    assert.equal(index.declarations(file)[0].kind, kind, file)
  }
})

test('源码缓存淘汰不删除索引，定义、用法、搜索及文档覆盖所有文件', async () => {
  const sources = new Map<string, string>(), reads: string[] = []
  const index = new SymbolIndex(undefined, { cacheBytes: 512, read: async (file: string) => { reads.push(file); return sources.get(file)! } })
  const first = '/** 返回金额。\n * @param value 输入金额\n */\nexport function total(value: number): number { return value }\n'
  sources.set('first.ts', first)
  await index.change('first.ts', first)
  for (let i = 0; i < 2205; i++) {
    const file = `source-${i}.ts`, text = `export const unique${i} = ${i};\n`
    sources.set(file, text); await index.change(file, text)
  }
  sources.set('last.ts', 'total(42); // hidden search target\n'); await index.change('last.ts', sources.get('last.ts'))
  assert.equal(index.files.size, 2207)
  assert.equal(index.files.get('first.ts').text, undefined, '常驻索引不保留整份源码')
  assert.ok(index.cacheSize <= 512)
  assert.equal(index.candidates('last.ts', 'total').length, 1)
  const details = await index.describe(index.candidates('last.ts', 'total'))
  assert.match(details[0].declaration, /value: number/)
  assert.match(details[0].documentation.description, /金额/)
  const usages = await index.navigate('first.ts', 'total', first.indexOf('total'))
  assert.ok(usages.matches.some((item: any) => item.file === 'last.ts'))
  const result = await index.search('hidden search target')
  assert.equal(result.matches[0].file, 'last.ts')
  assert.ok(reads.includes('first.ts'))
  index.clear()
  assert.equal(index.files.size, 0); assert.equal(index.cacheSize, 0)
})

test('按需搜索可取消，读取失败不能伪装为完整空结果，Unicode筛选不漏匹配', async () => {
  const sources = new Map([['first.ts', '// long ſtring Kelvin 中文 İ value\n'], ['second.ts', '// late result\n']])
  let missing = false
  const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async (file: string, signal?: AbortSignal) => { signal?.throwIfAborted(); if (missing) throw new Error('READ_FAILED'); return sources.get(file)! } })
  for (const [file, text] of sources) await index.change(file, text)
  for (const query of ['string', 'kelvin', '中文', 'İ', 'value']) assert.equal((await index.search(query)).matches.length, 1, query)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(index.search('anything', 500, abort.signal), { name: 'AbortError' })
  missing = true
  await assert.rejects(index.search('late'), /READ_FAILED/)
})

test('相同内容只保留一份分析元数据，移除一个文件不影响其他副本', async () => {
  const text = 'export function shared(value: number): number { return value }\n', index = new SymbolIndex(undefined, { cacheBytes: 0, read: async () => text })
  for (let i = 0; i < 20000; i++) await index.change(`folder-${i}/main.ts`, text)
  assert.equal(index.files.size, 20000)
  assert.equal(index.contents.size, 1)
  assert.equal(index.files.get('folder-0/main.ts'), index.files.get('folder-19999/main.ts'))
  const completion = index.candidates('folder-19999/main.ts', 'sha', false)
  assert.equal(completion.length, 1)
  assert.equal(completion[0].file, 'folder-19999/main.ts')
  index.remove('folder-0/main.ts')
  assert.equal(index.candidates('caller.ts', 'shared').length, 19999)
  index.clear(); assert.equal(index.contents.size, 0); assert.equal(index.names.size, 0)
})

test('清空或移除后晚到的详细解析不能复活源码缓存', async () => {
  const pending = Promise.withResolvers<any>(), text = 'export function total() { return 1 }'
  const index = new SymbolIndex((file: string, value: string, detail: boolean) => detail === false ? analyze(file, value, false) : pending.promise, { cacheBytes: 0, read: async () => text })
  await index.change('main.ts', text)
  const reading = index.describe(index.candidates('main.ts', 'total'))
  await new Promise(resolve => setImmediate(resolve))
  index.clear(); pending.resolve(await analyze('main.ts', text))
  assert.deepEqual(await reading, [])
  assert.equal(index.files.size, 0); assert.equal(index.cacheSize, 0)
})

test('同内容的多个定义按需读取一次文档，返回各自的真实文件位置', async () => {
  const text = '/** 共享定义。 */\nexport function shared(value: number) { return value }'
  let reads = 0
  const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async () => { reads++; return text } })
  for (let i = 0; i < 8; i++) await index.change(`folder-${i}/main.ts`, text)
  const result = await index.describe(index.candidates('caller.ts', 'shared'))
  assert.equal(result.length, 8)
  assert.equal(new Set(result.map((item: any) => item.file)).size, 8)
  assert.equal(reads, 1)
})

test('读取文档期间一个副本被编辑，不能让其他副本使用它的新文档', async () => {
  const before = '/** 原始文档。 */\nexport function total() {}', after = before.replace('原始', '最新')
  const sources = new Map([['a.ts', before], ['b.ts', before]])
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
  let paused = false
  const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async (file: string) => {
    const text = sources.get(file)!
    if (!paused) { paused = true; started.resolve(); await pending.promise }
    return text
  } })
  for (const [file, text] of sources) await index.change(file, text)
  const describing = index.describe(index.candidates('caller.ts', 'total'))
  try { await started.promise; sources.set('a.ts', after); await index.change('a.ts', after) }
  finally { pending.resolve() }
  const result = await describing
  assert.match(result.find((item: any) => item.file === 'a.ts').documentation.description, /最新/)
  assert.match(result.find((item: any) => item.file === 'b.ts').documentation.description, /原始/)
})

test('文本摘要只能排除不可能匹配，所有原文子串及Unicode大小写匹配均保留', () => {
  let seed = 1837, text = ''
  for (let i = 0; i < 2000; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; text += String.fromCharCode(32 + seed % 95) }
  const filter = textFilter(text)
  for (let i = 0; i < text.length - 12; i += 7) assert.equal(mayContain(filter, text.slice(i, i + 12).toUpperCase()), true)
  for (const value of ['\u017Ftring', '\u212Aelvin', '中文', 'İ']) assert.equal(mayContain(textFilter(value), value), true)
  assert.equal(mayContain(textFilter(''), 'absent'), false)
})

test('局域网HTTP缺少WebCrypto时仍完整索引，不以不可靠哈希合并不同源码', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
  try {
    const sources = new Map([['first.ts', 'export function first() {}'], ['last.ts', 'export function last() {}']])
    const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async (file: string) => sources.get(file)! })
    for (const [file, text] of sources) await index.change(file, text)
    assert.equal(index.files.size, 2)
    assert.equal(index.candidates('other.ts', 'first')[0].file, 'first.ts')
    assert.equal(index.candidates('other.ts', 'last')[0].file, 'last.ts')
    assert.equal((await index.search('last')).matches[0].file, 'last.ts')
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else Reflect.deleteProperty(globalThis, 'crypto') }
})

test('源码缓存淘汰后读取外部修改，只更新该文件，不污染同内容副本', async () => {
  const original = '// BASE_TOKEN\nexport function total(value: number) { return value }\n'
  const sources = new Map([['a.ts', original], ['b.ts', original], ['filler.ts', '// ' + '.'.repeat(365)]])
  const index = new SymbolIndex(undefined, { cacheBytes: 800, read: async (file: string) => sources.get(file)! })
  for (const [file, text] of sources) await index.change(file, text)
  assert.equal(index.cache.has(index.files.get('a.ts').key), false)
  sources.set('a.ts', '// external change\nexport function total(value: string) { return value }\n')
  await index.describe(index.candidates('a.ts', 'total').filter((item: any) => item.file === 'a.ts'))
  assert.notEqual(index.files.get('a.ts'), index.files.get('b.ts'))
  assert.deepEqual((await index.search('BASE_TOKEN')).matches.map((item: any) => item.file), ['b.ts'])
  const details = await index.describe(index.candidates('caller.ts', 'total'))
  assert.match(details.find((item: any) => item.file === 'a.ts').declaration, /value: string/)
  assert.match(details.find((item: any) => item.file === 'b.ts').declaration, /value: number/)
})

test('按需读取期间文件被移除或请求被取消，不重新加入索引或缓存', async () => {
  for (const action of ['remove', 'abort']) {
    const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<string>(), abort = new AbortController()
    const text = 'export function total() {}'
    const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async () => { started.resolve(); return pending.promise } })
    await index.change('main.ts', text)
    const reading = index.describe(index.candidates('main.ts', 'total'), abort.signal)
    await started.promise
    if (action === 'remove') index.remove('main.ts')
    else abort.abort()
    pending.resolve(text)
    if (action === 'remove') { assert.deepEqual(await reading, []); assert.equal(index.files.has('main.ts'), false) }
    else await assert.rejects(reading, { name: 'AbortError' })
    assert.equal(index.cacheSize, 0)
  }
})

test('无 WebCrypto 时，缓存内的同文本查询保留详细解析，换行规范化不重复分析', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
  try {
    const source = '/** 返回当前任务。 */\nexport function current(value: number) { return value }\n'
    const calls: boolean[] = []
    const index = new SymbolIndex(async (file, text, detail = true) => { calls.push(detail); return analyze(file, text, detail) })
    await index.change('sample.ts', source)
    const details = () => index.describe(index.candidates('sample.ts', 'current'))
    assert.match((await details())[0].documentation.description, /当前任务/)
    const bytes = index.cacheSize
    for (const newline of ['\n', '\r\n', '\r', '\n']) {
      await index.change('sample.ts', source.replaceAll('\n', newline))
      const item = (await details())[0]
      assert.match(item.declaration, /value: number/)
      assert.match(item.documentation.description, /当前任务/)
      assert.equal(item.line, 1); assert.equal(item.offset, source.indexOf('current'))
      assert.equal(index.cacheSize, bytes)
    }
    assert.deepEqual(calls, [false, true], '同一文本只做一次元数据分析和一次按需详细分析')
    await index.change('sample.ts', source.replace('当前任务', '最新任务').replace('number', 'string'))
    const latest = (await details())[0]
    assert.match(latest.declaration, /value: string/); assert.match(latest.documentation.description, /最新任务/)
    assert.deepEqual(calls, [false, true, false, true])
    await index.change('copy.ts', source)
    assert.equal(index.files.size, 2)
    assert.equal(index.candidates('sample.ts', 'current').length, 2)
    assert.notEqual(index.files.get('copy.ts'), index.files.get('sample.ts'))
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else Reflect.deleteProperty(globalThis, 'crypto')
  }
})

test('缓存淘汰后重新检查同文本仍重新读取，不能跳过外部更新或把零缓存变为常驻源码', async () => {
  for (const cacheBytes of [500, 0]) {
    const sources = new Map([['first.ts', '/** 原始任务。 */\nexport function first() {}'], ['other.ts', '// ' + '.'.repeat(230)]])
    const reads: string[] = []
    const index = new SymbolIndex(undefined, { cacheBytes, read: async file => { reads.push(file); return sources.get(file)! } })
    await index.change('first.ts', sources.get('first.ts'))
    await index.change('other.ts', sources.get('other.ts'))
    assert.equal(index.cache.has(index.files.get('first.ts').key), false)
    sources.set('first.ts', '/** 外部更新。 */\nexport function first() {}')
    const item = (await index.describe(index.candidates('first.ts', 'first')))[0]
    assert.match(item.documentation.description, /外部更新/)
    assert.deepEqual(reads, ['first.ts'])
    assert.ok(index.cacheSize <= cacheBytes)
    index.clear(); assert.equal(index.cacheSize, 0); assert.equal(index.files.size, 0)
  }
})
