import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

interface Row { id: string; level: number }
interface Node { id: string; parentId?: string; mode?: string; title?: string; running?: boolean; unavailable?: boolean }
interface View { root: string; nodes: Map<string, Node>; children: Map<string, string[]>; ancestors: Set<string> }
interface Client {
  agentHistoryRange(range: string, from?: string, to?: string, now?: number): { start: number; end: number; valid: boolean }
  agentHistoryRows(view: View, hidden: string[], totals: Map<string, object>, options?: object): { id: string; time: number; tokens: number; partial: boolean }[]
  agentHistoryWindow(count: number, scrollTop: number, height: number): { top: number; start: number; end: number; height: number }
  default?: { inject?: string[]; apply?: unknown } | ((ctx: object) => void)
  inject: string[]
  buildAgentView(state: object): View
  agentTreeDisplay(view: View, catalogs?: object, options?: { expanded?: Set<string>; collapsed?: Set<string>; focused?: string; compact?: boolean }): { view: View; hidden: string[] }
  visibleAgentRows(view: View, expanded: (id: string) => boolean, limit: number): { rows: Row[]; more: boolean }
  agentTreeTotals(view: View, catalogs?: object): Map<string, { agents: number; tokens: number; cache: number; known: number; partial: boolean }>
  agentTreeLayout(view: View, limit: number): { rows: { id: string; x: number; y: number }[]; edges: object[]; more: boolean; width: number }
  agentExecutionStatus(node: Node | undefined, isRoot: boolean): { tone: string; label: string }
  apply(ctx: object): void
  agentDetailAddress(node: Node): string
  agentDetailTarget(address: string): object
  detailRecord(entry: object): { kind: string; label?: string; text?: string }
  createAgentInspector(create: (address: object, callbacks: any) => any, address: string, readPage: (request: any, signal: AbortSignal) => Promise<any>, initial?: object): any
}

function client(modules: Record<string, object> = {}): Client {
  let loaded: Client | undefined
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ id, factory }: { id: string; factory: (require: (id: string) => object) => Client }) => {
      assert.equal(id, 'dsh-super-code')
      loaded = factory(id => id === 'react' ? { forwardRef: () => 'button', ...modules.react } : modules[id] ?? {})
    } },
  })
  assert.ok(loaded)
  return loaded
}
const plugin = client()
const child = (id: string, extra = {}) => ({ id, kind: 'child', mode: 'one-shot', activity: 'inactive', ...extra })

test('history uses catalog creation times and filters local inclusive calendar dates', () => {
  const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime()
  const view = plugin.buildAgentView({ current: 'root', byId: { root: { id: 'root', projectionValues: { subagentCatalog: [
    { id: 'a', createdAt: at(20) }, { id: 'b', createdAt: at(19, 23) }, { id: 'c', createdAt: at(21) }, { id: 'invalid', createdAt: NaN },
  ] } } }, subagentsByParent: {
    root: { entries: [child('a'), child('b'), child('c'), child('unknown'), child('invalid')] },
  } })
  const hidden = ['a', 'b', 'c', 'unknown', 'invalid'], totals = new Map(), now = at(20, 12)
  const ids = (options: object) => plugin.agentHistoryRows(view, hidden, totals, { now, ...options }).map(row => row.id).join(',')
  assert.equal(ids({ range: 'today' }), 'a')
  assert.equal(ids({ range: 'custom', from: '2026-09-19', to: '2026-09-20' }), 'a,b')
  assert.equal(ids({ range: 'custom', from: '2026-09-21', to: '2026-09-19' }), '')
  assert.equal(ids({ range: 'custom', from: '2026-02-30' }), '')
  assert.equal(plugin.agentHistoryRows(view, hidden, totals).length, 5)
  assert.equal(plugin.agentHistoryRange('week', '', '', now).start, at(14))
  assert.equal(plugin.agentHistoryRange('month', '', '', now).start, at(-9))
  assert.equal(ids({ range: 'custom', to: '2026-09-19' }), 'b')
})

test('history sorts known values in both directions, keeps missing values last and searches parents', () => {
  const view = plugin.buildAgentView({ current: 'root', byId: { root: { id: 'root', title: '父任务' },
    a: { id: 'a', parentId: 'root', title: 'Task 2', createdAt: 20 },
    b: { id: 'b', parentId: 'root', title: 'Task 10', createdAt: 10 },
    c: { id: 'c', parentId: 'root', title: 'Task 1' } } })
  const hidden = ['c', 'b', 'a'], totals = new Map([['a', { tokens: 0, known: 1, agents: 1 }], ['b', { tokens: 12, known: 1, agents: 2 }]])
  const ids = (sort: string, query = '') => plugin.agentHistoryRows(view, hidden, totals, { sort, query }).map(row => row.id).join(',')
  assert.equal(ids('time-desc'), 'a,b,c')
  assert.equal(ids('time-asc'), 'b,a,c')
  assert.equal(ids('tokens-desc'), 'b,a,c')
  assert.equal(ids('tokens-asc'), 'a,b,c')
  assert.equal(ids('title-asc'), 'c,a,b')
  assert.equal(ids('title-desc'), 'b,a,c')
  assert.equal(ids('time-desc', '父任务'), 'a,b,c')
  assert.equal(ids('time-desc', ' TASK 2 '), 'a')
  assert.equal(ids('time-desc', 'absent'), '')
  assert.equal(plugin.agentHistoryRows(view, hidden, totals, { sort: 'tokens-desc' })[0].partial, true)
  assert.equal(hidden.join(','), 'c,b,a')
})

test('history virtualization bounds DOM work for 10000 rows and clamps shrinking results', () => {
  for (const top of [0, 5600, 280000, 560000, 9999999]) {
    const result = plugin.agentHistoryWindow(10000, top, 280)
    assert.ok(result.end - result.start <= 11)
    assert.ok(result.start <= Math.floor(result.top / 56))
    assert.ok(result.end >= Math.ceil((result.top + 280) / 56))
    assert.equal(result.height, 560000)
  }
  const shrunk = plugin.agentHistoryWindow(2, 560000, 280)
  assert.equal(shrunk.top, 0)
  assert.equal(shrunk.start, 0)
  assert.equal(shrunk.end, 2)
  assert.equal(plugin.agentHistoryWindow(0, 560000, 280).end, 0)
})

test('tree and detail share activity states without treating missing records as stopped', () => {
  const status = (node: Node | undefined, root = false) => plugin.agentExecutionStatus(node, root).label
  assert.equal(status({ id: 'root', running: false }, true), '待命')
  assert.equal(status({ id: 'child', mode: 'continuable', running: false }), '待命')
  assert.equal(status({ id: 'child', mode: 'one-shot', running: false }), '已停止')
  assert.equal(status({ id: 'child', running: true }), '运行中')
  assert.equal(status({ id: 'child', unavailable: true, running: false }), '记录不可用')
  assert.equal(status({ id: 'child' }), '记录不可用')
  assert.equal(status(undefined), '记录不可用')
})

test('hidden events advance pagination without notifying visible subscribers', async () => {
  let callbacks: any
  let notifications = 0
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, signal: new AbortController().signal, dispose: async () => {} }
  }, plugin.agentDetailAddress({ id: 'root' }), async request => {
    assert.equal(request.throughSeq, 10000)
    assert.equal(request.beforeSeq, 0)
    return { ok: true, value: { records: [], hasMore: false } }
  })
  callbacks.publish({ type: 'replace', entries: [], hasMore: true, page: {} })
  const initial = inspector.getSnapshot()
  inspector.subscribe(() => notifications++)
  for (let seq = 1; seq <= 10000; seq++) callbacks.publish({ type: 'append', entry: { event: { seq, type: 'assistant/chunk', data: {} } } })
  assert.equal(notifications, 0)
  assert.equal(inspector.getSnapshot(), initial)
  await inspector.older()
  assert.equal(inspector.getSnapshot().cursor, 10000)
  assert.equal(inspector.getSnapshot().earlier, true)
  inspector.dispose()
})

test('history keeps its requested boundary when live events arrive during pagination', async () => {
  let callbacks: any
  let finish: (value: object) => void = () => assert.fail('not paging')
  const boundaries: number[] = []
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, signal: new AbortController().signal, dispose: async () => {} }
  }, plugin.agentDetailAddress({ id: 'root' }), request => {
    boundaries.push(request.throughSeq)
    return new Promise(resolve => { finish = resolve })
  })
  const hidden = (seq: number) => ({ event: { seq, type: 'tool/call', data: {} } })
  callbacks.publish({ type: 'replace', entries: [hidden(10)], hasMore: true, page: {} })
  const pending = inspector.older()
  callbacks.publish({ type: 'append', entry: hidden(11) })
  finish({ ok: true, value: { records: [], hasMore: true } })
  await pending
  assert.equal(inspector.getSnapshot().cursor, 10)
  callbacks.publish({ type: 'append', entry: hidden(12) })
  const next = inspector.older()
  finish({ ok: true, value: { records: [], hasMore: false } })
  await next
  assert.deepEqual(boundaries, [10, 10])
  inspector.dispose()
})

test('browser loader resolves a plugin that retains its dependency declarations', () => {
  const resolved = plugin.default ?? plugin
  assert.ok('inject' in resolved)
  assert.ok(resolved.inject?.includes('slots'))
  assert.ok(resolved.inject?.includes('sidebarRightTabs'))
})

test('plugin settings stay expanded, compare versions in both languages and retain reinstallation confirmation', async () => {
  type Element = { type: unknown; props: Record<string, any>; children: unknown[] }
  const state: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => any)[] = []
  let cursor = 0, refCursor = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(state[index]) : value }]
    },
    useRef: (initial: unknown) => {
      const index = refCursor++
      return refs[index] ?? (refs[index] = { current: initial })
    },
    useEffect: (effect: () => any) => effects.push(effect), useLayoutEffect: () => {}, useMemo: (factory: () => unknown) => factory(), useSyncExternalStore: () => ({}),
  }
  const localPlugin = client({ react: React, '@deepseek-ai/dsh-client-ui-primitives': {
    IconChevronDownOutline14: 'chevron', IconRefreshOutline16: 'refresh',
  } })
  const pending: Promise<unknown>[] = []
  const dictionaries: Record<string, Record<string, string>> = {}
  let Settings: ((props: object) => Element) | undefined
  const ctx: any = {
    effect(callback: () => unknown, label: string) {
      if (label === 'dsh-super-code: dictionaries') callback()
      if (callback.constructor.name === 'AsyncFunction') pending.push(Promise.resolve(callback()))
    },
    locale: { register: (_namespace: string, values: Record<string, Record<string, string>>) => { Object.assign(dictionaries, values); return () => {} }, bind: () => (key: string) => key },
    settingsScope: { bind: () => ({ getSnapshot: () => ({ status: 'ready', value: { preference: 'zh' } }), subscribe: () => () => {} }) },
    remote: { $mount: async () => {} },
    inject: (_dependencies: string[], callback: (ready: any) => void) => callback(ctx),
    slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (config: { name: string }, component: (props: object) => Element) => {
        if (config.name === 'settings.section') Settings = component
        return () => {}
      },
    },
    sidebarRightTabs: { register: () => () => {} },
    sessions: { refreshSubagents: () => {}, setSubagentCatalogOpen: () => {}, list: { getSnapshot: () => ({}) } },
    sidebarRight: { openResource: () => {} },
  }
  localPlugin.apply(ctx)
  await Promise.all(pending)
  assert.ok(Settings)
  let language = 'zh'
  const t = (key: string) => key === 'preset.title' ? (language === 'zh' ? 'Super Code 模式' : 'Super Code') : key
  const submissions: string[][] = []
  const reinstalls: string[][] = []
  const api = { reinstallPreset: async (...args: string[]) => { reinstalls.push(args); return { ok: false } }, installPreset: async (...args: string[]) => {
    submissions.push(args)
    return { ok: true, value: { ok: false, error: 'name-taken', status: state[1] } }
  } }
  const render = (translate = t) => { cursor = 0; refCursor = 0; effects.length = 0; return Settings!({ api, t: translate }) }
  const find = (node: unknown, predicate: (element: Element) => boolean): Element[] => {
    if (!node || typeof node !== 'object' || !('type' in node)) return []
    const element = node as Element
    return [...predicate(element) ? [element] : [], ...element.children.flatMap(child => find(child, predicate))]
  }
  let card = render()
  assert.equal(card.type, 'section')
  assert.equal(find(card, element => element.type === 'button' && 'aria-expanded' in element.props).length, 0)
  assert.equal(find(card, element => element.type === 'form').length, 0)
  assert.equal(find(card, element => element.props.className === 'dsh-super-code-settings-body').length, 1)
  assert.equal(find(card, element => element.type === 'header').length, 1)
  state[4] = false
  const strings = (node: unknown): string => {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object' || !('children' in node)) return ''
    return (node as Element).children.map(strings).join('')
  }
  for (const currentLanguage of ['zh', 'en']) {
    const translate = (key: string) => dictionaries[currentLanguage][key]!
    for (const [presetVersion, expected] of [['0.3.1', 'match'], ['0.3.0', 'mismatch'], [undefined, 'unknown']]) {
      state[1] = { authorable: false, delivery: 'declaration', state: 'available', id: 'super-code', pluginVersion: '0.3.1', presetVersion }
      card = render(translate)
      const versions = find(card, element => element.type === 'dd')
      assert.equal(versions[0]?.children[0], '0.3.1')
      assert.equal(versions[1]?.children[0], presetVersion ?? translate('preset.versionUnknown'))
      assert.equal(find(card, element => element.props['data-version-state'] === expected).length, 1)
      assert.ok(strings(card).includes(translate('preset.declaredReadonly')))
      assert.ok(!strings(card).includes(translate('preset.readonly')))
      assert.equal(find(card, element => element.type === 'form').length, 0)
      if (expected === 'mismatch') assert.ok(strings(card).includes(translate('preset.versionReloadHint')))
    }
    for (const unavailable of ['missing', 'broken']) {
      state[1] = { authorable: false, delivery: 'declaration', state: unavailable, id: 'super-code', pluginVersion: '0.3.1' }
      card = render(translate)
      assert.ok(strings(card).includes(translate('preset.unavailableHint')))
      assert.ok(!strings(card).includes(translate('preset.installHint')))
      assert.ok(!strings(card).includes(translate('preset.availableHint')))
      if (unavailable === 'missing') assert.equal(find(card, element => element.type === 'dd')[1]?.children[0], translate('preset.versionMissing'))
    }
    state[1] = { authorable: true, delivery: 'directory', state: 'installed', id: 'super-code', pluginVersion: '0.3.1', presetVersion: '0.3.0' }
    card = render(translate)
    assert.ok(strings(card).includes(translate('preset.versionReinstallHint')))
    for (const installed of ['missing', 'installed', 'broken']) {
      state[1] = { authorable: true, delivery: 'declaration', state: installed, reinstallable: installed !== 'missing',
        id: 'super-code', name: translate('preset.title'), pluginVersion: '0.3.1', presetVersion: '0.3.0' }
      card = render(translate)
      assert.equal(find(card, element => element.type === 'form').length, 1)
      assert.equal(find(card, element => element.props.type === 'submit')[0]?.children[0], translate(installed === 'missing' ? 'preset.installDeclared' : 'preset.reinstall'))
      if (installed !== 'missing') assert.ok(strings(card).includes(translate('preset.versionReinstallHint')))
      assert.ok(!strings(card).includes(translate('preset.declaredHint')))
      assert.ok(!strings(card).includes(translate('preset.readonly')))
      assert.ok(strings(card).includes(translate('preset.declaredNameHint')))
    }
  }
  state[1] = { authorable: true, state: 'missing' }
  card = render()
  const display = () => find(card, element => element.props.id === 'super-code-display-name')[0]!
  assert.equal(display().props.value, 'Super Code 模式')
  assert.equal(find(card, element => element.props.id === 'super-code-preset-name')[0]?.props.value, 'super-code')
  language = 'en'; card = render()
  assert.equal(display().props.value, 'Super Code')
  display().props.onChange({ target: { value: 'My team' } })
  language = 'zh'; card = render()
  assert.equal(display().props.value, 'My team')
  display().props.onChange({ target: { value: 'Super Code 模式' } })
  state[4] = false // Status loading has completed.
  card = render()
  assert.equal(display().props.pattern, undefined)
  assert.equal(find(card, element => element.props.type === 'submit')[0]?.props.disabled, false)
  find(card, element => element.type === 'form')[0]!.props.onSubmit({ preventDefault() {} })
  await Promise.resolve()
  assert.deepEqual(submissions, [['super-code', 'Super Code 模式']])
  await new Promise(resolve => setImmediate(resolve))
  display().props.onChange({ target: { value: '   ' } })
  state[4] = false
  card = render()
  assert.equal(find(card, element => element.props.type === 'submit')[0]?.props.disabled, true)
  state[1] = { authorable: true, state: 'installed', id: 'old-code', name: '旧名称' }
  state[2] = null; state[3] = null
  state[4] = false
  card = render()
  assert.equal(display().props.value, '旧名称')
  assert.equal(find(card, element => element.props.id === 'super-code-preset-name')[0]?.props.value, 'old-code')
  display().props.onChange({ target: { value: '新模式' } })
  find(card, element => element.props.id === 'super-code-preset-name')[0]!.props.onChange({ target: { value: 'new-code' } })
  card = render()
  const statusRow = find(card, element => element.props.className === 'dsh-super-code-settings-status-row')[0]!
  assert.equal((statusRow.children[0] as Element).props.role, 'status')
  assert.equal((statusRow.children[1] as Element).props.className, 'dsh-super-code-settings-actions')
  assert.equal(find(card, element => element.props.type === 'submit')[0]!.children[0], 'preset.reinstall')
  find(card, element => element.type === 'form')[0]!.props.onSubmit({ preventDefault() {} })
  await Promise.resolve()
  assert.deepEqual(reinstalls, [], 'opening confirmation does not reinstall')
  card = render()
  const modal = () => find(card, element => element.type === 'dialog')[0]!
  const action = (key: string) => find(modal(), element => element.type === 'button' && element.children[0] === key)[0]!
  assert.ok(modal())
  assert.equal(find(modal(), element => element.type === 'input').length, 0, 'list has no add or edit input')
  const confirmationText = strings(modal())
  assert.ok(confirmationText.includes('old-code'))
  assert.ok(confirmationText.includes('新模式'))
  assert.ok(confirmationText.includes('new-code'))
  action('preset.remove').props.onClick()
  card = render()
  assert.equal(action('preset.confirm').props.disabled, true)
  action('preset.confirm').props.onClick()
  assert.deepEqual(reinstalls, [], 'empty selection never reinstalls')
  action('preset.cancel').props.onClick()
  card = render()
  assert.equal(modal(), undefined)
  find(card, element => element.type === 'form')[0]!.props.onSubmit({ preventDefault() {} })
  card = render()
  const listeners = new Map<string, (event: any) => void>()
  const nativeDialog = { open: false, ownerDocument: { defaultView: {
    addEventListener(type: string, callback: (event: any) => void, capture: boolean) { assert.equal(capture, true); listeners.set(type, callback) },
    removeEventListener(type: string, callback: (event: any) => void, capture: boolean) { assert.equal(capture, true); assert.equal(listeners.get(type), callback); listeners.delete(type) },
  } }, showModal() { this.open = true }, close() { this.open = false }, querySelector: () => ({ focus() {} }) }
  refs[0]!.current = nativeDialog
  const dispose = effects[0]!()
  let prevented = false, captured = false
  const escape = { key: 'Escape', target: nativeDialog.ownerDocument,
    preventDefault() { prevented = true }, stopPropagation() { captured = true } }
  listeners.get('keydown')!({ ...escape, key: 'Enter' })
  assert.equal(prevented, false)
  listeners.get('keydown')!({ ...escape, isComposing: true })
  assert.equal(prevented, false)
  listeners.get('keydown')!(escape)
  assert.ok(prevented && captured, 'Escape is captured even after removing the focused row')
  card = render()
  assert.equal(modal(), undefined)
  assert.deepEqual(reinstalls, [])
  dispose()
  assert.equal(nativeDialog.open, false)
  assert.equal(listeners.size, 0, 'capture listener is removed when the confirmation closes')
  find(card, element => element.type === 'form')[0]!.props.onSubmit({ preventDefault() {} })
  card = render()
  let stopped = false
  modal().props.onKeyDown({ key: 'Escape', stopPropagation() { stopped = true } })
  assert.equal(stopped, true, 'Escape keydown stays inside the confirmation')
  stopped = false
  modal().props.onCancel({ preventDefault() {}, stopPropagation() { stopped = true } })
  assert.equal(stopped, true, 'Escape must not close the parent settings dialog')
  card = render()
  assert.equal(modal(), undefined)
  assert.deepEqual(reinstalls, [], 'Escape cancels without side effects')
  find(card, element => element.type === 'form')[0]!.props.onSubmit({ preventDefault() {} })
  card = render()
  // Confirmation uses the reviewed snapshot even if the underlying form changes.
  display().props.onChange({ target: { value: 'Later edit' } })
  card = render()
  const confirm = action('preset.confirm')
  confirm.props.onClick()
  confirm.props.onClick()
  await Promise.resolve()
  assert.deepEqual(reinstalls, [['old-code', 'new-code', '新模式']])
})

test('agent view isolates the current tree and merges navigation metadata into existing summaries', () => {
  const view = plugin.buildAgentView({ current: 'a', byId: {
    a: { id: 'a', title: 'Root' }, b: { id: 'b', title: 'Summary', running: true },
    unrelated: { id: 'unrelated' }, otherChild: { id: 'otherChild', parentId: 'unrelated', origin: 'subagent' },
  }, subagentsByParent: { a: { entries: [child('b', { label: 'Worker', mode: 'continuable' })] } } })
  assert.deepEqual([...view.nodes.keys()].sort(), ['a', 'b'])
  assert.equal(view.nodes.get('b')?.mode, 'continuable')
  assert.equal(view.nodes.get('b')?.parentId, 'a')
  assert.equal(view.nodes.get('b')?.running, true)
  assert.equal(view.nodes.get('b')?.title, 'Worker')
})

test('child navigation retains ancestors even when the host only has an addressed child', () => {
  const view = plugin.buildAgentView({ current: 'c', byId: { c: { id: 'c' } },
    currentAddress: { parentSessionId: 'b', childSessionId: 'c', mode: 'continuable' },
    subagentsByParent: { a: { entries: [child('b')] } } })
  assert.equal(view.root, 'a')
  assert.deepEqual([...view.ancestors], ['c', 'b', 'a'])
  assert.equal(plugin.visibleAgentRows(view, () => true, 200).rows.map(row => row.id).join(','), 'a,b,c')
  assert.equal(plugin.visibleAgentRows(view, () => false, 200).rows.map(row => row.id).join(','), 'a')
})

test('diagnostics stay visible and inactive is not promoted to a successful outcome', () => {
  const view = plugin.buildAgentView({ current: 'a', byId: {}, subagentsByParent: {
    a: { entries: [child('b'), { id: 'bad', kind: 'diagnostic', reason: 'corrupt' }] },
  } })
  assert.equal(view.nodes.get('b')?.running, false)
  assert.equal(view.nodes.get('bad')?.unavailable, true)
  assert.equal(view.nodes.size, 3)
  assert.equal(plugin.buildAgentView({ byId: { a: { id: 'a' } } }).nodes.size, 0)
})

test('tree usage sums each agent once across descendants and distinguishes incomplete data', () => {
  const usage = (tokens: number) => ({ superAgentUsage: { totals: { uncachedInputTokens: tokens, cacheReadTokens: 5, outputTokens: 2 } } })
  const view = plugin.buildAgentView({ current: 'a', byId: {
    a: { id: 'a', projectionValues: usage(10) },
    b: { id: 'b', parentId: 'a', hasChildren: true, projectionValues: usage(20) },
    c: { id: 'c', parentId: 'b', projectionValues: usage(30) },
    other: { id: 'other', projectionValues: usage(999) },
  } })
  const totals = plugin.agentTreeTotals(view, { a: { state: 'ready' }, b: { state: 'ready' } })
  assert.equal(totals.get('a')?.tokens, 81)
  assert.equal(totals.get('a')?.cache, 15)
  assert.equal(totals.get('a')?.agents, 3)
  assert.equal(totals.get('b')?.tokens, 64)
  assert.equal(totals.get('b')?.agents, 2)
  assert.equal(totals.get('c')?.tokens, 37)
  assert.equal(totals.get('a')?.partial, false)
  assert.equal(plugin.agentTreeTotals(view).get('a')?.partial, true)
  const cycle = plugin.buildAgentView({ current: 'a', byId: { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } } })
  assert.equal(plugin.agentTreeTotals(cycle).get(cycle.root)?.agents, 2)
  assert.equal(plugin.agentTreeTotals(cycle).get(cycle.root)?.known, 0)
})

test('deep histories and accidental cycles do not recurse or render unbounded rows', () => {
  const byId = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [String(i), { id: String(i), ...(i ? { parentId: String(i - 1) } : {}) }]))
  const view = plugin.buildAgentView({ current: '0', byId })
  const result = plugin.visibleAgentRows(view, () => true, 200)
  assert.equal(result.rows.length, 200)
  assert.equal(result.more, true)
  const cycle = plugin.buildAgentView({ current: 'a', byId: { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } } })
  assert.equal(plugin.visibleAgentRows(cycle, () => true, 200).rows.length, 2)
})

test('node graph places parents above distinct children and bounds automatic expansion', () => {
  const view = plugin.buildAgentView({ current: 'root', byId: { root: { id: 'root' }, a: { id: 'a', parentId: 'root' }, b: { id: 'b', parentId: 'root' }, c: { id: 'c', parentId: 'a' } } })
  const layout = plugin.agentTreeLayout(view, 200)
  const byId = new Map(layout.rows.map(row => [row.id, row]))
  assert.equal(layout.edges.length, 3)
  assert.ok(byId.get('root')!.y < byId.get('a')!.y)
  assert.ok(byId.get('a')!.y < byId.get('c')!.y)
  assert.ok(byId.get('a')!.x < byId.get('b')!.x)
  assert.equal(plugin.agentTreeLayout(view, 2).rows.length, 2)
  assert.equal(plugin.agentTreeLayout(view, 2).more, true)
})

test('long trees collect older idle nodes without changing records, statuses or total usage', () => {
  const byId = Object.fromEntries(['root', ...Array.from({ length: 40 }, (_, i) => `c${i}`)].map((id, i) => [id, {
    id, ...(i ? { parentId: 'root' } : {}), running: false, mode: 'continuable', projectionValues: { tokenUsage: { outputTokens: 10 } },
  }]))
  const view = plugin.buildAgentView({ current: 'root', byId })
  const before = plugin.agentTreeTotals(view).get('root')!.tokens
  const display = plugin.agentTreeDisplay(view)
  assert.equal(display.hidden.length, 36)
  assert.equal(plugin.agentTreeDisplay(view, {}, { compact: true }).hidden.length, 38)
  assert.equal(plugin.visibleAgentRows(display.view, () => true, 200).rows.map(row => row.id).join(','), 'root,c36,c37,c38,c39')
  assert.equal(view.nodes.size, 41)
  assert.equal(plugin.agentTreeTotals(view).get('root')!.tokens, before)
  assert.equal(plugin.agentExecutionStatus(view.nodes.get('c0'), false).tone, 'idle')
  assert.equal(plugin.agentTreeDisplay(view, {}, { expanded: new Set(['root']) }).hidden.length, 0)
  assert.equal(plugin.agentTreeDisplay(view, {}, { collapsed: new Set(['root']) }).hidden.length, 40)
})

test('folding retains active, unknown, diagnostic, focused and current paths, including resumed descendants', () => {
  const byId: Record<string, any> = { root: { id: 'root', running: false }, old: { id: 'old', parentId: 'root', running: false, hasChildren: true },
    leaf: { id: 'leaf', parentId: 'old', running: false }, bad: { id: 'bad', parentId: 'root', unavailable: true, running: false },
    unknown: { id: 'unknown', parentId: 'root' } }
  for (let i = 0; i < 8; i++) byId[`new${i}`] = { id: `new${i}`, parentId: 'root', running: false }
  const catalogs = { old: { state: 'ready' } }
  let view = plugin.buildAgentView({ current: 'root', byId })
  assert.ok(plugin.agentTreeDisplay(view, catalogs).hidden.includes('leaf'))
  assert.ok(!plugin.agentTreeDisplay(view, {}).hidden.includes('old')) // Unknown descendants must be discoverable.
  byId.leaf.running = true
  view = plugin.buildAgentView({ current: 'root', byId })
  const folded = plugin.agentTreeDisplay(view, catalogs, { collapsed: new Set(['root', 'old']) })
  for (const id of ['old', 'leaf', 'bad', 'unknown']) assert.ok(!folded.hidden.includes(id), id)
  byId.leaf.running = false
  view = plugin.buildAgentView({ current: 'leaf', byId })
  assert.ok(!plugin.agentTreeDisplay(view, catalogs, { collapsed: new Set(['root', 'old']) }).hidden.includes('leaf'))
  view = plugin.buildAgentView({ current: 'root', byId })
  assert.ok(!plugin.agentTreeDisplay(view, catalogs, { focused: 'leaf' }).hidden.includes('leaf'))
})

test('automatic depth folding, catalog chronology, cycles and ten thousand nodes stay bounded', () => {
  const byId = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [String(i), { id: String(i), running: false, ...(i ? { parentId: String(i - 1) } : {}) }]))
  const view = plugin.buildAgentView({ current: '0', byId })
  const display = plugin.agentTreeDisplay(view)
  assert.equal(plugin.visibleAgentRows(display.view, () => true, 200).rows.length, 2)
  assert.equal(display.hidden.length, 9998)
  assert.equal(plugin.visibleAgentRows(plugin.agentTreeDisplay(view, {}, { expanded: new Set(['1']) }).view, () => true, 200).rows.length, 3)
  const reverse = Object.fromEntries(['root', 'e', 'd', 'c', 'b', 'a'].map(id => [id, { id, parentId: id === 'root' ? undefined : 'root', running: false }]))
  const ordered = plugin.buildAgentView({ current: 'root', byId: reverse, subagentsByParent: { root: { entries: ['a', 'b', 'c', 'd', 'e'].map(id => child(id)) } } })
  assert.equal(plugin.agentTreeDisplay(ordered).hidden.join(','), 'a')
  const cycle = plugin.buildAgentView({ current: 'a', byId: { a: { id: 'a', parentId: 'b', running: false }, b: { id: 'b', parentId: 'a', running: false } } })
  assert.equal(plugin.visibleAgentRows(plugin.agentTreeDisplay(cycle).view, () => true, 200).rows.length, 2)
})

test('plugin opens read-only resource tabs without navigating the main conversation', () => {
  const slots: { config: Record<string, unknown>; component: unknown }[] = []
  const opened: object[] = [], pages: object[] = [], definitions: any[] = []
  const context = {
    effect: () => {},
    remote: { $mount: async () => () => {}, superCodeMemory: {} },
    settingsScope: { bind: () => ({}) },
    inject: (_deps: string[], ready: (ctx: object) => void) => ready(context),
    slots: { inject: (_name: string, register: () => any) => { const result = register(); if (result?.[Symbol.iterator]) for (const _ of result) { /* Consume keyed registrations. */ } }, register: (config: Record<string, unknown>, component: unknown) => slots.push({ config, component }) },
    sidebarRightTabs: { register: (definition: any) => { definitions.push(definition); return () => {} } },
    sessions: { openSubagent: () => assert.fail('must not switch conversations'), open: () => assert.fail('must not switch conversations') },
    sidebarRight: { openTab: (kind: string, options: object) => pages.push({ kind, options }), openResource: (address: string, options: object) => opened.push({ address, options }) },
  }
  plugin.apply(context)
  assert.equal(slots.some(slot => slot.config.name === 'conversation.input.left'), false)
  assert.equal(slots.some(slot => slot.config.id === 'super-agent-token-stats'), false)
  assert.equal(slots.some(slot => slot.config.name === 'conversation.composer.dock'), false)
  assert.equal(plugin.inject.includes('remote.agentPresets'), false)
  assert.equal(slots.some(slot => slot.config.name === 'settings.plugin.item'), false)
  assert.equal(plugin.inject.includes('settingsScope'), false)
  const tree = slots.find(slot => slot.config.key === 'dsh-super-code' && slot.config.name === 'sidebar.right.pane.tab')!
  const props = (tree.config.inject as () => { openDetail: (node: Node) => void })()
  props.openDetail({ id: 'child', parentId: 'parent', mode: 'continuable' })
  props.openDetail({ id: 'parent' })
  assert.equal(JSON.stringify(opened), JSON.stringify([
    { address: 'dsh-resource://super-agent/child?parent=parent&mode=continuable', options: { kind: 'super-agent-detail' } },
    { address: 'dsh-resource://super-agent/parent', options: { kind: 'super-agent-detail' } },
  ]))
  const guide = definitions.filter(definition => definition.guide?.length)
  assert.equal(guide.length, 1)
  assert.equal(guide[0].kind, 'super-agent-agents')
  const legacy = slots.find(slot => slot.config.key === 'dsh-super-code-memory' && slot.config.name === 'sidebar.right.pane.tab')!
  assert.equal(legacy.component, tree.component, 'restored memory tabs use the unified page')
  const details = slots.find(slot => slot.config.key === 'dsh-super-code-detail' && slot.config.name === 'sidebar.right.pane.tab')!
  const actions = (details.config.inject as () => { openMemory: (id: string, row: object) => void })()
  for (let i = 0; i < 2; i++) actions.openMemory('child', { scope: 'global', topic: 'preferences', id: 'preserve edits' })
  assert.equal(JSON.stringify(pages), JSON.stringify(Array(2).fill({ kind: 'super-agent-agents', options: {
    params: { memory: 'dsh-resource://super-code-memory/child?scope=global&topic=preferences&id=preserve+edits' },
  } })))
  assert.equal(opened.length, 2, 'memory links use the existing page, not another resource tab')
})

test('detail addresses preserve child authority and escape identifiers', () => {
  const address = plugin.agentDetailAddress({ id: 'child /?#', parentId: 'parent ?', mode: 'one-shot' })
  assert.equal(JSON.stringify(plugin.agentDetailTarget(address)), JSON.stringify({ kind: 'subagent', parentSessionId: 'parent ?', childSessionId: 'child /?#', mode: 'one-shot' }))
  assert.throws(() => plugin.agentDetailTarget('https://example.com/child'), /Invalid/)
})

test('detail reader keeps bounded records, uses host pagination, and ignores publications after disposal', async () => {
  let callbacks: any
  let disposed = 0, opens = 0, pages = 0
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => { opens++ }, signal: new AbortController().signal, dispose: async () => { disposed++ } }
  }, plugin.agentDetailAddress({ id: 'root' }), async request => {
    pages++
    assert.equal(request.beforeSeq, 301)
    assert.equal(request.throughSeq, 500)
    return { ok: true, value: { records: [entry(300)], hasMore: true } }
  })
  const entry = (seq: number) => ({ type: 'event', event: { seq, time: seq, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Message ' + seq }] } } } })
  inspector.start()
  callbacks.publish({ type: 'replace', entries: Array.from({ length: 500 }, (_, i) => entry(i)), hasMore: true, page: { projections: { values: { tokenUsage: { outputTokens: 500 } } } } })
  assert.equal(inspector.getSnapshot().items.length, 200)
  assert.equal(inspector.getSnapshot().items[0].seq, 300)
  callbacks.publish({ type: 'append', entry: entry(500) })
  assert.equal(inspector.getSnapshot().items.at(-1).seq, 500)
  await inspector.older()
  assert.equal(inspector.getSnapshot().items[0].seq, 300)
  assert.equal(opens, 1)
  assert.equal(pages, 1)
  const snapshot = inspector.getSnapshot()
  inspector.dispose()
  callbacks.publish({ type: 'append', entry: entry(501) })
  assert.equal(disposed, 1)
  assert.equal(inspector.getSnapshot(), snapshot)
})

test('detail history failures can retry and late pages cannot revive a closed inspector', async () => {
  let callbacks: any
  let finishPage: (value: object) => void = () => assert.fail('page has not started')
  let reads = 0
  const controller = new AbortController()
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, signal: controller.signal, dispose: async () => controller.abort() }
  }, plugin.agentDetailAddress({ id: 'root' }), async (_request, signal) => {
    assert.equal(signal, controller.signal)
    if (++reads === 1) return { ok: false }
    return new Promise(resolve => { finishPage = resolve })
  })
  callbacks.publish({ type: 'replace', entries: [], hasMore: true, page: {} })
  await inspector.older()
  assert.equal(inspector.getSnapshot().status, 'error')
  assert.equal(inspector.getSnapshot().error, 'detail.historyError')
  const pending = inspector.older()
  await inspector.older()
  assert.equal(reads, 2, 'concurrent pagination is deduplicated')
  const snapshot = inspector.getSnapshot()
  inspector.dispose()
  finishPage({ ok: true, value: { records: [], hasMore: false } })
  await pending
  assert.equal(controller.signal.aborted, true)
  assert.equal(inspector.getSnapshot(), snapshot)
})

test('detail records show user tasks, public replies, tools and execution errors without private reasoning', () => {
  const record = (type: string, data: object) => plugin.detailRecord({ type: 'event', event: { seq: 1, time: 1, type, data } })
  assert.equal(record('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Task' }] }).label, '任务')
  assert.equal(record('user/message', { source: { kind: 'system' }, content: [{ type: 'text', text: 'Context' }] }).kind, 'skip')
  const call = record('tool/call', { name: 'super_code_task', arguments: '{"action":"read"}' })
  assert.equal(call.kind, 'tool')
  assert.equal(call.label, '工具调用 · super_code_task')
  assert.equal(call.text, '{\n  "action": "read"\n}')
  const failure = record('tool/result', { message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'Unavailable' }] }] } })
  assert.equal(failure.kind, 'error')
  assert.equal(failure.label, '工具失败')
  assert.equal(failure.text, 'Unavailable')
  const reply = record('assistant/message', { message: { content: [
    { type: 'reasoning', text: 'Private reasoning' },
    { type: 'tool-call', name: 'super_code_task', text: 'Internal' },
    { type: 'text', text: 'Finished' },
  ] } })
  assert.equal(reply.text, 'Finished')
  assert.equal(record('turn/error', { message: 'Connection failed' }).text, 'Connection failed')
  assert.equal(record('turn/error', { internal: 'details' }).text, '执行未完成，请稍后重试。')
  assert.equal(record('other/event', {}).kind, 'skip')
})

test('tool details accept old and new journals, preserve incomplete arguments and follow stream pagination', async () => {
  const entry = (seq: number, type: string, data: object) => ({ event: { seq, time: seq, type, data } })
  const call = entry(10, 'tool/call', { callId: 'read-1', name: 'read_file', arguments: '{"path":' })
  const legacy = entry(11, 'tool/result', { message: { role: 'tool', toolCallId: 'read-1', isError: false,
    content: [{ type: 'text', text: 'File contents' }, { type: 'reasoning', text: 'Private' }] } })
  const modern = entry(12, 'tool/result', { message: { content: [{ type: 'tool-result', toolCallId: 'read-1', isError: false,
    content: [{ type: 'text', text: 'Next result' }, { type: 'image' }] }] } })
  assert.equal(plugin.detailRecord(call).text, '{"path":')
  assert.equal(plugin.detailRecord(legacy).text, 'File contents')
  assert.equal(plugin.detailRecord(modern).text, 'Next result\n\n[图片]')
  assert.equal(plugin.detailRecord(entry(13, 'tool/call', {})).kind, 'skip')
  assert.equal(plugin.detailRecord(entry(14, 'tool/result', {})).kind, 'skip')
  let callbacks: any
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, dispose: async () => {} }
  }, plugin.agentDetailAddress({ id: 'root' }), async () => ({ ok: true, value: { records: [call, legacy], hasMore: false } }))
  callbacks.publish({ type: 'replace', entries: [modern], hasMore: true, page: {} })
  await inspector.older()
  assert.equal(inspector.getSnapshot().items.map((item: { seq: number }) => item.seq).join(','), '10,11')
  assert.equal(inspector.getSnapshot().earlier, true)
  assert.equal(inspector.getSnapshot().cursor, 12)
  assert.equal(inspector.getSnapshot().items[0].kind, 'tool')
  assert.equal(inspector.getSnapshot().items[1].text, 'File contents')
  inspector.dispose()
})

test('reopening a historical page preserves its records and cursor across stream reconnects', async () => {
  let callbacks: any
  const initial = { status: 'ready', earlier: true, items: [{ seq: 10, text: 'Historical task' }], firstSeq: 10, cursor: 90, hasMore: true, projections: {}, error: '' }
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, signal: new AbortController().signal, dispose: async () => {} }
  }, plugin.agentDetailAddress({ id: 'root' }), async request => {
    assert.equal(request.beforeSeq, 10)
    assert.equal(request.throughSeq, 90)
    return { ok: true, value: { records: [], hasMore: false } }
  }, initial)
  inspector.start()
  callbacks.publish({ type: 'replace', entries: [], hasMore: true, page: { projections: { values: { tokenUsage: { outputTokens: 20 } } } } })
  assert.equal(inspector.getSnapshot().items, initial.items)
  assert.equal(inspector.getSnapshot().earlier, true)
  assert.equal(inspector.getSnapshot().projections.tokenUsage.outputTokens, 20)
  await inspector.older()
  assert.equal(inspector.getSnapshot().hasMore, false)
  inspector.dispose()
})

test('a resumed recent page retains overlapping displayed records instead of shifting the reading window', () => {
  let callbacks: any
  const entry = (seq: number) => ({ event: { seq, time: seq, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Message ' + seq }] } } } })
  const inspector = plugin.createAgentInspector((_address, next) => {
    callbacks = next
    return { open: async () => {}, dispose: async () => {} }
  }, plugin.agentDetailAddress({ id: 'root' }), async () => assert.fail('no page expected'))
  callbacks.publish({ type: 'replace', entries: [entry(10), entry(11)], hasMore: true, page: {} })
  callbacks.publish({ type: 'replace', entries: [entry(11), entry(12)], hasMore: true, page: {} })
  assert.equal(inspector.getSnapshot().items.map((item: { seq: number }) => item.seq).join(','), '10,11,12')
  assert.equal(inspector.getSnapshot().firstSeq, 10)
  assert.equal(inspector.getSnapshot().cursor, 12)
  inspector.dispose()
})

function workspaceFixture() {
  const react = {
    createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props, children }),
    useMemo: (read: () => any) => read(), useState: (value: any) => [typeof value === 'function' ? value() : value, () => {}],
    useRef: (value: any) => ({ current: value }), useEffect: () => {}, useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: Function, read: Function) => read(),
  }
  const subject = client({ react }), slots: any[] = []
  const context = {
    effect: () => {}, remote: { $mount: async () => () => {}, superCodeMemory: {
      saveEntry: async () => ({ ok: true, value: { kind: 'saved' } }),
    } }, settingsScope: { bind: () => ({}) },
    inject: (_deps: string[], run: Function) => run(context),
    slots: { inject: (_name: string, register: Function) => {
      const result = register(); if (result?.[Symbol.iterator]) for (const _ of result) { /* Register tab types. */ }
    }, register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  }
  subject.apply(context)
  const slot = slots.find(row => row.config.key === 'dsh-super-code' && row.config.name === 'sidebar.right.pane.tab')
  const tab = { signal: new AbortController().signal, visible: true, contentId: 'sidebar://super-agent-agents',
    navigation: { revision: 1, params: {} as any } }
  const props = { ...slot.config.inject(), t: (key: string) => key, sessionId: 'root',
    useTabInfo: () => ({ tab }), useSessions: (select: Function) => select({ current: 'root' }) }
  return { props, tab, render: () => slot.component(props) }
}

test('workspace defaults to execution and title toggles keep exactly one section expanded', () => {
  const { props, tab, render } = workspaceFixture()
  let layout = render().children[0]
  assert.equal(layout.props['data-active-section'], 'tree')
  assert.equal(layout.children[0].props.key, 'tree')
  assert.equal(layout.children[1].props.key, 'memory-collapsed')
  let title = layout.children[1].children[0].type(layout.children[1].children[0].props)
  assert.equal(title.props['aria-expanded'], false)
  title.props.onClick()
  layout = render().children[0]
  assert.equal(layout.props['data-active-section'], 'memory')
  assert.equal(layout.children[0].props.key, 'tree-collapsed')
  assert.equal(layout.children[1].props.key, 'memory')
  assert.equal(props.workspaceStates.get(tab.signal).active, 'memory', 'remount retains the chosen section')
  layout.children[1].props.onToggle()
  layout = render().children[0]
  assert.equal(layout.props['data-active-section'], 'tree', 'clicking the open heading opens the other section')
  layout.children[0].props.onToggle()
  layout = render().children[0]
  assert.equal(layout.props['data-active-section'], 'memory', 'the other open heading also cannot leave both closed')
  layout.children[0].children[0].props.onToggle()
  assert.equal(render().children[0].props['data-active-section'], 'tree', 'a collapsed heading opens its section')
})

test('memory links expand their section once and repeated explicit navigation reopens it', () => {
  const { props, tab, render } = workspaceFixture()
  render()
  tab.navigation = { revision: 2, params: { memory: 'dsh-resource://super-code-memory/root?topic=notes&id=entry' } }
  let layout = render().children[0]
  assert.equal(layout.props['data-active-section'], 'memory')
  layout.children[1].props.onToggle()
  assert.equal(render().children[0].props['data-active-section'], 'tree', 'unchanged link does not undo a user toggle')
  tab.navigation.revision++
  assert.equal(render().children[0].props['data-active-section'], 'memory')
  tab.signal = new AbortController().signal
  tab.contentId = 'dsh-resource://super-code-memory/root?topic=notes&id=entry'
  tab.navigation = { revision: 1, params: {} }
  assert.equal(render().children[0].props['data-active-section'], 'memory', 'legacy memory resources expand memory')
  tab.signal = new AbortController().signal
  tab.contentId = 'sidebar://super-agent-agents'
  tab.navigation = { revision: 1, params: { memory: 'invalid' } }
  assert.equal(render().children[0].props['data-active-section'], 'tree', 'invalid links preserve the default')
  assert.notEqual(props.workspaceStates.get(tab.signal).active, 'memory')
})

test('hidden workspace remount after memory navigation keeps the editor attached to its current tab state', async () => {
  const { props, tab, render } = workspaceFixture()
  render().children[0].children[1].children[0].props.onToggle()
  const memory = render().children[0].children[1]
  memory.type(memory.props)
  const original = props.memoryStates.get(tab.signal)
  tab.navigation = { revision: 2, params: { memory: 'dsh-resource://super-code-memory/root?topic=notes&id=existing' } }
  memory.type(memory.props)
  assert.equal(props.memoryStates.get(tab.signal), original, 'navigation must not replace the state captured by pending operations')
  original.editorStore.update({ draft: { sessionId: 'root', scope: 'project', topic: 'notes', id: 'new', expected: '',
    kind: 'constraint', summary: 'Title', detail: 'Content' } })
  render().children[0].children[1].props.onToggle()
  assert.equal(render().children[0].props['data-active-section'], 'tree')
  render().children[0].children[1].children[0].props.onToggle()
  assert.equal(render().children[0].props['data-active-section'], 'memory')
  assert.equal(props.memoryStates.get(tab.signal).editorStore.getSnapshot().draft.summary, 'Title', 'collapse retains the draft')
  await original.editorStore.save()
  assert.equal(props.memoryStates.get(tab.signal).selected.id, 'new', 'saving after tab navigation opens the saved entry')
})
