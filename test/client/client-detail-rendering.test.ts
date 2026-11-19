import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function fixture(modern: boolean) {
  const cells: any[] = [], slots: any[] = []
  let cursor = 0, enumerations = 0, plugin: any
  const memo = (read: () => any, deps: any[]) => {
    const index = cursor++, previous = cells[index]
    if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) cells[index] = { deps, value: read() }
    return cells[index].value
  }
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children: children.flat() }),
    forwardRef: () => 'button', useMemo: memo,
    useRef: (current: any) => memo(() => ({ current }), []),
    useState: (initial: any) => {
      const box = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), [])
      return [box.value, (value: any) => { box.value = typeof value === 'function' ? value(box.value) : value }]
    },
    useEffect: () => {}, useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe: any, read: any) => read(),
  }
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? react : {}) } },
  })
  const context = {
    effect: () => {}, remote: { $mount: async () => () => {}, superCodeMemory: {} }, settingsScope: { bind: () => ({}) },
    inject: (_dependencies: string[], run: any) => { if (_dependencies.join(',') !== 'sessions,sidebarRightTabs') run(context) }, sessions: {}, sidebarRight: {},
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (_name: string, register: any) => {
      const value = register(); if (value?.[Symbol.iterator]) for (const _ of value) { /* 完成页签注册。 */ }
    }, register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
  }
  plugin.apply(context)
  const slot = slots.find(row => row.config.key === 'dsh-super-code-detail' && row.config.name === 'sidebar.right.pane.tab')
  assert.ok(slot)
  const observed = (value: object) => new Proxy(value, { ownKeys: target => { enumerations++; return Reflect.ownKeys(target) } })
  let catalog: any = { current: 'root', byId: observed({ root: observed({ id: 'root', title: '原标题' }) }),
    ...(modern ? { projectionsBySession: {} } : { subagentsByParent: {} }) }
  let statuses = new Map(), snapshot: any = { status: 'ready', items: [], projections: {} }
  const tab = { signal: new AbortController().signal, visible: true, contentId: 'dsh-resource://super-agent/root' }
  const props = { useTabInfo: () => ({ tab }), useSessions: (select: any) => select(catalog),
    useSessionStatus: (select: any) => select(statuses), sessionId: 'root', detailStates: new WeakMap(),
    createInspector: () => ({ getSnapshot: () => snapshot, subscribe: () => () => {}, start() {}, dispose() {} }), openMemory() {} }
  const render = () => { cursor = 0; return slot.component(props) }
  const elements = (value: any, matches: (node: any) => boolean): any[] => !value || typeof value !== 'object' ? []
    : [...(matches(value) ? [value] : []), ...(value.children || []).flatMap((child: any) => elements(child, matches))]
  return { render, elements, reads: () => enumerations,
    stream: () => { snapshot = { ...snapshot, projections: { tokenUsage: { uncachedInputTokens: 12, outputTokens: 5 } } } },
    rename: () => { catalog = { ...catalog, byId: observed({ root: observed({ id: 'root', title: '新标题' }) }) } },
    status: () => {
      statuses = new Map([['root', { running: true }]])
      if (!modern) catalog = { ...catalog, byId: observed({ root: observed({ id: 'root', title: '新标题', running: true }) }) }
      else catalog = { ...catalog, projectionsBySession: { root: { state: 'idle', values: {} } } }
    },
    navigate: () => { props.sessionId = 'other'; tab.contentId = 'dsh-resource://super-agent/other' },
  }
}

for (const modern of [false, true]) test(`详情在${modern ? '投影' : '旧'}目录中复用会话树，消息与目录变化仍更新`, () => {
  const f = fixture(modern)
  const first = f.render(), reads = f.reads()
  assert.ok(reads > 0)
  assert.equal(f.elements(first, node => node.type === 'h2')[0].children[0], '原标题')
  f.stream()
  const streamed = f.render()
  assert.equal(f.reads(), reads, '消息快照变化不应重新遍历会话目录')
  assert.ok(f.elements(streamed, node => node.type === 'strong').some(node => node.children.includes('17')))
  f.rename()
  const renamed = f.render()
  assert.ok(f.reads() > reads)
  assert.equal(f.elements(renamed, node => node.type === 'h2')[0].children[0], '新标题')
  const beforeStatus = f.reads()
  f.status()
  const running = f.render()
  assert.ok(f.reads() > beforeStatus)
  assert.equal(f.elements(running, node => node.props?.className === 'dsh-super-code-detail-status')[0].props['data-tone'], 'active')
  f.navigate()
  const navigated = f.render()
  assert.equal(navigated.props['data-agent-detail'], 'other')
  assert.equal(f.elements(navigated, node => node.type === 'h2')[0].children[0], 'other')
})
