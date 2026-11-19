import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import { defaults } from '../../../builtin/workbench/editor/preferences.js'

async function toolbar() {
  const built = await build({ entryPoints: [new URL('../../../builtin/workbench/components/Toolbar.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' })
  const react = { createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat() }), useRef: (current: any) => ({ current }), useState: (value: any) => [value, () => {}], useLayoutEffect: () => {} }
  const require = createRequire(import.meta.url), module = { exports: {} as any }
  runInThisContext(`(function(require,module,exports){${built.outputFiles[0].text}\n})`)((name: string) => name === 'react' ? react : require(name), module, module.exports)
  return module.exports.Toolbar
}

function find(node: any, action: string): any {
  if (node?.props?.['data-toolbar-action'] === action) return node
  return node?.children?.map((child: any) => find(child, action)).find(Boolean)
}

test('工具栏保存先恢复编辑器焦点，保存拒绝仍交给统一错误处理', async () => {
  const Toolbar = await toolbar(), calls: string[] = [], failure = new Error('write unavailable')
  const workbench = { view: () => ({ focus: () => calls.push('focus') }), save: async () => { calls.push('save'); throw failure }, fail: (error: Error) => { assert.equal(error, failure); calls.push('error') } }
  const tree = Toolbar({ workbench, snapshot: { preferences: defaults() }, current: { dirty: true }, Button: 'button', t: (key: string) => key })
  const button = find(tree, 'save')
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['focus', 'save', 'error'])
})

test('右侧固定按钮依次为保存、Git、刷新、独立窗口、编辑器设置，没有学习入口', async () => {
  const Toolbar = await toolbar()
  const tree = Toolbar({ workbench: {}, snapshot: { preferences: defaults() }, current: null, Button: 'button', t: (key: string) => key })
  function fixed(node: any): any {
    if (node?.props?.className?.includes('sc-wb-toolbar-fixed')) return node
    return node?.children?.map(fixed).find(Boolean)
  }
  assert.deepEqual(fixed(tree).children.map((child: any) => child.props['data-toolbar-action']), ['save', 'git', 'refresh', 'window', 'settings'])
  assert.equal(find(tree, 'reading'), undefined)
})
