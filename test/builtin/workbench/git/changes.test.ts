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
