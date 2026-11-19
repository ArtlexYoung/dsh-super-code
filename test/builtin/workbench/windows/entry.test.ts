import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

let bundle: Promise<string>
function entry(): Promise<string> {
  return bundle ||= build({
    entryPoints: [new URL('../../../../builtin/workbench/windows/index.jsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'iife', platform: 'browser',
    loader: { '.css': 'text', '.woff2': 'dataurl' },
    plugins: [{ name: 'window-boundaries', setup(build) {
      build.onResolve({ filter: /^(react|react-dom\/client)$|ui\/controls\.js$|components\/Workbench\.jsx$|\.\/(?:proxy\.js|markdown\.jsx)$/ }, args => ({ path: args.path, namespace: 'boundary' }))
      build.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents:
        args.path === 'react' ? 'export default {Component:class{},createElement:(type,props,...children)=>({type,props,children})};export const useEffect=()=>{},useState=()=>{},useMemo=fn=>fn();'
          : args.path === 'react-dom/client' ? 'export const createRoot=()=>({render(value){fixture.rendered.push(value)}});'
            : args.path.endsWith('proxy.js') ? 'export const createWindowProxy=()=>fixture.proxy;'
              : args.path.endsWith('Workbench.jsx') ? 'export const Workbench=()=>null;'
                : args.path.endsWith('markdown.jsx') ? 'export const SafeMarkdown=()=>null;'
                : 'export const ActionButton=()=>null,SelectControl=()=>null;',
      }))
    } }],
  }).then(result => result.outputFiles[0]!.text)
}

async function fixture(t: any, waitForHello = false, buffers: { file: string; text: string }[] = []) {
  const sent: any[] = [], rendered: any[] = []
  let stream: ReadableStreamDefaultController<Uint8Array>, closed = false, returns = 0, headers: (() => void) | undefined
  const panes = buffers.map(({ file, text }, id) => ({ pane: { id, workbench: {
    snapshot: () => ({ file }), view: () => ({ state: { doc: text } }),
  } } }))
  const proxy = { accept: async () => {}, groups: { snapshot: () => ({ panes }) }, snapshot: () => null, dispose() {}, async returnToHost() { returns++ } }
  const context: any = {
    fixture: { rendered, proxy }, TextDecoder, AbortController,
    location: { hash: '#' + 'a'.repeat(43) }, history: { replaceState() {} }, navigator: { language: 'zh' },
    document: { getElementById: () => ({}), createElement: () => ({}), head: { append() {} }, body: { setAttribute() {} } },
    setInterval: () => 1, clearInterval() {},
    fetch: async (path: string, request: { body?: string }) => {
      if (path === '/events') {
        const response = { ok: true, body: new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }) }
        if (waitForHello) await new Promise<void>(resolve => { headers = resolve })
        return response
      }
      const message = JSON.parse(request.body!); sent.push(message)
      if (message.kind === 'hello') headers?.()
      return { ok: true }
    },
    addEventListener() {},
  }
  context.window = context
  runInNewContext(await entry(), context)
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
  const send = (message: any) => { stream.enqueue(new TextEncoder().encode(JSON.stringify(message) + '\n')) }
  t.after(async () => { if (!closed) stream.close(); await settle() })
  await settle()
  return { sent, rendered, send, settle, close: () => context.__superCodeCloseWindow(), returns: () => returns,
    disconnect() { closed = true; stream.close() },
  }
}

test('生产窗口入口在初始化前允许系统关闭，就绪后通过原控制器返回', async t => {
  const f = await fixture(t)
  assert.equal(f.close(), false)
  f.send({ kind: 'init', metadata: { translations: {}, dark: false } }); await f.settle()
  assert.equal(f.close(), true)
  assert.equal(f.returns(), 1)
})

test('生产窗口断流后显示恢复界面并允许系统关闭', async t => {
  const f = await fixture(t)
  assert.equal(f.sent[0].kind, 'hello')
  f.send({ kind: 'init', metadata: { translations: {}, dark: false } }); await f.settle()
  assert.equal(f.close(), true)
  f.disconnect(); await f.settle()
  assert.equal(f.close(), false)
  assert.ok(f.rendered.length > 1, '断流后应显示恢复界面')
})

test('接收流等待首条内容时仍立即发送握手，不依赖心跳才能初始化', async t => {
  const f = await fixture(t, true)
  assert.equal(f.sent[0]?.kind, 'hello')
  f.send({ kind: 'init', metadata: { translations: {}, dark: false } }); await f.settle()
  assert.equal(f.close(), true)
  assert.equal(f.returns(), 1)
})

test('分栏独立窗口断开后保留每栏可以复制的待确认文本', async t => {
  const f = await fixture(t, false, [{ file: 'one.ts', text: '第一栏草稿' }, { file: 'two.ts', text: '第二栏草稿' }])
  f.send({ kind: 'init', metadata: { translations: {}, dark: false } }); await f.settle()
  f.disconnect(); await f.settle()
  const text = JSON.stringify(f.rendered.at(-1))
  for (const expected of ['one.ts', 'two.ts', '第一栏草稿', '第二栏草稿']) assert.ok(text.includes(expected))
})
