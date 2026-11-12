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
  runInNewContext(readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8'), {
    URL, ResizeObserver: class { observe() {} disconnect() {} }, window: { crypto: { randomUUID: () => '12345678-abcd-abcd-abcd-123456789abc' },
      __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? react : {}) } } },
  })
  const render = (component: Function, props: any, attach?: (tree: any) => void) => {
    cursor = 0; effects = []
    const tree = component(props)
    attach?.(tree)
    for (const effect of effects) effect()
    return tree
  }
  const unmount = () => { for (const hook of hooks) hook?.cleanup?.(); hooks.length = 0 }
  return { plugin, render, unmount }
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

for (const linked of [false, true]) test(`memory ${linked ? 'keeps an explicitly addressed session' : 'clears the previous selection when following another session'}`, async () => {
  const { plugin, render } = fixture(), memoryStates = new WeakMap()
  let current = 'first'
  const tab = { signal: {}, visible: true, contentId: linked
    ? plugin.memoryLibraryAddress('first', { topic: 'notes', id: 'entry' }) : 'sidebar://super-agent-agents' }
  const saved: any = { selected: { topic: 'notes', id: 'entry' }, query: 'First session search', topicFilter: 'notes', top: 152, detailTop: 200 }
  memoryStates.set(tab.signal, saved)
  const reads: string[] = []
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async (id: string) => {
      reads.push(id)
      return { ok: true, value: { kind: 'found', entry: { topic: 'notes', id: 'entry', summary: 'Current memory',
        kind: 'constraint', detail: 'Content', source: { kind: 'manual', sessionId: id } } } }
    },
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current }), t: (key: string) => key }
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  current = 'second'
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  if (linked) {
    assert.equal(saved.selected.id, 'entry')
    assert.equal(saved.query, 'First session search')
    assert.equal(saved.topicFilter, 'notes')
    assert.deepEqual(reads, ['first'])
  } else {
    assert.equal(saved.selected, null, 'a selection from another session must not leak into the current library')
    assert.equal(saved.query, '')
    assert.equal(saved.topicFilter, '')
    assert.equal(saved.top, 0)
    assert.equal(saved.detailTop, 0)
  }
})

test('global memory keeps its selection when the current conversation changes', async () => {
  const { plugin, render } = fixture(), memoryStates = new WeakMap()
  let current = 'first'
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const saved: any = { scope: 'global', selected: { topic: 'preferences', id: 'entry' }, topicFilter: 'preferences' }
  memoryStates.set(tab.signal, saved)
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async () => ({ ok: true, value: { kind: 'missing' } }),
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current }), t: (key: string) => key }
  render(plugin.MemoryLibrary, props); await tick()
  current = 'second'
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  assert.equal(saved.selected.id, 'entry')
  assert.equal(saved.scope, 'global')
  assert.equal(saved.topicFilter, 'preferences')
})

for (const finish of ['cancel', 'save']) test(`memory retains a draft's original session until ${finish} after the current session changes`, async () => {
  const { plugin, render } = fixture(), memoryStates = new WeakMap()
  let current = 'first'
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const saved: any = { selected: { topic: 'notes', id: 'old' }, topicFilter: 'notes' }
  memoryStates.set(tab.signal, saved)
  const writes: any[] = []
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async () => ({ ok: true, value: { kind: 'missing' } }),
    saveEntry: async (...args: any[]) => { writes.push(args); return { ok: true, value: { kind: 'saved' } } },
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current }), t: (key: string) => key }
  render(plugin.MemoryLibrary, props); await tick()
  const editor = saved.editorStore
  editor.update({ draft: { sessionId: 'first', scope: 'project', topic: 'notes', id: 'new', expected: '',
    kind: 'constraint', summary: 'Draft', detail: 'Keep this content' } })
  render(plugin.MemoryLibrary, props)
  current = 'second'
  render(plugin.MemoryLibrary, props); await tick()
  assert.equal(editor.getSnapshot().draft.sessionId, 'first')
  assert.equal(editor.getSnapshot().draft.detail, 'Keep this content')
  assert.equal(saved.selected.id, 'old', 'following navigation waits until editing finishes')
  if (finish === 'save') await editor.save()
  else editor.update({ draft: null })
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  assert.equal(saved.selected, null)
  assert.equal(saved.topicFilter, '')
  assert.equal(saved.sessionId, 'second')
  assert.equal(writes.length, finish === 'save' ? 1 : 0)
  if (finish === 'save') assert.deepEqual(writes[0].slice(0, 4), ['first', 'project', 'notes', 'new'])
})

for (const timing of ['save-after-remount', 'remount-during-save', 'complete-while-hidden']) test(`memory navigation waits for retained editing during ${timing}`, async () => {
  const { plugin, render, unmount } = fixture(), memoryStates = new WeakMap()
  let current = 'first', release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const saved: any = { selected: { topic: 'notes', id: 'old' }, topicFilter: 'notes' }
  memoryStates.set(tab.signal, saved)
  const reads: any[] = [], writes: any[] = []
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async (...args: any[]) => { reads.push(args); return { ok: true, value: { kind: 'missing' } } },
    saveEntry: async (...args: any[]) => { writes.push(args); await held; return { ok: true, value: { kind: 'saved' } } },
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current }), t: (key: string) => key }
  render(plugin.MemoryLibrary, props); await tick()
  const editor = saved.editorStore
  editor.update({ draft: { sessionId: 'first', scope: 'project', topic: 'notes', id: 'new', expected: '',
    kind: 'constraint', summary: 'Retained draft', detail: 'Original session content' } })
  render(plugin.MemoryLibrary, props)
  const pending = timing === 'save-after-remount' ? null : editor.save()
  unmount(); current = 'second'
  if (timing === 'complete-while-hidden') { release(); await pending }
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  if (timing !== 'complete-while-hidden') {
    const waitingSession = saved.sessionId
    release()
    if (pending) await pending
    else await editor.save()
    assert.equal(waitingSession, 'first', 'mounting must not consume navigation while editing is retained')
  }
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  assert.equal(saved.sessionId, 'second')
  assert.equal(saved.selected, null)
  assert.equal(saved.topicFilter, '')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].slice(0, 4), ['first', 'project', 'notes', 'new'])
  assert.equal(reads.some(args => args[0] === 'second' && args[3] === 'new'), false)
})

for (const finish of ['cancel', 'remove']) test(`retained memory deletion stays on its original session across remount until ${finish}`, async () => {
  const { plugin, render, unmount } = fixture(), memoryStates = new WeakMap()
  let current = 'first'
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const saved: any = { selected: { topic: 'notes', id: 'old' }, topicFilter: 'notes' }
  memoryStates.set(tab.signal, saved)
  const writes: any[] = []
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async () => ({ ok: true, value: { kind: 'missing' } }),
    deleteEntry: async (...args: any[]) => { writes.push(args); return { ok: true, value: { kind: 'removed' } } },
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current }), t: (key: string) => key }
  render(plugin.MemoryLibrary, props); await tick()
  const editor = saved.editorStore
  editor.update({ confirmation: { sessionId: 'first', scope: 'project', topic: 'notes', id: 'old', expected: 'token', summary: 'Original entry' } })
  render(plugin.MemoryLibrary, props); unmount(); current = 'second'
  render(plugin.MemoryLibrary, props); await tick()
  const waitingSession = saved.sessionId
  if (finish === 'remove') await editor.remove()
  else editor.update({ confirmation: null })
  render(plugin.MemoryLibrary, props); await tick(); render(plugin.MemoryLibrary, props)
  assert.equal(waitingSession, 'first')
  assert.equal(saved.sessionId, 'second')
  assert.equal(saved.selected, null)
  assert.equal(writes.length, finish === 'remove' ? 1 : 0)
  if (finish === 'remove') assert.deepEqual(writes[0], ['first', 'project', 'notes', 'old', 'token'])
})


for (const retry of [false, true]) test(`memory restores its list position after delayed ${retry ? 'failed loading and retry' : 'loading'}`, async () => {
  const { plugin, render } = fixture(), memoryStates = new WeakMap()
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const saved: any = { top: 1520 }
  memoryStates.set(tab.signal, saved)
  let release!: () => void, requests = 0, top = 0, maximum = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const items = Array.from({ length: 180 }, (_, i) => ({ topic: 'notes', id: `entry-${i}`, summary: `Memory ${i}`, kind: 'constraint' }))
  const api = { list: async () => {
    const first = requests++ === 0
    if (first) await gate
    return first && retry ? { ok: false } : { ok: true, value: { items } }
  } }
  const element = { clientHeight: 600, get scrollTop() { return top }, set scrollTop(value: number) { top = Math.max(0, Math.min(maximum, value)) } }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current: 'first' }), t: (key: string) => key }
  const paint = () => render(plugin.MemoryLibrary, props, tree => {
    const list = nodes(tree).find(node => node.props.className === 'dsh-super-code-memory-list')
    maximum = list.props['aria-busy'] || !nodes(list).some(node => node.props.role === 'listitem') ? 0 : 13080
    list.props.ref.current = element
  })
  paint()
  assert.equal(top, 0, 'an unloaded list cannot scroll')
  assert.equal(saved.top, 1520, 'loading retains the intended reading position')
  release(); await tick()
  let tree = paint()
  if (retry) {
    assert.ok(nodes(tree).some(node => node.props.role === 'alert'))
    const refresh = nodes(tree).find(node => node.props['aria-label'] === 'memory.refresh')
    refresh.props.onClick()
    paint(); await tick(); tree = paint()
  }
  assert.equal(top, 1520, 'the list restores the retained position once rows can provide the scroll extent')
  assert.equal(saved.top, 1520)
  assert.equal(requests, retry ? 2 : 1)
  assert.ok(nodes(tree).some(node => node.props.role === 'listitem'))
})

for (const late of ['success', 'failure'] as const) test(`a late ${late} from the previous memory scope cannot replace the current list`, async () => {
  const { plugin, render, unmount } = fixture(), memoryStates = new WeakMap()
  const tab = { signal: {}, visible: true, contentId: 'sidebar://super-agent-agents' }
  const gate = Promise.withResolvers<void>(), scopes: string[] = []
  const item = (scope: string) => ({ topic: scope === 'global' ? 'preferences' : 'notes', id: scope, summary: `${scope} entry`, kind: 'constraint' })
  const api = { list: async (_session: string, scope: string) => {
    scopes.push(scope)
    if (scope === 'project') {
      await gate.promise
      if (late === 'failure') throw new Error('Previous scope is unavailable')
    }
    return { ok: true, value: { items: [item(scope)] } }
  } }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current: 'session' }), t: (key: string) => key }
  try {
    const initial = render(plugin.MemoryLibrary, props)
    nodes(initial).find(node => node.props.onClick && node.children.includes('memory.global')).props.onClick()
    render(plugin.MemoryLibrary, props); await tick()
    const before = render(plugin.MemoryLibrary, props)
    assert.ok(nodes(before).some(node => node.children.includes('global entry')))
    gate.resolve(); await tick()
    const after = render(plugin.MemoryLibrary, props)
    assert.ok(nodes(after).some(node => node.children.includes('global entry')))
    assert.equal(nodes(after).some(node => node.children.includes('project entry') || node.props.role === 'alert'), false)
    assert.deepEqual(scopes, ['project', 'global'])
  } finally { gate.resolve(); unmount() }
})

for (const late of ['success', 'failure'] as const) test(`a late ${late} from the previous memory entry cannot replace a newly opened entry`, async () => {
  const { plugin, render, unmount } = fixture(), memoryStates = new WeakMap()
  const tab = { signal: {}, visible: true, contentId: plugin.memoryLibraryAddress('session', { topic: 'notes', id: 'old' }) }
  const gate = Promise.withResolvers<void>(), reads: string[] = []
  const api = {
    list: async () => ({ ok: true, value: { items: [] } }),
    read: async (_session: string, _scope: string, _topic: string, id: string) => {
      reads.push(id)
      if (id === 'old') { await gate.promise; if (late === 'failure') throw new Error('Previous entry is unavailable') }
      return { ok: true, value: { kind: 'found', entry: { topic: 'notes', id, kind: 'constraint', summary: id,
        detail: `${id} content`, source: { kind: 'manual', sessionId: 'session' } } } }
    },
  }
  const props = { api, memoryStates, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current: 'session' }), t: (key: string) => key }
  try {
    render(plugin.MemoryLibrary, props)
    tab.contentId = plugin.memoryLibraryAddress('session', { topic: 'notes', id: 'new' })
    render(plugin.MemoryLibrary, props); render(plugin.MemoryLibrary, props); await tick()
    assert.ok(nodes(render(plugin.MemoryLibrary, props)).some(node => node.children.includes('new content')))
    gate.resolve(); await tick()
    const tree = render(plugin.MemoryLibrary, props)
    assert.ok(nodes(tree).some(node => node.children.includes('new content')))
    assert.equal(nodes(tree).some(node => node.children.includes('old content') || node.props.role === 'alert'), false)
    assert.deepEqual(reads, ['old', 'new'])
  } finally { gate.resolve(); unmount() }
})
