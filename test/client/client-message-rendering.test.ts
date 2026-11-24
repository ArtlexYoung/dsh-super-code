import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('详情消息复用解码，替换记录和切换语言时仍显示最新内容', () => {
  let cells: any[] = [], cursor = 0, subject: any, reads = 0
  const memo = (read: () => any, deps: any[]) => {
    const index = cursor++, previous = cells[index]
    if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) cells[index] = { deps, value: read() }
    return cells[index].value
  }
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children: children.flat() }),
    forwardRef: () => 'button', useMemo: memo, useState: (value: any) => [value, () => {}],
    useRef: (current: any) => memo(() => ({ current }), []), useEffect() {}, useLayoutEffect() {},
    useSyncExternalStore: (_subscribe: any, read: any) => read(),
  }
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, __ModuleLoader__: { load: ({ factory }: any) => { subject = factory((id: string) => id === 'react' ? react : {}) } },
  })
  const slots: any[] = []
  const context = {
    effect() {}, remote: { $mount: async () => () => {} }, settingsScope: { bind: () => ({}) },
    inject: (_deps: string[], run: any) => { if (_deps.join(',') !== 'sessions,sidebarRightTabs' && !_deps.includes('remote.skills')) run(context) }, sessions: {}, sidebarRight: {},
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_name: string, register: any) => {
        const result = register(); if (result?.[Symbol.iterator]) for (const _ of result) { /* 注册详情页。 */ }
      },
      register: (config: any, component: any) => { slots.push({ config, component }); return () => {} },
    },
  }
  subject.apply(context)
  const entry = { event: { seq: 1, time: 1, type: 'tool/call', data: {
    name: 'read_file', callId: 'call', get arguments() { reads++; return '{"path":"中文.txt"}' },
  } } }
  const record = subject.detailRecord(entry), saved = { open: new Set() }, translate = (key: string) => key
  const snapshot = { status: 'ready', items: [record], projections: {} }
  const slot = slots.find(row => row.config.key === 'dsh-super-code-detail' && row.config.name === 'sidebar.right.pane.tab')
  const tree = slot.component({ ...slot.config.inject(), sessionId: 'root', t: translate,
    useTabInfo: () => ({ tab: { signal: new AbortController().signal, visible: true, contentId: 'dsh-resource://super-agent/root' } }),
    useSessions: (read: any) => read({ current: 'root', byId: {} }),
    createInspector: () => ({ subscribe: () => () => {}, getSnapshot: () => snapshot }),
  })
  const find = (node: any, matches: (value: any) => boolean): any => !node || typeof node !== 'object' ? undefined
    : matches(node) ? node : (node.children || []).map((child: any) => find(child, matches)).find(Boolean)
  const message = find(tree, node => node.props?.record)
  assert.ok(message)
  cells = []
  const render = (next = record, t = translate) => { cursor = 0; return message.type({ record: next, saved, t }) }
  const beforeRender = reads, first = render(), decoded = reads
  assert.equal(decoded, beforeRender, '首次展示复用Inspector已归一化的工具参数')
  const repeated = render()
  assert.equal(reads, decoded, '相同不可变记录不应重复读取和解析工具参数')
  assert.equal(find(repeated, node => node.type === 'details').props.open, false)
  assert.ok(find(first, node => node.props?.text?.includes('中文.txt')), '折叠正文仍在树中，保留浏览器搜索')
  const replaced = render(subject.detailRecord({ event: { ...entry.event, data: { name: 'write_file', callId: 'call', arguments: '{"path":"新文件.txt"}' } } }))
  assert.ok(find(replaced, node => node.props?.text?.includes('新文件.txt')))
  const localized = render(record, key => key === 'detail.toolCall' ? 'Tool call' : key)
  assert.ok(find(localized, node => node.children?.includes('Tool call · read_file')))
  const details = find(localized, node => node.type === 'details')
  const target = { open: true }
  details.props.onToggle({ target: {}, currentTarget: target })
  assert.equal(saved.open.has(1), false, '嵌套展开事件不会改变外层消息的阅读状态')
  details.props.onToggle({ target, currentTarget: target })
  assert.equal(saved.open.has(1), true)
  target.open = false
  details.props.onToggle({ target, currentTarget: target })
  assert.equal(saved.open.has(1), false)
})
