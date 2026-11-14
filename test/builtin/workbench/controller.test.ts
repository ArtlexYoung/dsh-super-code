import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbench } from '../../../builtin/workbench/controller.js'

test('未打开编辑器的修改文件侧栏也读取已保存主题，不访问项目或模型', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const saved = { palette: 'vscode', keymap: 'idea', shortcuts: {} }
  let reads = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { reads++; assert.equal(key, 'dsh-super-code-workbench'); return JSON.stringify(saved) },
    setItem() { assert.fail('显示侧栏不应重写偏好') },
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const api = new Proxy({}, { get: () => () => { assert.fail('仅显示主题不应访问工作目录或模型') } })
  const workbench = createWorkbench(api, (key: string) => key)
  t.after(() => workbench.dispose())
  assert.deepEqual(workbench.snapshot().preferences, { ...saved, autoSave: 'manual', undoLimit: 1000 })
  assert.equal(reads, 1)
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
