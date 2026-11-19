import test from 'node:test'
import assert from 'node:assert/strict'
import { fileResource, fileTarget, createFileNavigation, closingFileMentions } from '../../../builtin/workbench/file-links.js'

test('宿主文件地址解码保持中文、空格和特殊文件名，不处理其他资源或非法编码', () => {
  assert.deepEqual(fileResource('dsh-resource://file/session/a%20b/src/%E4%B8%AD%E6%96%87%20a%23%25.ts'), { sessionId: 'a b', file: 'src/中文 a#%.ts' })
  assert.deepEqual(fileResource('dsh-resource://file/session/a//tmp/demo.ts?ignored=1'), { sessionId: 'a', file: '/tmp/demo.ts' })
  for (const address of ['https://example.com/a.ts', 'dsh-resource://file/absolute/tmp/demo.ts', 'dsh-resource://file/session//a.ts', 'dsh-resource://file/session/a', 'dsh-resource://file/session/a/%GG']) assert.equal(fileResource(address), undefined)
})

test('链接按照点击时的会话当前目录解析并统一工作台标签，行号转换只进行一次', () => {
  assert.deepEqual(fileTarget('src/中文 a.ts', { line: 7 }, { cwd: '/workspace/demo' }), { file: 'src/中文 a.ts', line: 6 })
  assert.deepEqual(fileTarget('../src/demo.ts', undefined, { cwd: '/workspace/demo', current: '/workspace/demo/nested' }), { file: 'src/demo.ts' })
  assert.deepEqual(fileTarget('/workspace/demo/src/a.ts', { line: 1 }, { cwd: '/workspace/demo' }), { file: 'src/a.ts', line: 0 })
  assert.deepEqual(fileTarget('C:\\Demo\\src\\a.ts', undefined, { cwd: 'c:\\demo' }), { file: 'src/a.ts' })
  assert.deepEqual(fileTarget('\\\\server\\share\\src\\a.ts', undefined, { cwd: '//server/share' }), { file: 'src/a.ts' })
  assert.deepEqual(fileTarget('/workspace/else/a.ts', undefined, { cwd: '/workspace/demo' }), { file: '/workspace/else/a.ts' })
  assert.deepEqual(fileTarget('./a.ts'), { file: 'a.ts' })
  assert.deepEqual(fileTarget('/src/a.ts', undefined, { cwd: '/' }), { file: 'src/a.ts' })
  assert.deepEqual(fileTarget('src/a.ts', undefined, { cwd: '/' }), { file: 'src/a.ts' })
  assert.deepEqual(fileTarget('C:\\src\\a.ts', undefined, { cwd: 'c:\\' }), { file: 'src/a.ts' })
  assert.deepEqual(fileTarget('outside.ts', undefined, { cwd: '/workspace/demo', current: '/' }), { file: '/outside.ts' })
})

test('导航以原会话为单位，交给官方 openView 等待工作台挂载，不写全局选择', () => {
  const navigation = createFileNavigation(), calls: unknown[] = []
  assert.equal(navigation.open('a', { file: 'a.ts' }), false)
  const release = navigation.bind('a', (...args: unknown[]) => calls.push(args))
  navigation.bind('b', () => assert.fail('不应切换其他会话'))
  assert.equal(navigation.open('a', { file: 'a.ts', line: 2 }), true)
  assert.deepEqual(calls, [['super-code-workbench', '{"file":"a.ts","line":2}']])
  release(); assert.equal(navigation.has('a'), false)
})

test('导航重新绑定后旧组件清理不会删除新句柄', () => {
  const navigation = createFileNavigation(), previous = navigation.bind('a', () => {})
  navigation.bind('a', () => {}); previous()
  assert.equal(navigation.has('a'), true)
})

test('文件提及复用官方识别服务，只对应已结束的最终回复，不猜测或跨轮串联', () => {
  const opened: unknown[] = [], turn = (status: string, seq?: number) => ({ status, data: { get: () => seq === undefined ? undefined : { closing: { finalNode: { seq } } } } })
  const finished = turn('closed', 3), running = turn('open', 6), empty = turn('closed')
  const resolver = { resolve: () => undefined }, calls: any[] = []
  const provider = { forClosing(owner: any, id: string) { calls.push({ owner, id }); return resolver } }
  const chat = { timeline: { turns: new Map([[1, finished], [2, running], [3, empty]]) } }
  const result = closingFileMentions(chat, provider, 'a', (path: string) => opened.push(path))
  assert.equal(result.size, 1); assert.equal(result.get(3), resolver)
  assert.equal(calls[0].owner.turn, finished); assert.equal(calls[0].id, 'a')
  calls[0].owner.openFile('src/a.ts'); assert.deepEqual(opened, ['src/a.ts'])
  assert.equal(closingFileMentions(chat, undefined, 'a', () => {}).size, 0)
})

test('文件资源路由实时遵守两个开关，并通过原会话跳转后关闭中转预览', async () => {
  const { transformSync } = await import('esbuild')
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const module = { exports: {} as any }, definitions: any[] = [], registrations: any[] = [], cleanup: any[] = []
  const code = transformSync(readFileSync(new URL('../../../builtin/workbench/file-links.js', import.meta.url), 'utf8'), { format: 'cjs' }).code
  runInNewContext(code, { module, exports: module.exports, require: () => ({ createElement: () => null, useEffect: (run: () => unknown) => { cleanup.push(run()) } }) })
  let state = { enabled: true, openFiles: false }
  const store = {}, session = { store, inject: () => ({}) }
  const ctx = {
    effect: (run: () => unknown) => run(),
    slots: {
      entries: () => [session], inject: (_name: string, run: () => unknown) => run(),
      register: (options: any, component: any) => { registrations.push({ options, component }); return () => {} },
    },
    sidebarRightTabs: { register: (definition: any) => { definitions.push(definition); return () => {} } },
  }
  module.exports.registerFileNavigation(ctx, { preference: { snapshot: () => state }, fileContext: () => ({ cwd: '/project' }), t: (key: string) => key })
  const bridge = registrations.find(item => item.options.id === 'super-code-file-navigation'), resource = registrations.find(item => item.options.key === 'super-code-workbench-file')
  assert.equal(bridge.options.store, store); assert.equal(bridge.options.inject, session.inject)
  const opened: any[] = []
  bridge.component({ sessionId: 's', openView: (...args: any[]) => opened.push(args) })
  const address = 'dsh-resource://file/session/s/src/a.ts'
  assert.equal(definitions[0].canOpen(address), false)
  state = { enabled: true, openFiles: true }; assert.equal(definitions[0].canOpen(address), true)
  state = { enabled: false, openFiles: true }; assert.equal(definitions[0].canOpen(address), false)
  state = { enabled: true, openFiles: true }
  let closed = false
  resource.component({ useTabInfo: () => ({ tab: { visible: true, contentId: address, navigation: { revision: 1, params: { line: 5 } }, actions: { close: () => { closed = true } } } }) })
  assert.deepEqual(opened, [['super-code-workbench', '{"file":"src/a.ts","line":4}']]); assert.equal(closed, true)
  assert.equal(registrations.some(item => item.options.id === 'chat'), false)
  for (const dispose of cleanup) dispose?.()
  assert.equal(definitions[0].canOpen(address), false)
})
