import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbench } from '../../../builtin/workbench/controller.js'
import { readToolbar } from '../../../builtin/workbench/toolbar.js'

test('未打开编辑器的修改文件侧栏也读取已保存主题，不访问项目或模型', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const saved = { palette: 'vscode', keymap: 'idea', shortcuts: {} }
  let reads = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { reads++; if (key === 'dsh-super-code-workbench-layout') return null; assert.equal(key, 'dsh-super-code-workbench'); return JSON.stringify(saved) },
    setItem() { assert.fail('显示侧栏不应重写偏好') },
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const api = new Proxy({}, { get: () => () => { assert.fail('仅显示主题不应访问工作目录或模型') } })
  const workbench = createWorkbench(api, (key: string) => key)
  t.after(() => workbench.dispose())
  assert.deepEqual(workbench.snapshot().preferences, { ...saved, density: 'comfortable', autoSave: 'manual', undoLimit: 1000, toolbar: readToolbar(), showToolbarShortcuts: false, showToolNames: true, windowMode: 'internal', followFile: true, previewTabs: true, fontFamily: 'jetbrains', chineseFontFamily: 'system', fontSize: 14, lineHeight: 1.5, readerMode: false, stickyScroll: true, quickReasoning: 'off', translationReasoning: 'off' })
  assert.equal(reads, 2)
  assert.equal(workbench.view(), undefined)
  assert.equal(workbench.documents.size, 0)
})

test('侧栏读到无效偏好时保留默认主题并提示，不覆盖保存内容', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { return '{invalid' }, setItem() { assert.fail('不应覆盖无效偏好') },
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const workbench = createWorkbench({}, (key: string) => key)
  t.after(() => workbench.dispose())
  assert.equal(workbench.snapshot().preferences.palette, 'idea')
  assert.equal(workbench.snapshot().error, 'settingInvalid')
})

test('文件表单通过原控制器提交，非法名称保留输入并释放忙碌状态', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const workbench = createWorkbench({ fileOperation() { assert.fail('非法名称不得调用文件操作') } }, (key: string) => key)
  t.after(() => workbench.dispose())
  for (const name of ['', '.', '..', '../outside', 'a/b', 'a\\b', 'a\0b']) {
    workbench.panel({ kind: 'fileAction', id: name, action: 'createFile', name })
    await workbench.submitFileAction()
    assert.equal(workbench.snapshot().panel.name, name)
    assert.equal(workbench.snapshot().panel.busy, false)
    assert.equal(workbench.snapshot().panel.error, 'WORKBENCH_FILE_NAME')
  }
  workbench.panel(null)
  await workbench.submitFileAction()
  assert.equal(workbench.snapshot().panel, null)
})

test('文件导航等待目录绑定与重复挂载就绪，但不等待后台整库索引', async t => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const { runInThisContext } = await import('node:vm')
  const require = createRequire(import.meta.url)
  const result = await build({
    entryPoints: [new URL('../../../builtin/workbench/controller.js', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'headless-editor', setup(build) {
      build.onResolve({ filter: /editor\/view\.js$/ }, () => ({ path: 'editor', namespace: 'headless' }))
      build.onLoad({ filter: /.*/, namespace: 'headless' }, () => ({ contents: `
        import { EditorState } from '@codemirror/state';
        export function createEditor() {
          const view = { state: EditorState.create(), focus() {}, dispatch(spec) { this.state = this.state.update(spec).state; } };
          return { view, capture: () => view.state, state: async (_file, source) => EditorState.create({doc:source().text}), show: state => {view.state=state}, preferences() {}, readonly() {}, dispose() {} };
        }`, resolveDir: new URL('../../../', import.meta.url).pathname }))
    } }],
  })
  const module = { exports: {} as any }
  runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`)(require, module, module.exports)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage') })
  let release!: (value: any) => void, releaseRoot!: (value: any) => void, scanStarted = false, reads = 0
  const scan = new Promise(resolve => { release = resolve })
  const root = new Promise(resolve => { releaseRoot = resolve })
  const workbench = module.exports.createWorkbench({
    fileOperation: () => root,
    project: () => { scanStarted = true; return scan },
    list: async () => ({ entries: [], truncated: false }),
    read: async (path: string) => { reads++; return { path, text: 'first\nsecond\nthird\n', version: '1' } },
  }, (key: string) => key)
  t.after(() => { releaseRoot({ path: '/project' }); release({ files: [], truncated: false }); workbench.dispose() })
  const parent = {}, ready = workbench.attach(parent, {})
  let repeatedReady = false
  const repeated = workbench.attach(parent, {}).then(() => { repeatedReady = true })
  const visiting = workbench.visit({ file: 'src/中文 文件.ts', line: 1 })
  const pendingNavigation = assert.doesNotReject(visiting)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 0, '目录绑定完成前不读取文件')
  assert.equal(repeatedReady, false, '同一编辑器重复挂载不能提前报告就绪')
  releaseRoot({ path: '/project' })
  const state = await Promise.race([ready.then(() => 'ready'), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))])
  assert.equal(scanStarted, true)
  assert.equal(state, 'ready', '文件导航只等编辑器就绪，不等 project 索引返回')
  assert.equal(workbench.snapshot().indexing, true)
  await repeated; await pendingNavigation
  assert.equal(workbench.snapshot().file, 'src/中文 文件.ts')
  assert.equal(workbench.snapshot().cursor.line, 1)
  assert.equal(workbench.snapshot().indexing, true)
})

test('后台项目扫描尚未完成时先显示根文件列表，慢索引不阻挡文件浏览', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  let release!: (value: any) => void
  const project = new Promise(resolve => { release = resolve })
  const workbench = createWorkbench({
    project: () => project,
    list: async () => ({ entries: [{ name: 'main.ts', path: 'main.ts', type: 'file' }], truncated: false }),
  }, (key: string) => key)
  t.after(() => workbench.dispose())
  const refreshing = workbench.refresh()
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workbench.snapshot().indexing, true)
    assert.deepEqual(workbench.snapshot().directories.get('')?.entries, [{ name: 'main.ts', path: 'main.ts', type: 'file' }])
  } finally {
    release({ files: [], truncated: false })
    await refreshing
  }
  assert.equal(workbench.snapshot().indexing, false)
})
