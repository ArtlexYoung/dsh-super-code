import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function render(records: object[]) {
  const slots: any[] = []
  const react = {
    createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props, children: children.flat() }),
    forwardRef: () => 'button', useMemo: (read: () => any) => read(),
    useState: (value: any) => [typeof value === 'function' ? value() : value, () => {}],
    useRef: (value: any) => ({ current: value }), useEffect: () => {}, useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: Function, read: Function) => read(),
  }
  let subject: any
  runInNewContext(readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8'), {
    URL, __ModuleLoader__: { load: ({ factory }: any) => { subject = factory((id: string) => id === 'react' ? react : {}) } },
  })
  const context = {
    effect: () => {}, remote: { $mount: async () => () => {} }, settingsScope: { bind: () => ({}) },
    inject: (_deps: string[], run: Function) => run(context),
    slots: { inject: (_name: string, register: Function) => {
      const result = register(); if (result?.[Symbol.iterator]) for (const _ of result) { /* Register details. */ }
    }, register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  }
  subject.apply(context)
  const slot = slots.find(row => row.config.key === 'dsh-super-code-detail' && row.config.name === 'sidebar.right.pane.tab')
  assert.ok(slot)
  const items = records.map(event => subject.detailRecord({ event }))
  const snapshot = { status: 'ready', items, projections: {}, firstSeq: 0, cursor: items.length, hasMore: false }
  const tree = slot.component({ ...slot.config.inject(), sessionId: 'root', t: (key: string) => key,
    useTabInfo: () => ({ tab: { signal: new AbortController().signal, visible: true, contentId: 'dsh-resource://super-agent/root' } }),
    useSessions: (read: Function) => read({ current: 'root', byId: {} }), useSessionStatus: undefined,
    createInspector: () => ({ subscribe: () => () => {}, getSnapshot: () => snapshot }),
  })
  const messages: any[] = []
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.props?.record) messages.push(node.props)
    for (const child of node.children || []) visit(child)
  }
  visit(tree)
  return messages
}

test('Agent detail labels results by their preceding call in the same step and turn', () => {
  for (const modern of [false, true]) {
    const events: object[] = []
    for (const [turn, step, name] of [[1, 1, 'read'], [1, 2, 'write'], [2, 1, 'edit']] as const) {
      events.push({ seq: events.length, time: 1, type: 'tool/call', data: { turn, step, name, callId: 'reused', arguments: '{}' } },
        { seq: events.length + 1, time: 1, type: 'tool/result', data: { turn, step, message: modern
          ? { role: 'tool', toolCallId: 'reused', content: [] }
          : { content: [{ type: 'tool-result', toolCallId: 'reused', content: [] }] } } })
    }
    const before = JSON.stringify(events)
    assert.deepEqual(render(events).map(row => row.toolName), ['read', 'read', 'write', 'write', 'edit', 'edit'])
    assert.equal(JSON.stringify(events), before)
  }
})

test('a paginated result never borrows a tool name from a later reused call', () => {
  const messages = render([
    { seq: 1, time: 1, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'reused', content: [] } } },
    { seq: 2, time: 1, type: 'tool/call', data: { turn: 2, step: 1, callId: 'reused', name: 'write', arguments: '{}' } },
  ])
  assert.equal(messages[0].toolName, undefined)
  assert.equal(messages[1].toolName, 'write')
})
