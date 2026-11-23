import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { createConversationStore } from '../../../../builtin/workbench/assistant/conversations.js'
import { createSelectionAssistant } from '../../../../builtin/workbench/assistant/controller.js'
import { parseAssistant } from '../../../../src/workbench/assistant.js'

function assistant(store: any, api: any = {}, translationLanguage?: () => string, modelOptions?: (kind: string) => object) {
  let file = 'src/main.ts', snapshot: any
  let state = EditorState.create({ doc: '// Calculate total.\nconst total = 1;', selection: { anchor: 3, head: 18 } })
  const view = { get state() { return state }, dispatch(spec: any) { state = state.update(spec).state } }
  const value = createSelectionAssistant({ editor: { file: () => file, view: () => view }, api, t: (key: string) => ({ translationRequest: '翻译“{text}”为{language}', translationLanguage: '中文' }[key] || key), changed: (next: any) => { snapshot = next }, modelOptions, translationLanguage })
  value.bind(store)
  return { value, get snapshot() { return snapshot }, get text() { return state.doc.toString() }, setFile(next: string) { file = next },
    setSource(text: string, from: number, to: number) { state = EditorState.create({ doc: text, selection: { anchor: from, head: to } }) } }
}

for (const action of ['selection', 'switch', 'dispose']) test(`${action}离开时清理未输入未发送的临时对话`, () => {
    const store = createConversationStore(), current = assistant(store)
    current.value.select()
    const previous = current.snapshot.thread.id
    if (action === 'selection') { current.setSource('const value = 1;', 6, 11); current.value.select() }
    else if (action === 'switch') current.value.switchFile()
    else current.value.dispose()
    assert.equal([...store.files.values()].flat().some(thread => thread.id === previous), false, action)
    assert.equal([...store.files.values()].flat().length, action === 'selection' ? 1 : 0, action)
    assert.equal(store.files.size, action === 'selection' ? 1 : 0, '不保留无对话的空文件条目')
    if (action !== 'dispose') current.value.dispose()
})

test('离开选区保留有草稿、已固定和已发送的记录，重新打开同一选区不删除草稿', async () => {
  for (const kind of ['draft', 'pinned', 'sent']) {
    const store = createConversationStore(), current = assistant(store, { assist: async () => ({ kind: 'ask', text: '回答' }) })
    current.value.select()
    const id = current.snapshot.thread.id
    if (kind === 'pinned') current.value.pin()
    else { current.value.draft('保留的问题'); if (kind === 'sent') await current.value.send() }
    current.value.select()
    assert.equal(current.snapshot.thread.id, id)
    if (kind === 'draft') assert.equal(current.snapshot.thread.draft, '保留的问题')
    current.value.switchFile(); current.value.open(id)
    assert.equal(current.snapshot.thread.id, id)
    current.value.dispose()
    assert.equal([...store.files.values()].flat().some(thread => thread.id === id), true, kind)
  }
})

test('大文件选区助手发送摘取上下文，审阅后只修改完整文档中的原选区', async () => {
  const calls: any[] = [], current = assistant(createConversationStore(), { assist: async (input: any) => {
    calls.push(parseAssistant(input)); return { kind: 'edit', replacement: '替换结果' }
  } })
  const before = 'a'.repeat(300000) + 'selected' + 'z'.repeat(30000)
  try {
    current.setSource(before, 300000, 300008); current.value.select(); current.value.mode('edit'); current.value.draft('修改选区')
    await current.value.send()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].text.slice(calls[0].from, calls[0].to), 'selected')
    assert.ok(calls[0].text.length < before.length)
    assert.equal(current.text, before)
    assert.equal(current.snapshot.thread.proposal.state, 'pending')
    current.value.review(current.snapshot.thread.proposal.id, 'apply')
    assert.equal(current.text, before.slice(0, 300000) + '替换结果' + before.slice(300008))
    assert.equal(current.snapshot.thread.status, 'idle')
    current.setSource(before, 0, 300000); current.value.select(); current.value.draft('解释过大选区')
    await current.value.send()
    assert.equal(calls.length, 1)
    assert.equal(current.snapshot.thread.note, 'WORKBENCH_SELECTION_SIZE')
    assert.equal(current.snapshot.thread.draft, '解释过大选区')
    assert.equal(current.snapshot.thread.messages.length, 0)
  } finally { current.value.dispose() }
})

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

test('快速对话和翻译每次发送读取各自全局模型及思考，不沿用已打开气泡的旧设置', async () => {
  const calls: any[] = [], settings: any = { quick: { model: { provider: 'demo', model: 'fast' }, reasoningEffort: 'off' }, translation: { model: { provider: 'demo', model: 'plain' }, reasoningEffort: 'high' } }
  const api = { assist: async (input: any) => { calls.push(input); return { kind: 'ask', text: '回答' } }, translate: async (input: any) => { calls.push(input); return { kind: 'ask', text: '译文' } } }
  const f = assistant(createConversationStore(), api, undefined, kind => settings[kind])
  f.value.select(); f.value.draft('解释'); await f.value.send()
  assert.deepEqual(calls[0].model, settings.quick.model); assert.equal(calls[0].reasoningEffort, 'off')
  settings.quick = { reasoningEffort: 'high' }
  f.value.draft('再解释'); await f.value.send()
  assert.equal(calls[1].model, undefined); assert.equal(calls[1].reasoningEffort, 'high')
  await f.value.select('translate')
  assert.deepEqual(calls[2].model, settings.translation.model); assert.equal(calls[2].reasoningEffort, 'high')
  assert.equal(calls[2].text, undefined)
  f.value.dispose()
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
  assert.equal(first.snapshot.thread.status, 'stopped')
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
  assert.equal(store.files.size, 0)
  first.value.dispose(); second.value.dispose(); otherProject.value.dispose()
})

test('切换项目会取消原项目的代码修改，迟到回答不能修改同名文件或遗留请求', async () => {
  const pending = Promise.withResolvers<any>(), original = createConversationStore(), next = createConversationStore()
  let signal: AbortSignal
  const current = assistant(original, { assist(_input: unknown, received: AbortSignal) { signal = received; return pending.promise } })
  current.value.select(); current.value.mode('edit'); current.value.draft('修改选区')
  const before = current.text, request = current.value.send()
  current.value.bind(next)
  const afterBinding = current.snapshot
  current.value.select(); current.value.draft('新项目的问题')
  try {
    pending.resolve({ kind: 'edit', replacement: 'changed in the wrong project' }); await request
    assert.equal(current.text, before, '原项目的迟到修改不能写入新项目的同名文件')
    assert.equal(signal!.aborted, true)
    assert.equal(afterBinding.thread, null)
    assert.equal(afterBinding.visible, false)
    assert.equal(original.pending.size, 0)
    assert.equal(next.pending.size, 0)
    assert.equal(current.snapshot.thread.draft, '新项目的问题')
    assert.equal(current.snapshot.thread.messages.length, 0)
  } finally { current.value.dispose() }
})
