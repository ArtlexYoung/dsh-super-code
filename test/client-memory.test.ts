import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function fixture() {
  let plugin: any, cursor = 0, effects: Function[] = []
  const hooks: any[] = []
  const react = {
    Fragment: 'fragment', forwardRef: () => 'button',
    createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item !== false && item != null) }),
    useState: (initial: any) => {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], (value: any) => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value }]
    },
    useRef: (initial: any) => {
      const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]
    },
    useMemo: (factory: Function, deps: any[]) => {
      const i = cursor++, old = hooks[i]
      if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) hooks[i] = { deps, value: factory() }
      return hooks[i].value
    },
    useEffect: (effect: Function, deps: any[]) => {
      const i = cursor++, old = hooks[i]
      if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) {
        effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: effect() } })
      }
    },
    useLayoutEffect: (effect: Function, deps: any[]) => react.useEffect(effect, deps),
    useSyncExternalStore: (_subscribe: Function, snapshot: Function) => snapshot(),
  }
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL, window: { crypto: { randomUUID: () => '12345678-abcd-abcd-abcd-123456789abc' },
      __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? react : {}) } } },
  })
  const render = (component: Function, props: any) => {
    cursor = 0; effects = []
    const tree = component(props)
    for (const effect of effects) effect()
    return tree
  }
  return { plugin, render }
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children || []).flatMap(nodes)]
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('public memory reads existing entries without exposing experimental migration', async () => {
  const { plugin, render } = fixture(), memoryStates = new WeakMap()
  const tab: any = { signal: {}, contentId: plugin.memoryLibraryAddress('original', { topic: 'preferences', id: 'old', scope: 'global' }), visible: true }
  const calls: any[] = []
  const versioned = () => { throw new Error('The public memory page must not access experimental APIs') }
  const api = {
    list: async (...args: any[]) => { calls.push(['list', ...args]); return { ok: true, value: { items: [] } } },
    read: async (...args: any[]) => { calls.push(['read', ...args]); return { ok: true, value: { kind: 'found', entry: { topic: 'preferences', id: 'old', kind: 'constraint', summary: 'Existing preference', detail: 'Keep replies concise', source: { kind: 'manual', sessionId: 'original' } } } } },
    readVersioned: versioned, listVersioned: versioned, saveVersioned: versioned,
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current: 'original' }), t: (key: string) => key }
  memoryStates.set(tab.signal, { library: 'skills' })
  render(plugin.MemoryLibrary, props)
  await tick()
  const tree = render(plugin.MemoryLibrary, props), all = nodes(tree)
  assert.equal(tree.props.className, 'dsh-super-code-memory')
  assert.ok(all.some(node => node.children.includes('Keep replies concise')))
  assert.deepEqual(calls, [['list', 'original', 'global'], ['read', 'original', 'global', 'preferences', 'old']])
  assert.equal('VersionedMemoryLibrary' in plugin, false)
  assert.equal(all.some(node => node.props.onImportLegacy), false)
  assert.equal(all.some(node => node.children.some((child: any) => ['vm.library', 'vm.users', 'vm.skills', 'vm.legacyHint', 'vm.import'].includes(child))), false)
})
