import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze, SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'

const source = (count: number) => Array.from({ length: count }, (_, i) => `class Entry${i} {\n/** 执行任务 ${i}。 */\nexecute(value: number): number { return value; }\n}`).join('\n')

test('同名方法的说明按请求顺序保留全部位置、类型与对应文档', async () => {
  const index = new SymbolIndex(), text = source(1200)
  await index.change('sample.ts', text)
  const items = index.candidates('sample.ts', 'execute'), expected = await analyze('sample.ts', text)
  assert.equal(items.length, 1200)
  assert.deepEqual(await index.describe(items), expected.symbols.filter(item => item.name === 'execute'))
  const ordered = [items.at(-1)!, items[0], items[600], items[0]]
  const result = await index.describe(ordered)
  assert.deepEqual(result.map(item => item.offset), ordered.map(item => item.offset))
  assert.deepEqual(result.map(item => item.documentation.description), ['执行任务 1199。', '执行任务 0。', '执行任务 600。', '执行任务 0。'])
})

test('详细说明查询不为每个同名候选重扫整个声明数组', async () => {
  const index = new SymbolIndex()
  await index.change('sample.ts', source(1200))
  const items = index.candidates('sample.ts', 'execute')
  await index.describe(items)
  const value = index.cache.get(index.files.get('sample.ts').key).value, symbols = value.symbols
  let reads = 0
  value.symbols = new Proxy(symbols, { get(target, property, receiver) { if (typeof property === 'string' && /^\d+$/.test(property)) reads++; return Reflect.get(target, property, receiver) } })
  try {
    assert.equal((await index.describe(items)).length, 1200)
    assert.ok(reads < 20000, `1200个候选读取了${reads}个声明位置`)
  } finally { value.symbols = symbols; index.clear() }
})

test('空输入、空文件、首末声明和不匹配名称或偏移不会返回邻近声明', async () => {
  const index = new SymbolIndex(), text = 'const first = 1;\nconst last = 2;'
  await index.change('sample.ts', text); await index.change('empty.ts', '')
  const items = index.declarations('sample.ts'), first = items[0], last = items.at(-1)!
  assert.equal(first.offset, 6)
  assert.deepEqual(await index.describe([]), [])
  for (const wrong of [
    { ...first, offset: -1 }, { ...last, offset: text.length + 1 }, { ...first, offset: first.offset + 1 },
    { ...first, name: 'last' }, { ...first, file: 'empty.ts' }, { ...first, file: 'missing.ts' },
  ]) assert.deepEqual(await index.describe([wrong]), [])
  assert.deepEqual((await index.describe([last, first])).map(item => item.name), ['last', 'first'])
  await index.change('zero.py', 'first = 1\nlast = 2')
  const zero = index.candidates('zero.py', 'first')[0]
  assert.equal(zero.offset, 0)
  assert.equal((await index.describe([zero]))[0].declaration, 'first = 1')
})

test('共享内容、多文件和零缓存的说明保持真实文件名及请求顺序', async () => {
  for (const cacheBytes of [0, Infinity]) {
    const text = source(20), index = new SymbolIndex(undefined, { cacheBytes, read: async () => text })
    await index.change('a.ts', text); await index.change('b.ts', text)
    const items = index.candidates('caller.ts', 'execute'), requested = [items.at(-1)!, items[0], items[10], items.at(-1)!]
    const result = await index.describe(requested)
    assert.deepEqual(result.map(item => [item.file, item.offset]), requested.map(item => [item.file, item.offset]))
    assert.match(result[0].documentation.description, /执行任务 19/)
    if (cacheBytes === 0) assert.equal(index.cacheSize, 0)
    index.clear()
  }
})

test('源码修改及删除清空后不返回已经不存在的偏移，取消与读取错误继续暴露', async () => {
  let text = 'const first = 1;\nconst last = 2;', missing = false
  const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async () => { if (missing) throw new Error('READ_FAILED'); return text } })
  await index.change('sample.ts', text)
  const old = index.candidates('sample.ts', 'last')[0]
  text = 'const moved = 1;'; await index.change('sample.ts', text)
  assert.deepEqual(await index.describe([old]), [])
  const current = index.candidates('sample.ts', 'moved'), abort = new AbortController(); abort.abort()
  await assert.rejects(index.describe(current, abort.signal), { name: 'AbortError' })
  missing = true; await assert.rejects(index.describe(current), /READ_FAILED/); missing = false
  index.remove('sample.ts'); assert.deepEqual(await index.describe(current), [])
  await index.change('sample.ts', text); index.clear(); assert.deepEqual(await index.describe(current), [])
})
