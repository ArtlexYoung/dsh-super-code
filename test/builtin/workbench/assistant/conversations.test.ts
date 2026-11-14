import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { createConversationStore } from '../../../../builtin/workbench/assistant/conversations.js'
import { createSelectionAssistant } from '../../../../builtin/workbench/assistant/controller.js'

function assistant(store: any, api: any = {}, translationLanguage?: () => string) {
  let file = 'src/main.ts', snapshot: any
  let state = EditorState.create({ doc: '// Calculate total.\nconst total = 1;', selection: { anchor: 3, head: 18 } })
  const view = { get state() { return state }, dispatch() {} }
  const value = createSelectionAssistant({ editor: { file: () => file, view: () => view }, api, t: (key: string) => ({ translationRequest: '翻译“{text}”为{language}', translationLanguage: '中文' }[key] || key), changed: (next: any) => { snapshot = next }, translationModel: () => undefined, translationLanguage })
  value.bind(store)
  return { value, get snapshot() { return snapshot }, setFile(next: string) { file = next } }
}

test('项目快速对话跨文件和控制器共享，未发送草稿不计入数量', async () => {
  const store = createConversationStore(), first = assistant(store), second = assistant(store)
  first.value.select()
  assert.equal(first.snapshot.conversations.length, 0)
  first.value.pin()
  assert.equal(second.snapshot.conversations.length, 1)
  assert.equal(second.snapshot.conversations[0].file, 'src/main.ts')
  assert.equal(second.snapshot.conversations[0].line, 0)
  second.setFile('src/other.ts'); second.value.select(); second.value.pin()
  assert.equal(first.snapshot.conversations.length, 2)
  second.value.remove()
  assert.equal(first.snapshot.conversations.length, 1)
  first.value.dispose(); second.value.dispose()
})

test('翻译从选区发起，不发送全文件，追问只使用翻译消息', async () => {
  const calls: any[] = [], store = createConversationStore()
  const current = assistant(store, { async translate(input: any) { calls.push(input); return { kind: 'ask', text: '计算总额。' } } })
  await current.value.select('translate')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { instruction: '翻译“Calculate total”为中文', history: [] })
  assert.equal(current.snapshot.conversations.length, 1)
  current.value.draft('换一种说法'); await current.value.send()
  assert.equal(calls[1].history.length, 2)
  assert.equal(calls[1].instruction, '换一种说法')
  current.value.select()
  assert.equal(current.snapshot.thread.kind, 'code')
  assert.equal(current.snapshot.thread.messages.length, 0)
  current.value.dispose()
})

test('翻译目标实时读取窗口语言，同一选区不同目标语言保留独立对话', async () => {
  const calls: any[] = [], store = createConversationStore()
  let language = '中文'
  const current = assistant(store, { async translate(input: any) { calls.push(input); return { kind: 'ask', text: '译文' } } }, () => language)
  await current.value.select('translate')
  language = '日本語'; await current.value.select('translate')
  assert.equal(calls[1].instruction, '翻译“Calculate total”为日本語')
  assert.equal(calls[1].history.length, 0)
  assert.equal(current.snapshot.conversations.length, 2)
  language = '中文'; await current.value.select('translate')
  assert.equal(calls.length, 2)
  assert.equal(current.snapshot.thread.language, '中文')
  current.value.dispose()
})

test('一个会话离开不会停止其他会话的翻译，打开原对话后可以主动取消', async () => {
  const pending = Promise.withResolvers<any>(), store = createConversationStore()
  let signal: AbortSignal
  const first = assistant(store, { translate(_input: unknown, received: AbortSignal) { signal = received; return pending.promise } })
  const second = assistant(store)
  const request = first.value.select('translate'), row = second.snapshot.conversations[0]
  second.value.switchFile()
  assert.equal(signal!.aborted, false)
  second.value.open(row.id); second.value.stop()
  assert.equal(signal!.aborted, true)
  pending.resolve({ kind: 'ask', text: '不应保存的迟到回答' }); await request
  assert.equal(first.snapshot.thread.messages.length, 1)
  assert.equal(first.snapshot.thread.status, 'error')
  first.value.dispose(); second.value.dispose()
})

test('从其他会话删除对话会同步隐藏记录并取消请求，不重新加入共享列表', async () => {
  const pending = Promise.withResolvers<any>(), store = createConversationStore()
  let signal: AbortSignal
  const first = assistant(store, { translate(_input: unknown, received: AbortSignal) { signal = received; return pending.promise } })
  const second = assistant(store), otherProject = assistant(createConversationStore())
  const request = first.value.select('translate')
  assert.equal(otherProject.snapshot.conversations.length, 0)
  second.value.open(second.snapshot.conversations[0].id); second.value.remove()
  assert.equal(signal!.aborted, true)
  assert.equal(first.snapshot.thread, null)
  assert.equal(first.snapshot.visible, false)
  pending.resolve({ kind: 'ask', text: '迟到回答' }); await request
  assert.equal(first.snapshot.conversations.length, 0)
  first.value.dispose(); second.value.dispose(); otherProject.value.dispose()
})
