import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { defaults } from '../../../builtin/workbench/editor/preferences.js'

async function fixture() {
  const effects: (() => void | (() => void))[] = [], listeners = new Map<string, Set<Function>>()
  const react = { createContext: () => ({}), useContext: () => null, useEffect: (run: () => any) => effects.push(run), useLayoutEffect: () => {}, useRef: (current: any) => ({ current }), useMemo: (run: () => any) => run(), useState: (value: any) => [typeof value === 'function' ? value() : value, () => {}], createElement: () => null }
  const built = await build({ entryPoints: [new URL('../../../builtin/workbench/components/Floating.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' })
  const require = createRequire(import.meta.url), module = { exports: {} as any }, body = {}
  runInNewContext(built.outputFiles[0].text, { module, exports: module.exports,
    require: (name: string) => name === 'react' ? react : name === 'react-dom' ? { createPortal: () => null } : require(name),
    document: { body, activeElement: body, addEventListener() {}, removeEventListener() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { innerWidth: 1200, innerHeight: 900,
      addEventListener(name: string, listener: Function) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener) },
      removeEventListener(name: string, listener: Function) { listeners.get(name)?.delete(listener) } },
  })
  return { ...module.exports, effects, listeners }
}

test('独立差异窗口沿用传入的关闭快捷键，卸载移除窗口监听', async () => {
  const { Floating, effects, listeners } = await fixture()
  let closed = 0, prevented = 0
  Floating({ title: 'Diff', preferences: { ...defaults(), shortcuts: { close: 'Ctrl-q' } }, close: () => closed++, t: (key: string) => key, Button: 'button' })
  const cleanups = effects.map(run => run()).filter(Boolean) as (() => void)[]
  const press = (key: string, ctrlKey = false) => {
    const event = { key, ctrlKey, preventDefault() { prevented++ }, stopImmediatePropagation() {} }
    for (const listener of listeners.get('keydown') || []) listener(event)
  }
  try {
    press('Escape'); assert.equal(closed, 0)
    press('q', true); assert.equal(closed, 1); assert.equal(prevented, 1)
  } finally { for (const cleanup of cleanups.reverse()) cleanup() }
  assert.equal(listeners.get('keydown')?.size, 0)
})
