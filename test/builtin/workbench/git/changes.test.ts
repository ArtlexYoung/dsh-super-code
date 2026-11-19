import test from 'node:test'
import assert from 'node:assert/strict'
import { createChanges } from '../../../../builtin/workbench/git/changes.js'

test('两处侧栏合并状态请求，只为可见文件分批统计，保留真实版本与来源', async () => {
  const calls: any[] = [], waiting = Promise.withResolvers<void>()
  const store = createChanges(async (input: any) => {
    calls.push(input)
    if (input.action === 'status') { await waiting.promise; return { kind: 'state', state: { version: 'a', exists: true, changes: Array.from({ length: 10000 }, (_, i) => ({ path: `${i}.ts` })) }, sources: [{ id: 'root', files: ['1.ts'] }] } }
    if (input.action === 'stats') return { kind: 'stats', version: input.version, stats: input.paths.map((path: string) => ({ path, added: 1, removed: 0 })) }
    return { kind: 'diff', diff: { path: input.path } }
  }, (error: Error) => error.message)
  const release = store.subscribe(() => {}), release2 = store.subscribe(() => {})
  const first = store.refresh(), second = store.refresh(); waiting.resolve(); await Promise.all([first, second])
  assert.equal(calls.filter(call => call.action === 'status').length, 1)
  assert.equal(store.snapshot().state.changes.length, 10000)
  store.visible(Array.from({ length: 40 }, (_, i) => `${i}.ts`))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.snapshot().stats.size, 40)
  assert.equal(calls.filter(call => call.action === 'stats').length, 3)
  assert.ok(calls.filter(call => call.action === 'stats').every(call => call.paths.length <= 16))
  store.visible(['0.ts', '1.ts']); await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.filter(call => call.action === 'stats').length, 3)
  await store.diff('1.ts')
  assert.deepEqual(calls.at(-1), { action: 'diff', path: '1.ts', side: 'total', version: 'a' })
  release(); release2(); store.dispose()
})

test('版本变化时淘汰晚到统计，错误不冒充干净仓库，最后一处侧栏关闭时取消请求', async () => {
  const pending = Promise.withResolvers<any>(), signals: AbortSignal[] = []
  const store = createChanges(async (input: any, signal: AbortSignal) => { signals.push(signal); return pending.promise }, (error: Error) => error.message)
  const release = store.subscribe(() => {})
  store.accept({ kind: 'state', state: { version: 'a', exists: true, changes: [{ path: 'old' }] } })
  store.visible(['old']); store.accept({ kind: 'state', state: { version: 'b', exists: true, changes: [{ path: 'new' }] } })
  assert.equal(signals[0].aborted, true)
  pending.resolve({ kind: 'stats', version: 'a', stats: [{ path: 'old', added: 99 }] })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.snapshot().stats.size, 0)
  release(); store.dispose()
  const failure = createChanges(async () => { throw new Error('permission denied') }, (error: Error) => error.message)
  const end = failure.subscribe(() => {}); await failure.refresh()
  assert.equal(failure.snapshot().state, null); assert.equal(failure.snapshot().error, 'permission denied')
  end(); failure.dispose()
})

test('快速滚动和关闭一个侧栏时不累计离开视口的统计，重挂载不会复用已取消请求', async () => {
  const batch = Promise.withResolvers<any>(), calls: any[] = [], signals: AbortSignal[] = []
  const state = { kind: 'state', state: { version: 'a', exists: true, changes: [] } }
  const store = createChanges(async (input: any, signal: AbortSignal) => {
    calls.push(input); signals.push(signal)
    if (input.action === 'status') return state
    if (calls.filter(call => call.action === 'stats').length === 1) return batch.promise
    return { kind: 'stats', version: 'a', stats: input.paths.map((path: string) => ({ path, added: 1, removed: 0 })) }
  }, (error: Error) => error.message)
  let release = store.subscribe(() => {})
  await store.refresh()
  store.visible(Array.from({ length: 100 }, (_, i) => `old-${i}`), 'editor')
  store.visible(['other'], 'sidebar')
  store.visible(['last'], 'editor')
  store.forget('sidebar')
  batch.resolve({ kind: 'stats', version: 'a', stats: [] })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls.filter(call => call.action === 'stats').map(call => call.paths), [Array.from({ length: 16 }, (_, i) => `old-${i}`), ['last']])
  release()
  release = store.subscribe(() => {})
  await store.refresh()
  assert.equal(calls.filter(call => call.action === 'status').length, 2)
  store.visible(['new'], 'editor'); release()
  assert.equal(signals.at(-1)?.aborted, true)
  release = store.subscribe(() => {})
  await store.refresh(); store.visible(['new'], 'editor')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(store.snapshot().stats.has('new'))
  release(); store.dispose()
})

test('前台读取暂停后台统计，结束后补回被取消的可见行', async () => {
  const started = Promise.withResolvers<void>(), foreground = Promise.withResolvers<any>()
  const calls: any[] = [], signals: AbortSignal[] = []
  const store = createChanges(async (input: any, signal: AbortSignal) => {
    calls.push(input)
    if (input.action === 'diff') { started.resolve(); return foreground.promise }
    signals.push(signal)
    if (signals.length === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return { kind: 'stats', version: 'a', stats: input.paths.map((path: string) => ({ path, added: 2, removed: 1 })) }
  }, (error: Error) => error.message)
  const release = store.subscribe(() => {})
  store.accept({ kind: 'state', state: { version: 'a', exists: true, changes: [{ path: 'file' }] } })
  store.visible(['file'])
  const work = store.diff('file'); await started.promise
  store.visible(['file'])
  assert.equal(signals[0].aborted, true)
  assert.equal(signals.length, 1)
  foreground.resolve({ kind: 'diff', diff: { path: 'file' } }); await work
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.snapshot().stats.get('file').added, 2)
  assert.deepEqual(calls.map(call => call.action), ['stats', 'diff', 'stats'])
  release(); store.dispose()
})

test('旧刷新晚到不覆盖较新的写入状态，失败的前台操作也恢复统计', async () => {
  const waiting = Promise.withResolvers<any>()
  const state = (version: string) => ({ kind: 'state', state: { version, exists: true, changes: [{ path: 'file' }] } })
  const store = createChanges(async (input: any) => {
    if (input.action === 'status') return waiting.promise
    if (input.action === 'stage') return state('new')
    if (input.action === 'diff') throw new Error('read failed')
    return { kind: 'stats', version: input.version, stats: [{ path: 'file', added: 1 }] }
  }, (error: Error) => error.message)
  const release = store.subscribe(() => {})
  const refresh = store.refresh(); await store.run({ action: 'stage' })
  waiting.resolve(state('old')); await refresh
  assert.equal(store.snapshot().state.version, 'new')
  store.visible(['file'])
  await assert.rejects(store.diff('file'), /read failed/)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.snapshot().stats.get('file').added, 1)
  release(); store.dispose()
})

test('状态读取期间发生保存，即使过了合并窗口也会在读取完成后再次刷新', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = Promise.withResolvers<any>()
  let calls = 0
  const state = (version: string) => ({ kind: 'state', state: { version, exists: true, changes: [] } })
  const store = createChanges(async () => ++calls === 1 ? pending.promise : state('saved'), (error: Error) => error.message)
  const release = store.subscribe(() => {})
  try {
    const initial = store.refresh()
    store.invalidate(); t.mock.timers.tick(500)
    pending.resolve(state('before-save')); await initial
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 2)
    assert.equal(store.snapshot().state.version, 'saved')
  } finally { release(); store.dispose() }
})

test('读取期间的多次失效合并为一次补刷，侧栏关闭后不再启动补刷', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const closed of [false, true]) {
    const pending = Promise.withResolvers<any>()
    let calls = 0
    const state = { kind: 'state', state: { version: 'latest', exists: true, changes: [] } }
    const store = createChanges(async () => ++calls === 1 ? pending.promise : state, (error: Error) => error.message)
    const release = store.subscribe(() => {})
    try {
      const initial = store.refresh()
      for (let i = 0; i < 3; i++) { store.invalidate(); t.mock.timers.tick(500) }
      if (closed) release()
      pending.resolve(state); await initial
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls, closed ? 1 : 2)
    } finally { release(); store.dispose() }
  }
})
