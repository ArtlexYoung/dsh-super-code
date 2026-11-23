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

test('切换子 Agent 使用父子地址且隐藏主会话输入，返回后仍使用原输入动作', () => {
  const inputActions = { submit: () => assert.fail('Rendering must not send') };
  const props = { sessionId: 'root', remote: {}, t: (key: string) => key, useInput: () => {}, inputActions, useSessions: () => {}, detailT: (key: string) => key };
  for (const mode of ['one-shot', 'continuable']) {
    const view = plugin.workbenchControls.Conversation({ ...props, agent: {id:'child',parentId:'parent',mode}, fileMentions: () => assert.fail('Do not attach root file mentions to child records') });
    const detail = findElement(view, element => element.type?.name === 'AgentDetail');
    const target = new URL(detail.props.useTabInfo().tab.contentId);
    assert.equal(target.pathname, '/child');
    assert.equal(target.searchParams.get('parent'), 'parent');
    assert.equal(target.searchParams.get('mode'), mode);
    assert.equal(findElement(view, element => element.type?.name === 'WorkbenchInput'), undefined);
  }
  const main = plugin.workbenchControls.Conversation(props);
  assert.equal(findElement(main, element => element.type?.name === 'WorkbenchInput').props.inputActions, inputActions);
});

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

test('引用操作仅在调用方启用后出现在 Agent 回复中，不改变普通工作台和工具记录', () => {
  const replyActions = [{ id: 'quote', label: '引用', run: () => assert.fail('Rendering must not quote') }, { id: 'excerpt', label: '摘录', run: () => assert.fail('Rendering must not excerpt') }]
  for (const enabled of [false, true]) {
    const view = plugin.workbenchControls.Conversation({ sessionId: 'root', agent: { id: 'child', parentId: 'root', mode: 'continuable' },
      remote: {}, t: (key: string) => key, detailT: (key: string) => key,
      useSessions: (select: (value: unknown) => unknown) => select({ byId: {} }), replyActions: enabled ? replyActions : undefined,
    })
    const detail = findElement(view, element => element.type?.name === 'AgentDetail')
    for (const kind of ['agent', 'user', 'tool']) {
      const snapshot = { items: [{ seq: 5, time: 1, kind, label: kind, text: '编号 007', format: 'text' }], projections: {}, status: 'ready' }
      const tree = detail.type({ ...detail.props, createInspector: () => ({ subscribe: () => () => {}, getSnapshot: () => snapshot }) })
      const message = findElement(tree, element => element.type?.name === 'AgentMessage')
      for (const reply of replyActions) {
        const action = findElement(message.type(message.props), element => element.props?.className === 'sc-wb-reply-action' && element.props.children.includes(reply.label))
        assert.equal(Boolean(action), enabled && kind === 'agent')
      }
    }
  }
})
