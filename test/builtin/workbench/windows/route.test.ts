import test from 'node:test'
import assert from 'node:assert/strict'
import { createWindowRoute } from '../../../../builtin/workbench/windows/route.js'
import { EditorState } from '@codemirror/state'

test('弹窗被拦截且系统组件缺失时保留原文件、选区与草稿', async () => {
  const originalWindow = globalThis.window
  globalThis.window = { open: () => null } as any
  let state: any = null, kept = false, error = ''
  const saved = { file: 'demo.ts', selection: [1, 4], text: '未保存内容', draft: '保留草稿' }, calls: any[] = []
  const workbench: any = { snapshot: () => ({ window: state }), visit: async (value: any) => calls.push(value), windowState: (value: any) => { state = value }, keepAlive: (value: boolean) => { kept = value }, fail: (value: Error) => { error = value.message } }
  const api = { open: async (native: boolean) => { assert.equal(native, true); throw new Error('WORKBENCH_WINDOW_COMPONENT') }, close: async () => {} }
  try {
    const route = createWindowRoute(workbench, api, (key: string) => key)
    await route.open('demo.ts'); assert.equal(state, null); assert.equal(kept, false); assert.equal(error, 'WORKBENCH_WINDOW_FALLBACK')
    assert.deepEqual(saved, { file: 'demo.ts', selection: [1, 4], text: '未保存内容', draft: '保留草稿' }); assert.deepEqual(calls, [{ file: 'demo.ts' }]); route.dispose()
  } finally { globalThis.window = originalWindow }
})

test('已关闭或无法导航的浏览器窗口回落到系统窗口，只清理失效连接', async () => {
  const originalWindow = globalThis.window
  try {
    for (const closed of [true, false]) {
      const opened: boolean[] = [], cleaned: string[] = [], errors: string[] = []
      let closedPopup = 0
      globalThis.window = { open: () => ({ closed, close() { closedPopup++ }, location: { replace() { throw new Error('navigation denied') } } }) } as any
      const workbench = { windowState() {}, keepAlive() {}, fail: (error: Error) => errors.push(error.message) }
      const api = { async open(native: boolean) {
        opened.push(native)
        if (native) throw new Error('WORKBENCH_WINDOW_COMPONENT')
        return { id: 'rejected', url: 'http://127.0.0.1:1/' }
      }, async close(id: string) { cleaned.push(id) } }
      const route = createWindowRoute(workbench, api, (key: string) => key)
      await route.open(); route.dispose()
      assert.deepEqual(opened, closed ? [true] : [false, true])
      assert.deepEqual(cleaned, closed ? [] : ['rejected'])
      assert.equal(closedPopup, closed ? 0 : 1)
      assert.deepEqual(errors, ['WORKBENCH_WINDOW_FALLBACK'])
    }
  } finally { globalThis.window = originalWindow }
})
test('加载期间重复请求不创建第二个窗口，取消等待后晚到地址被释放', async () => {
  const originalWindow = globalThis.window; globalThis.window = { open: () => null } as any
  let resolve: any, opened = 0; const closed: string[] = []
  const api = { open: () => { opened++; return new Promise(done => { resolve = done }) }, close: async (id: string) => { closed.push(id) } }
  const workbench = { windowState() {}, keepAlive() {}, fail() {} }
  try {
    const route = createWindowRoute(workbench, api, (key: string) => key), first = route.open()
    await route.open(); assert.equal(opened, 1)
    route.close(); resolve({ id: 'late', url: 'http://127.0.0.1:1/' }); await first
    assert.deepEqual(closed, ['late']); route.dispose()
  } finally { globalThis.window = originalWindow }
})

test('打开超时只恢复一次，晚到结果仍被释放而不会遮住原界面', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const originalWindow = globalThis.window; globalThis.window = { open: () => null } as any
  let resolve: any, error = 0, state: any; const closed: string[] = []
  const workbench = { snapshot: () => ({ window: state }), windowState(value: any) { state = value }, keepAlive() {}, fail() { error++ } }
  const api = { open: () => new Promise(done => { resolve = done }), close: async (id: string) => { closed.push(id) } }
  try {
    const route = createWindowRoute(workbench, api, (key: string) => key), pending = route.open()
    await Promise.resolve()
    t.mock.timers.tick(16000); assert.equal(state, null); assert.equal(error, 1)
    resolve({ id: 'late' }); await pending; assert.deepEqual(closed, ['late']); assert.equal(error, 1); route.dispose()
  } finally { globalThis.window = originalWindow }
})

test('窗口加载失败及就绪后异常退出都恢复原状态并释放窗口', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document
  globalThis.document = { body: { hasAttribute: () => false } } as any
  try {
    for (const ready of [false, true]) for (const reported of [false, true]) {
      let closed = 0, released = 0, kept = false, abortedWhenClosing: boolean | undefined, lifetime: AbortSignal | undefined
      const states: any[] = [], failures: string[] = [], listeners = new Set<() => void>()
      const view = { state: EditorState.create({ doc: '未保存的代码', selection: { anchor: 1, head: 3 } }) }
      let snapshot = { file: 'demo.ts', window: null as any, draft: '保留草稿' }
      const store = { snapshot: () => ({}), subscribe: () => () => {} }
      const workbench = {
        view: () => view, snapshot: () => snapshot, index: { files: new Map() }, documents: new Map(),
        assistant: { threads: () => [] }, changes: store, files: store, reading: store, layout: store,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
        subscribeEditor: () => () => {}, keepAlive: (value: boolean) => { kept = value },
        windowState: (value: any) => { states.push(value?.state ?? null); snapshot = { ...snapshot, window: value }; for (const listener of listeners) listener() },
        fail: (error: Error) => failures.push(error.message),
      }
      globalThis.window = { open: () => ({ location: { replace() {} }, close() { closed++ } }) } as any
      const api = {
        open: async (native: boolean) => { assert.equal(native, false); return { id: 'window', url: 'http://127.0.0.1:1/' } },
        send: async () => {}, close: async () => { released++; abortedWhenClosing = lifetime?.aborted },
        async *events(_id: string, signal: AbortSignal) {
          lifetime = signal
          yield { kind: 'message', content: '{"kind":"hello"}' }
          if (ready) yield { kind: 'message', content: '{"kind":"ready"}' }
          if (reported) yield { kind: 'closed', reason: 'WORKBENCH_WINDOW_DISCONNECTED' }
        },
      }
      const route = createWindowRoute(workbench, api, (key: string) => key)
      await route.open()
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(states, ready ? ['opening', 'active', null] : ['opening', null])
      assert.equal(view.state.doc.toString(), '未保存的代码'); assert.equal(view.state.selection.main.from, 1)
      assert.equal(snapshot.draft, '保留草稿'); assert.equal(kept, false)
      assert.equal(closed, ready ? 0 : 1); assert.equal(released, ready ? 0 : 1); assert.equal(listeners.size, 0)
      if (!ready) assert.equal(abortedWhenClosing, false, '握手失败应先主动关窗，再取消流，避免后端将空白窗口作为只读副本保留')
      assert.equal(lifetime?.aborted, true)
      assert.deepEqual(failures, ['WORKBENCH_WINDOW_FALLBACK']); route.dispose()
    }
  } finally { globalThis.window = originalWindow; globalThis.document = originalDocument }
})

test('关闭重开后旧窗口的迟到发送失败不能关闭新窗口', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document
  globalThis.window = { open: () => null } as any
  globalThis.document = { body: { hasAttribute: () => false } } as any
  let snapshot = { file: null, window: null as any }, rejectSend: (error: Error) => void, opened = 0
  const failures: string[] = [], closed: string[] = [], listeners = new Set<() => void>()
  const store = { snapshot: () => ({}), subscribe: () => () => {} }
  const workbench = {
    snapshot: () => snapshot, view: () => undefined, index: { files: new Map() }, documents: new Map(),
    assistant: { threads: () => [] }, changes: store, files: store, reading: store, layout: store,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    subscribeEditor: () => () => {}, keepAlive() {},
    windowState(value: any) { snapshot = { ...snapshot, window: value }; for (const listener of listeners) listener() },
    fail: (error: Error) => failures.push(error.message),
  }
  const api = {
    open: async () => ({ id: String(++opened), url: 'http://127.0.0.1:1/' }),
    send: (id: string) => id === '1' ? new Promise<void>((_resolve, reject) => { rejectSend = reject }) : Promise.resolve(),
    close: async (id: string) => { closed.push(id) },
    async *events(_id: string, signal: AbortSignal) {
      yield { kind: 'message', content: '{"kind":"hello"}' }
      yield { kind: 'message', content: '{"kind":"ready"}' }
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }) })
    },
  }
  const route = createWindowRoute(workbench, api, (key: string) => key), first = route.open()
  let second: Promise<void> | undefined
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(snapshot.window.state, 'active')
    route.close()
    second = route.open()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(snapshot.window.state, 'active')
    rejectSend!(new Error('late failure'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(snapshot.window?.state, 'active', '旧窗口发送失败后，新窗口应继续工作')
    assert.deepEqual(closed, ['1'])
    assert.deepEqual(failures, [])
  } finally {
    route.dispose(); await Promise.all([first, second])
    globalThis.window = originalWindow; globalThis.document = originalDocument
  }
})

test('同一会话多个已就绪窗口独立结束，原页面始终保留且只在最后关窗后释放保活', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document
  globalThis.window = { open: () => null } as any
  globalThis.document = { body: { hasAttribute: () => false } } as any
  let snapshot: any = { file: 'main.ts', window: null }, kept = false
  const failures: string[] = [], listeners = new Set<() => void>(), streams = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const store = { snapshot: () => ({}), subscribe: () => () => {} }
  const workbench = {
    snapshot: () => snapshot, view: () => undefined, index: { files: new Map() }, documents: new Map(),
    assistant: { threads: () => [] }, changes: store, files: store, reading: store, layout: store,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }, subscribeEditor: () => () => {},
    keepAlive(value: boolean) { kept = value }, fail(error: Error) { failures.push(error.message) },
    windowState(value: any) { snapshot = { ...snapshot, window: value }; for (const listener of listeners) listener() },
  }
  const api = {
    async open() { const id = String(streams.size + 1); streams.set(id, Promise.withResolvers()); return { id, url: 'http://127.0.0.1:1/' } },
    async send() {}, async close(id: string) { streams.get(id)?.resolve() },
    async *events(id: string, signal: AbortSignal) {
      yield { kind: 'message', content: '{"kind":"hello"}' }; yield { kind: 'message', content: '{"kind":"ready"}' }
      const stop = () => streams.get(id)?.resolve(); signal.addEventListener('abort', stop, { once: true })
      try { await streams.get(id)!.promise; yield { kind: 'closed', reason: 'WORKBENCH_WINDOW_CLOSED' } }
      finally { signal.removeEventListener('abort', stop) }
    },
  }
  const route = createWindowRoute(workbench, api, (key: string) => key), runs: Promise<void>[] = []
  try {
    runs.push(route.open()); await new Promise(resolve => setImmediate(resolve))
    runs.push(route.open()); await new Promise(resolve => setImmediate(resolve))
    assert.equal(snapshot.window.count, 2); assert.equal(snapshot.file, 'main.ts'); assert.equal(kept, true)
    streams.get('1')!.resolve(); await runs[0]
    assert.equal(snapshot.window.count, 1); assert.equal(kept, true)
    streams.get('2')!.resolve(); await runs[1]
    assert.equal(snapshot.window, null); assert.equal(kept, false); assert.equal(listeners.size, 0); assert.deepEqual(failures, [])
  } finally { route.dispose(); await Promise.all(runs); globalThis.window = originalWindow; globalThis.document = originalDocument }
})
