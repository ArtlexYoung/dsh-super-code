import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { createWindowHost } from '../../../../builtin/workbench/windows/host.js'
import { createMessageReader, encode } from '../../../../builtin/workbench/windows/protocol.js'
import { createWindowProxy } from '../../../../builtin/workbench/windows/proxy.js'
import { analyze } from '../../../../builtin/workbench/analysis/index.js'
import { createLayoutPreference } from '../../../../builtin/workbench/layout.js'

function store(value: any) {
  const listeners = new Set<() => void>()
  return { snapshot: () => value, subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) },
    publish(next: any) { value = next; for (const fn of listeners) fn() } }
}
function fixture(layout = createLayoutPreference({ getItem: () => null, setItem() {} }), deliver?: (message: any) => Promise<void>) {
  const editor = EditorState.create({ doc: 'demo' }), sent: any[] = [], calls: any[] = [], errors: any[] = [], frames: number[] = [], read = createMessageReader()
  const state = store({ file: 'demo.ts', panel: null, preferences: {}, window: { state: 'opening' } })
  const workbench: any = { ...state, view: () => ({ state: editor }), index: { files: new Map() }, documents: new Map([['demo.ts', { dirty: true }]]),
    subscribeEditor: () => () => {}, changes: store({ stats: new Map() }), reading: store({ goal: '' }), files: store({ files: [] }), layout,
    assistant: { threads: () => [{ id: 'draft', draft: '保留草稿' }], draft: (value: string) => calls.push(value) },
    windowState: (value: any) => state.publish({ ...state.snapshot(), window: value }),
  }
  const host = createWindowHost(workbench, async (content: string) => { frames.push(Buffer.byteLength(content)); const message = read(content); if (message) { sent.push(message); await deliver?.(message) } }, (error: any) => errors.push(error), { language: 'zh' })
  return { host, workbench, state, sent, calls, errors, frames }
}
const settled = () => new Promise(resolve => setImmediate(resolve))
test('后台状态先变化也不能抢在初始化之前发送；就绪前保留原视图', async () => {
  const f = fixture()
  f.state.publish({ ...f.state.snapshot(), indexed: 1 }); await Promise.resolve(); assert.equal(f.sent.length, 0)
  await f.host.accept('{"kind":"hello"}')
  await settled()
  assert.equal(f.sent[0].kind, 'init'); assert.equal(f.sent[1].kind, 'state')
  assert.equal(f.sent[1].patch.editor.text, 'demo'); assert.equal(f.sent[1].patch.threads[0].draft, '保留草稿')
  assert.equal(f.state.snapshot().window.state, 'opening')
  await f.host.accept('{"kind":"ready"}'); assert.equal(f.state.snapshot().window.state, 'active')
  await assert.rejects(f.host.accept('{"kind":"hello"}'), /WORKBENCH_WINDOW_PROTOCOL/); f.host.dispose()
})
test('窗口只能执行注册操作，取消与销毁后不再写入状态', async () => {
  const f = fixture(); await f.host.accept('{"kind":"hello"}')
  for (const method of ['constructor', '__proto__', 'dispose', 'api.save', 'windowState']) await assert.rejects(f.host.accept(JSON.stringify({ kind: 'call', id: 1, method, args: [] })), /WORKBENCH_WINDOW_PROTOCOL/)
  await f.host.accept(JSON.stringify({ kind: 'call', id: 2, method: 'assistant.draft', args: ['新的草稿'] }))
  await settled()
  assert.deepEqual(f.calls, ['新的草稿']); assert.equal(f.sent.at(-1).kind, 'result')
  f.host.dispose(); const count = f.sent.length
  f.state.publish({ file: 'other.ts' }); await Promise.resolve(); assert.equal(f.sent.length, count)
})

test('异步按钮的空参数仍使用原控制器默认值，明确传入的空值保持不变', async () => {
  const f = fixture()
  f.workbench.save = (path = 'demo.ts') => { f.calls.push(path) }
  f.workbench.panel = (value: unknown) => { f.calls.push(value) }
  const proxy = createWindowProxy(async (message: unknown) => {
    await f.host.accept(encode(message))
    for (const content of f.sent.splice(0)) await proxy.accept(content)
  }, (key: string) => key)
  try {
    await f.host.accept('{"kind":"hello"}')
    await settled()
    for (const message of f.sent.splice(0)) await proxy.accept(message)
    await Promise.resolve().then(proxy.save)
    await proxy.save(undefined)
    await proxy.save('other.ts')
    proxy.panel(null)
    await settled()
    assert.deepEqual(f.calls, ['demo.ts', 'demo.ts', 'other.ts', null])
  } finally { proxy.dispose(); f.host.dispose() }
})

test('大项目先交接界面，独立窗口按需查询而不复制整库索引', async () => {
  const f = fixture()
  const text = Array.from({ length: 512 }, (_, i) => `export function compute${i}(value: number): number { const result = value * 2; return result + value; }`).join('\n')
  const value = await analyze('sample.ts', text)
  for (let i = 0; i < 40; i++) f.workbench.index.files.set(`module-${i}.ts`, value)
  try {
    await f.host.accept('{"kind":"hello"}')
    await settled()
    assert.equal(f.sent[1].kind, 'state')
    assert.equal(f.sent[1].patch.editor.text, 'demo')
    assert.ok(f.sent[1].patch.index === undefined, '首次界面不能等待全项目索引')
    const indexed = f.sent.flatMap(message => message.patch?.index?.entries || [])
    assert.equal(indexed.length, 0)
    f.workbench.index.search = async (query: string, limit: number, signal: AbortSignal) => { assert.equal(query, 'compute'); assert.equal(limit, 500); signal.throwIfAborted(); return { matches: [{ file: 'module-39.ts', line: 1, character: 0 }], truncated: false } }
    await f.host.accept(encode({ kind: 'call', id: 1, method: 'index.search', args: ['compute', 500] })); await settled()
    assert.equal(f.sent.find(message => message.kind === 'result' && message.id === 1).value.matches[0].file, 'module-39.ts')
    assert.ok(f.frames.every(bytes => bytes <= 32 * 1024 * 1024), '合法项目不能生成超出窗口限制的单条消息')
    assert.equal(f.errors.length, 0)
  } finally { f.host.dispose() }
})

test('独立窗口文件对比复用主控制器文本与取消信号', async () => {
  const f = fixture(), pending = Promise.withResolvers<any>()
  let signal: AbortSignal | undefined
  f.workbench.compareFiles = (left: string, right: string, abort: AbortSignal) => { f.calls.push([left, right]); signal = abort; return pending.promise }
  await f.host.accept('{"kind":"hello"}')
  const running = f.host.accept(JSON.stringify({ kind: 'call', id: 9, method: 'compareFiles', args: ['a.ts', 'b.txt'] }))
  await f.host.accept('{"kind":"cancel","id":9}')
  assert.equal(signal?.aborted, true)
  pending.resolve({ path: 'a.ts', before: 'left', after: 'right', lines: [] })
  await running
  assert.deepEqual(f.calls, [['a.ts', 'b.txt']])
  f.host.dispose()
})

test('独立窗口可只读查询字体，关闭或取消会传递给宿主枚举', async () => {
  const f = fixture(), pending = Promise.withResolvers<string[]>()
  let signal: AbortSignal | undefined
  try {
    f.workbench.fonts = async (abort: AbortSignal) => { abort.throwIfAborted(); return ['Menlo', 'Songti SC'] }
    await f.host.accept('{"kind":"hello"}')
    await f.host.accept(encode({ kind: 'call', id: 7, method: 'fonts', args: [] })); await settled()
    assert.deepEqual(f.sent.find(message => message.kind === 'result' && message.id === 7).value, ['Menlo', 'Songti SC'])
    f.workbench.fonts = (abort: AbortSignal) => { signal = abort; return pending.promise }
    const running = f.host.accept(encode({ kind: 'call', id: 8, method: 'fonts', args: [] }))
    await f.host.accept('{"kind":"cancel","id":8}')
    assert.equal(signal?.aborted, true)
    pending.resolve([]); await running
    const waiting = f.host.accept(encode({ kind: 'call', id: 9, method: 'fonts', args: [] }))
    f.host.dispose(); await waiting
    assert.equal(signal?.aborted, true)
    assert.deepEqual(f.calls, [])
  } finally { f.host.dispose() }
})

test('主页面与两个独立窗口共用侧栏和尺寸，外窗保存写回主页面的存储', async () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const layout = createLayoutPreference(storage)
  layout.change({ outlineOpen: false, panes: { conversation: false, quick: true } })
  const links = Array.from({ length: 2 }, () => {
    let proxy: ReturnType<typeof createWindowProxy>
    const f = fixture(layout, message => message.kind === 'init' ? Promise.resolve() : proxy.accept(message))
    proxy = createWindowProxy(message => f.host.accept(encode(message)), (key: string) => key)
    return { ...f, proxy }
  })
  try {
    for (const link of links) await link.host.accept('{"kind":"hello"}')
    await settled()
    for (const link of links) assert.deepEqual(link.proxy.layout.snapshot(), layout.snapshot())
    links[0].proxy.layout.change({ panes: { learning: true } })
    await settled()
    assert.deepEqual(layout.snapshot().panes, { conversation: false, quick: true, changes: false, learning: true })
    layout.change({ explorer: 310, right: { conversation: 6, quick: 4, changes: 3, learning: 4 } })
    await settled()
    for (const link of links) assert.deepEqual(link.proxy.layout.snapshot(), layout.snapshot())
    await links[1].proxy.layout.save()
    assert.deepEqual(createLayoutPreference(storage).snapshot(), layout.snapshot())
    links[0].host.dispose(); links[0].proxy.dispose()
    layout.change({ filesOpen: false })
    await settled()
    assert.equal(links[1].proxy.layout.snapshot().filesOpen, false)
    assert.equal(links[0].proxy.layout.snapshot().filesOpen, true)
    for (const link of links) assert.deepEqual(link.errors, [])
  } finally { for (const link of links) { link.proxy.dispose(); link.host.dispose() } }
})

test('独立窗口的依赖定义和环境设置走只读RPC，不调用不存在的本地load',async()=>{
 const f=fixture();const signalCalls:string[]=[]
 f.workbench.index.resolve=async(file:string,name:string,offset:number,signal:AbortSignal)=>{signal.throwIfAborted();signalCalls.push('resolve');assert.deepEqual([file,name,offset],['main.py','run',20]);return [{file:'api.py',name:'run',library:{text:'def run(): pass',path:'api.py'}}]}
 f.workbench.environments=async(signal:AbortSignal)=>{signal.throwIfAborted();signalCalls.push('environments');return {environments:[{language:'python',roots:['example/Lib']}],warnings:[]}}
 const proxy=createWindowProxy(async(message:unknown)=>{await f.host.accept(encode(message));for(const content of f.sent.splice(0))await proxy.accept(content)},(key:string)=>key)
 try{
  await f.host.accept('{"kind":"hello"}');await settled();for(const message of f.sent.splice(0))await proxy.accept(message)
  const result=await proxy.index.resolve('main.py','run',20,new AbortController().signal)
  assert.equal(result[0].library.text,'def run(): pass');assert.equal(proxy.index.load,undefined)
  const environments=await proxy.environments(new AbortController().signal);assert.equal(environments.environments[0].language,'python');assert.deepEqual(signalCalls,['resolve','environments'])
 }finally{proxy.dispose();f.host.dispose()}
})
