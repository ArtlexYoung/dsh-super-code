import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

const element = (type: unknown, props: any, ...children: any[]) => ({ type, props: { ...props, children } })
const Provider = Symbol('host-markdown-navigation')
const MarkdownText = Symbol('host-markdown-text')
let plugin: any
const source = buildSync({ entryPoints: [new URL('../../client/workbench/conversation.js', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' }).outputFiles[0].text
const module = { exports: {} as any }
runInNewContext(`(function(require, module, exports) { ${source}\n})`, { URL, AbortController })(
    (id: string) => id === 'react' ? {
      forwardRef: () => 'button', createElement: element,
      useMemo: (read: () => unknown) => read(), useEffect: () => {}, useLayoutEffect: () => {},
      useRef: (value: unknown) => ({ current: value }), useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
      useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
    } : id === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownDelegateProvider: Provider, MarkdownText } : {}, module, module.exports)
plugin = { workbenchControls: { Conversation: module.exports.WorkbenchConversation } }

test('工作台右侧对话使用宿主的 Markdown 路径识别和文件打开能力', () => {
  const opened: unknown[] = []
  const view = plugin.workbenchControls.Conversation({ sessionId: 'demo', remote: {}, t: (key: string) => key, useInput: () => {}, inputActions: {}, useSessions: () => {},
    openFile: (...args: unknown[]) => opened.push(args), detailT: (key: string) => key,
  })
  assert.equal(view.type, Provider)
  view.props.openFile('src/中文 空格.ts', { line: 9 })
  assert.deepEqual(opened, [['src/中文 空格.ts', { line: 9 }]])
})

test('冷启动直接进入工作台时订阅官方聊天数据，不依赖先打开对话页', () => {
  const chat = { timeline: { turns: new Map() } }, opener = () => {}, calls: unknown[] = []
  plugin.workbenchControls.Conversation({ sessionId: 'demo', remote: {}, t: (key: string) => key, useInput: () => {}, inputActions: {}, useSessions: () => {},
    openFile: opener, detailT: (key: string) => key,
    useChat: (select: (value: unknown) => unknown) => select(chat),
    useConversation: () => assert.fail('有官方聊天数据时不重复订阅整个会话'),
    fileMentions: (...args: unknown[]) => { calls.push(args); return new Map() },
  })
  assert.equal((calls[0] as unknown[])[0], chat)
  assert.equal((calls[0] as unknown[])[1], opener)
})

test('没有独立聊天数据钩子的旧宿主仍可读取已有的会话快照', () => {
  const chat = {}, calls: unknown[] = []
  plugin.workbenchControls.Conversation({ sessionId: 'demo', remote: {}, t: (key: string) => key, useInput: () => {}, inputActions: {}, useSessions: () => {},
    detailT: (key: string) => key,
    useConversation: (select: (value: unknown) => unknown) => select({ views: new Map([['chat', chat]]) }),
    fileMentions: (value: unknown) => { calls.push(value); return new Map() },
  })
  assert.equal(calls[0], chat)
})

function findElement(value: any, predicate: (element: any) => boolean): any {
  if (!value) return undefined
  if (Array.isArray(value)) return value.map(child => findElement(child, predicate)).find(Boolean)
  return predicate(value) ? value : findElement(value.props?.children, predicate)
}

test('工作台区分对话输入锁定原因，锁定时拒绝提交并可返回同一会话', () => {
  const scenarios = [
    { phase: 'adjudicating', reason: 'conversationInput_adjudicating' },
    { phase: 'claimed', reason: 'conversationInput_claimed' },
    { phase: 'submitting', reason: 'conversationInput_submitting' },
    { phase: 'plain', attachmentIds: ['attachment'], reason: 'conversationRichDraft' },
    { phase: 'plain', occurrences: [{ offset: 0 }], reason: 'conversationRichDraft' },
    { phase: 'plain', reason: '' },
  ]
  for (const scenario of scenarios) {
    let submitted = 0
    const opened: unknown[][] = []
    const view = plugin.workbenchControls.Conversation({ sessionId: 'demo', remote: {}, t: (key: string) => key, useSessions: () => {},
      useInput: (select: (value: unknown) => unknown) => select({ draft: 'draft text', ...scenario }),
      inputActions: { submit: () => { submitted++ } }, openView: (...target: unknown[]) => opened.push(target),
    })
    const input = findElement(view, element => element.type?.name === 'WorkbenchInput')
    const form = input.type(input.props)
    const textarea = findElement(form, element => element.type === 'textarea')
    const notice = findElement(form, element => element.props?.role === 'status')
    assert.equal(textarea.props.disabled, !!scenario.reason)
    assert.equal(notice?.props.children[0] ?? '', scenario.reason)
    form.props.onSubmit({ preventDefault() {} })
    textarea.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() {} })
    textarea.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} })
    assert.equal(submitted, scenario.reason ? 0 : 2)
    findElement(form, element => element.props?.children.includes('openConversation')).props.onClick()
    assert.deepEqual(opened, [['chat', '']])
  }
})

test('普通回复和展开的折叠回复均把官方文件提及交给 Markdown 渲染器', () => {
  const resolver = { resolve: () => undefined }
  for (const collapsed of [false, true]) {
    const view = plugin.workbenchControls.Conversation({ sessionId: 'demo', remote: {}, t: (key: string) => key, useInput: () => {}, inputActions: {},
      detailT: (key: string) => key, useSessions: (select: (value: unknown) => unknown) => select({ byId: {} }),
      fileMentions: () => new Map([[5, resolver]]),
    })
    const detail = findElement(view, element => element.type?.name === 'AgentDetail')
    const snapshot = { items: [{ seq: 5, time: 1, kind: 'agent', label: '回复', text: '`created.ts`', format: 'markdown', collapsed }], projections: {}, status: 'ready' }
    const tree = detail.type({ ...detail.props, createInspector: () => ({ subscribe: () => () => {}, getSnapshot: () => snapshot }) })
    const message = findElement(tree, element => element.type?.name === 'AgentMessage')
    const text = findElement(message.type(message.props), element => element.type?.name === 'DetailText')
    const markdown = findElement(text.type(text.props), element => element.type === MarkdownText)
    assert.equal(markdown.props.fileMentions, resolver, `collapsed=${collapsed}`)
  }
})
