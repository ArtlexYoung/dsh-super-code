import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

interface Row { id: string; level: number }
interface Node { id: string; parentId?: string; mode?: string; title?: string; running?: boolean; unavailable?: boolean }
interface View { root: string; nodes: Map<string, Node>; children: Map<string, string[]>; ancestors: Set<string> }
interface Client {
  default?: { inject?: string[]; apply?: unknown } | ((ctx: object) => void)
  inject: string[]
  buildAgentView(state: object): View
  visibleAgentRows(view: View, expanded: (id: string) => boolean, limit: number): { rows: Row[]; more: boolean }
  agentTreeTotals(view: View, catalogs?: object): Map<string, { agents: number; tokens: number; cache: number; known: number; partial: boolean }>
  agentTreeLayout(view: View, limit: number): { rows: { id: string; x: number; y: number }[]; edges: object[]; more: boolean; width: number }
  apply(ctx: object): void
  agentDetailAddress(node: Node): string
  agentDetailTarget(address: string): object
  detailRecord(entry: object): { kind: string; label?: string; text?: string }
  createAgentInspector(create: (address: object, callbacks: any) => any, address: string, readPage: (request: any, signal: AbortSignal) => Promise<any>, initial?: object): any
}

function client(): Client {
  let loaded: Client | undefined
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ factory }: { factory: (require: (id: string) => object) => Client }) => {
      loaded = factory(() => ({}))
    } },
  })
  assert.ok(loaded)
  return loaded
}
const plugin = client()
const child = (id: string, extra = {}) => ({ id, kind: 'child', mode: 'one-shot', activity: 'inactive', ...extra })

test('browser loader resolves a plugin that retains its dependency declarations', () => {
  const resolved = plugin.default ?? plugin
  assert.ok('inject' in resolved)
  assert.ok(resolved.inject?.includes('slots'))
  assert.ok(resolved.inject?.includes('sidebarRightTabs'))
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

test('plugin opens read-only resource tabs without navigating the main conversation', () => {
  const slots: { config: Record<string, unknown>; component: unknown }[] = []
  const opened: object[] = []
  plugin.apply({
    effect: () => {},
    slots: { inject: (_name: string, register: () => void) => register(), register: (config: Record<string, unknown>, component: unknown) => slots.push({ config, component }) },
    sidebarRightTabs: { register: () => () => {} },
    sessions: { openSubagent: () => assert.fail('must not switch conversations'), open: () => assert.fail('must not switch conversations') },
    sidebarRight: { openResource: (address: string, options: object) => opened.push({ address, options }) },
  })
  assert.equal(slots.some(slot => slot.config.name === 'conversation.input.left'), false)
  assert.equal(slots.some(slot => slot.config.id === 'super-agent-token-stats'), false)
  assert.equal(slots.some(slot => slot.config.name === 'conversation.composer.dock'), false)
  assert.equal(plugin.inject.includes('remote.agentPresets'), false)
  const tree = slots.find(slot => slot.config.key === 'dsh-super-agent')!
  const props = (tree.config.inject as () => { openDetail: (node: Node) => void })()
  props.openDetail({ id: 'child', parentId: 'parent', mode: 'continuable' })
  props.openDetail({ id: 'parent' })
  assert.equal(JSON.stringify(opened), JSON.stringify([
    { address: 'dsh-resource://super-agent/child?parent=parent&mode=continuable', options: { kind: 'super-agent-detail' } },
    { address: 'dsh-resource://super-agent/parent', options: { kind: 'super-agent-detail' } },
  ]))
  assert.ok(slots.some(slot => slot.config.key === 'dsh-super-agent-detail'))
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
  assert.equal(inspector.getSnapshot().error, '历史记录读取失败')
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

test('detail records show user tasks, public replies and execution errors without internal records', () => {
  const record = (type: string, data: object) => plugin.detailRecord({ type: 'event', event: { seq: 1, time: 1, type, data } })
  assert.equal(record('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Task' }] }).label, '任务')
  assert.equal(record('user/message', { source: { kind: 'system' }, content: [{ type: 'text', text: 'Context' }] }).kind, 'skip')
  assert.equal(record('tool/call', { name: 'super_code_task', arguments: '{}' }).kind, 'skip')
  const failure = record('tool/result', { message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'Unavailable' }] }] } })
  assert.equal(failure.kind, 'skip')
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
