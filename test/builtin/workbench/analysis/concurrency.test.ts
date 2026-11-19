import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze, SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'

const text = 'function before() {}\nfunction after() {}\n'

test('同文件同文本的并发请求均在新声明可读后完成', async () => {
  const index = new SymbolIndex()
  await index.change('sample.ts', 'function before() {}\n')
  const observed = await Promise.all(Array.from({ length: 4 }, async () => {
    await index.change('sample.ts', text)
    return index.declarations('sample.ts').map(symbol => symbol.name)
  }))
  for (const names of observed) assert.deepEqual(names, ['before', 'after'])
})

test('换行不同但逻辑文本相同的请求共用分析，完成后不保留过期任务', async () => {
  let calls = 0
  const index = new SymbolIndex(async (file, source, detail) => { calls++; return analyze(file, source, detail) })
  await Promise.all([index.change('sample.ts', text.replaceAll('\n', '\r\n')), index.change('sample.ts', text)])
  assert.equal(calls, 1)
  await index.change('sample.ts', 'function latest() {}\n')
  assert.deepEqual(index.declarations('sample.ts').map(symbol => symbol.name), ['latest'])
  assert.equal(calls, 2)
})

test('同文本分析失败时全部调用方收到错误，随后可重新尝试', async () => {
  let calls = 0
  const index = new SymbolIndex(async (file, source, detail) => {
    if (++calls === 1) throw new Error('analysis unavailable')
    return analyze(file, source, detail)
  })
  const failed = await Promise.allSettled([index.change('sample.ts', text), index.change('sample.ts', text)])
  assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected'])
  for (const result of failed) if (result.status === 'rejected') assert.match(result.reason.message, /analysis unavailable/)
  assert.equal(calls, 1)
  await index.change('sample.ts', text)
  assert.deepEqual(index.declarations('sample.ts').map(symbol => symbol.name), ['before', 'after'])
  assert.equal(calls, 2)
})

for (const operation of ['remove', 'clear'] as const) test(`${operation} 后再次索引同文本，不复用已失效的调用`, async t => {
  let start!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { start = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  t.after(release)
  const index = new SymbolIndex(async (file, source, detail) => { start(); await gate; return analyze(file, source, detail) })
  const old = index.change('sample.ts', text)
  await started
  if (operation === 'remove') index.remove('sample.ts'); else index.clear()
  const next = index.change('sample.ts', text)
  release(); await Promise.all([old, next])
  assert.deepEqual(index.declarations('sample.ts').map(symbol => symbol.name), ['before', 'after'])
})

test('重新提交已缓存旧文本仍取消在途新版本，晚到解析不覆盖最后一次输入', async t => {
  for (const cryptoAvailable of [true, false]) await t.test(cryptoAvailable ? 'WebCrypto' : '无 WebCrypto', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    if (!cryptoAvailable) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    try {
      const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>()
      const index = new SymbolIndex(async (file, source, detail) => {
        if (source.includes('newer')) { started.resolve(); await pending.promise }
        return analyze(file, source, detail)
      })
      await index.change('sample.ts', text)
      const late = index.change('sample.ts', 'function newer() {}')
      try { await started.promise; await index.change('sample.ts', text) }
      finally { pending.resolve(); await late }
      assert.deepEqual(index.declarations('sample.ts').map(symbol => symbol.name), ['before', 'after'])
      assert.equal(index.candidates('sample.ts', 'newer').length, 0)
      assert.equal(index.pending.size, 0)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
      else Reflect.deleteProperty(globalThis, 'crypto')
    }
  })
})

test('说明、参数和定义同时读取同一源码，只执行一次详细解析', async () => {
  const source = '/** 计算合计。 */\nexport function total(value: number): number { return value }\ntotal(1);'
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false) { details++; started.resolve(); await gate.promise }
    return analyze(file, text, detail)
  })
  await index.change('sample.ts', source)
  const items = index.candidates('sample.ts', 'total')
  const work = Promise.all([
    index.describe(items), index.describe(items),
    index.navigate('sample.ts', 'total', source.lastIndexOf('total') + 2),
  ])
  try {
    await started.promise
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(details, 1, '同一源码的三个调用应共用详细解析')
  } finally { gate.resolve(); await work }
  const [hover, parameters, definition] = await work
  assert.deepEqual(hover, parameters)
  assert.match(hover[0].declaration, /value: number/)
  assert.match(hover[0].documentation.description, /计算合计/)
  assert.deepEqual(definition, { kind: 'definitions', matches: items })
})

test('相同内容的不同文件共用在途解析，但保留各自的真实位置', async () => {
  const source = '/** 共享文档。 */\nexport function total(value: number) { return value }'
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false) { details++; started.resolve(); await gate.promise }
    return analyze(file, text, detail)
  })
  for (const file of ['a.ts', 'b.ts']) await index.change(file, source)
  const items = index.candidates('caller.ts', 'total')
  const work = Promise.all(items.map(item => index.describe([item])))
  try { await started.promise; await new Promise(resolve => setImmediate(resolve)); assert.equal(details, 1) }
  finally { gate.resolve(); await work }
  const result = (await work).flat()
  assert.deepEqual(result.map(item => item.file), ['a.ts', 'b.ts'])
  for (const item of result) assert.match(item.documentation.description, /共享文档/)
})

for (const allCancelled of [false, true]) test(allCancelled ? '全部调用方取消后不保留解析任务，新查询能重新完成' : '取消一个详细查询不会影响其他调用方', async () => {
  const source = '/** 独立取消。 */\nexport function total() {}'
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false) { details++; started.resolve(); await gate.promise }
    return analyze(file, text, detail)
  })
  await index.change('sample.ts', source)
  const first = new AbortController(), second = new AbortController(), items = index.candidates('sample.ts', 'total')
  const work = Promise.allSettled([index.describe(items, first.signal), index.describe(items, second.signal)])
  try { await started.promise; first.abort(); if (allCancelled) second.abort() }
  finally { gate.resolve() }
  const results = await work
  assert.equal(details, 1)
  assert.equal(results[0].status, 'rejected')
  if (results[0].status === 'rejected') assert.equal(results[0].reason.name, 'AbortError')
  assert.equal(results[1].status, allCancelled ? 'rejected' : 'fulfilled')
  if (results[1].status === 'fulfilled') assert.match(results[1].value[0].documentation.description, /独立取消/)
  const retry = await index.describe(items)
  assert.equal(retry[0].name, 'total')
  assert.equal(details, allCancelled ? 2 : 1)
})

test('共享详细解析失败时所有调用方收到原错误，失败任务释放后可以重试', async () => {
  const source = 'export function total() {}', failure = new Error('DETAIL_FAILED')
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0, failing = true
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false) { details++; started.resolve(); await gate.promise; if (failing) throw failure }
    return analyze(file, text, detail)
  })
  await index.change('sample.ts', source)
  const items = index.candidates('sample.ts', 'total')
  const work = Promise.allSettled([index.describe(items), index.describe(items), index.describe(items)])
  await started.promise; gate.resolve()
  const results = await work
  assert.equal(details, 1)
  for (const result of results) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.reason, failure) }
  failing = false
  assert.equal((await index.describe(items))[0].name, 'total')
  assert.equal(details, 2)
})

test('详细解析期间编辑源码，新旧请求都读取最后版本，不把旧文档写回缓存', async () => {
  const before = '/** 原始文档。 */\nexport function total() {}', after = before.replace('原始', '更新')
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false) { details++; if (text === before) { started.resolve(); await gate.promise } }
    return analyze(file, text, detail)
  })
  await index.change('sample.ts', before)
  const old = Promise.all([index.describe(index.candidates('sample.ts', 'total')), index.describe(index.candidates('sample.ts', 'total'))])
  try {
    await started.promise
    await index.change('sample.ts', after)
    assert.match((await index.describe(index.candidates('sample.ts', 'total')))[0].documentation.description, /更新文档/)
  } finally { gate.resolve() }
  for (const items of await old) assert.match(items[0].documentation.description, /更新文档/)
  assert.equal(details, 2)
  assert.equal(index.cache.get(index.files.get('sample.ts').key).value.text, after)
})

for (const operation of ['remove', 'clear'] as const) test(`${operation} 后同文本重新加入，不复用仍在运行的旧详细解析`, async () => {
  const source = '/** 重新加入。 */\nexport function total() {}'
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let details = 0
  const index = new SymbolIndex(async (file, text, detail) => {
    if (detail !== false && ++details === 1) { started.resolve(); await gate.promise }
    return analyze(file, text, detail)
  })
  await index.change('sample.ts', source)
  const old = index.describe(index.candidates('sample.ts', 'total'))
  try {
    await started.promise
    if (operation === 'remove') index.remove('sample.ts'); else index.clear()
    await index.change('sample.ts', source)
    assert.equal((await index.describe(index.candidates('sample.ts', 'total')))[0].name, 'total')
    assert.equal(details, 2)
  } finally { gate.resolve(); await old }
  index.clear()
  assert.equal(index.files.size, 0); assert.equal(index.cacheSize, 0)
})

for (const cryptoAvailable of [true, false]) for (const cacheBytes of [0, 128]) test(`WebCrypto=${cryptoAvailable}、缓存${cacheBytes}字节时仅合并在途解析，不额外常驻源码`, async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  if (!cryptoAvailable) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
  try {
    const source = '/** 有限缓存。 */\nexport function total(value: number) { return value }'
    const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
    let details = 0
    const index = new SymbolIndex(async (file, text, detail) => {
      if (detail !== false) { details++; started.resolve(); await gate.promise }
      return analyze(file, text, detail)
    }, { cacheBytes, read: async () => source })
    await index.change('sample.ts', source)
    const items = index.candidates('sample.ts', 'total'), work = Promise.all([index.describe(items), index.describe(items)])
    try { await started.promise; await new Promise(resolve => setImmediate(resolve)); assert.equal(details, 1) }
    finally { gate.resolve(); await work }
    for (const result of await work) assert.equal(result[0].name, 'total')
    assert.equal(index.cacheSize, 0)
    assert.equal((await index.describe(index.candidates('sample.ts', 'total')))[0].name, 'total')
    assert.equal(details, 2)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else Reflect.deleteProperty(globalThis, 'crypto')
  }
})

test('没有 WebCrypto 时只共享同一文件版本，不合并其他文件的不同源码', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
  try {
    const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
    let details = 0
    const index = new SymbolIndex(async (file, text, detail) => {
      if (detail !== false) { details++; started.resolve(); await gate.promise }
      return analyze(file, text, detail)
    })
    for (const file of ['a.ts', 'b.ts']) await index.change(file, `/** ${file} */\nexport function total() {}`)
    const items = index.candidates('caller.ts', 'total')
    const work = Promise.all([index.describe([items[0]]), index.describe([items[0]]), index.describe([items[1]])])
    try { await started.promise; await new Promise(resolve => setImmediate(resolve)); assert.equal(details, 2) }
    finally { gate.resolve(); await work }
    const result = await work
    assert.match(result[0][0].documentation.description, /a.ts/)
    assert.match(result[1][0].documentation.description, /a.ts/)
    assert.match(result[2][0].documentation.description, /b.ts/)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else Reflect.deleteProperty(globalThis, 'crypto')
  }
})
