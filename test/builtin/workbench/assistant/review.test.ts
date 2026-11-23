import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, StateEffect, type TransactionSpec } from '@codemirror/state'
import { createConversationStore } from '../../../../builtin/workbench/assistant/conversations.js'
import { createSelectionAssistant } from '../../../../builtin/workbench/assistant/controller.js'

function fixture(t: TestContext, replacement = 'count') {
  const store = createConversationStore()
  let state = EditorState.create({ doc: 'const value = 1;', selection: { anchor: 6, head: 11 } }), calls = 0, file = 'main.ts'
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) {
    const transaction = state.update(spec); state = transaction.state
    assistant.update({ docChanged: transaction.docChanged, transactions: [transaction], state })
  } }
  const assistant = createSelectionAssistant({ editor: { file: () => file, view: () => view },
    api: { async assist(): Promise<{ kind: 'edit'; replacement: string }> { calls++; return { kind: 'edit', replacement } } },
    t: (key: string) => key, changed: () => {} })
  assistant.bind(store); t.after(() => assistant.dispose())
  return { assistant, view, store, get thread() { return store.files.get('main.ts')![0]! }, get text() { return state.doc.toString() }, get calls() { return calls },
    async propose() { assistant.select(); assistant.mode('edit'); assistant.draft('rename'); await assistant.send() },
    switchFile() { assistant.switchFile(); file = 'other.ts' },
  }
}

test('提案先审阅，放弃和重复点击不改变代码，下一轮可以再请求', async t => {
  const f = fixture(t); await f.propose(); const proposal = f.thread.proposal
  assert.equal(f.text, 'const value = 1;'); assert.equal(proposal.state, 'pending')
  f.assistant.draft('another request'); await f.assistant.send(); assert.equal(f.calls, 1)
  f.assistant.review(proposal.id, 'discard'); assert.equal(f.text, 'const value = 1;')
  assert.equal(f.thread.proposal.state, 'discarded')
  f.assistant.review(proposal.id, 'apply'); assert.equal(f.text, 'const value = 1;')
  await f.assistant.send(); assert.equal(f.calls, 2)
  f.assistant.review(proposal.id, 'apply'); assert.equal(f.text, 'const value = 1;', '旧按钮不得应用新提案')
})

for (const replacement of ['count', '', 'one\r\ntwo']) test(`应用后可撤回选区修改：${JSON.stringify(replacement)}`, async t => {
  const f = fixture(t, replacement); await f.propose(); const id = f.thread.proposal.id
  f.assistant.review(id, 'apply')
  assert.equal(f.text, 'const ' + replacement.replace(/\r\n/g, '\n') + ' = 1;')
  assert.equal(f.thread.proposal.state, 'applied')
  const applied = f.text; f.assistant.review(id, 'apply'); assert.equal(f.text, applied)
  f.assistant.review(id, 'undo'); assert.equal(f.text, 'const value = 1;')
  assert.equal(f.thread.proposal.state, 'undone'); assert.equal(f.thread.stale, false)
  f.assistant.review(id, 'undo'); assert.equal(f.text, 'const value = 1;')
})

test('范围外编辑使核对版本失效，重新核对后应用与撤回都保留后来代码', async t => {
  const f = fixture(t); await f.propose(); const id = f.thread.proposal.id
  f.view.dispatch({ changes: { from: 0, insert: '// prefix\n' } })
  f.assistant.review(id, 'apply'); assert.equal(f.text, '// prefix\nconst value = 1;')
  f.assistant.review(id, 'recheck'); f.assistant.review(id, 'apply')
  assert.equal(f.text, '// prefix\nconst count = 1;')
  f.view.dispatch({ changes: { from: f.text.length, insert: '\n// suffix' } })
  f.assistant.review(id, 'undo'); assert.equal(f.text, '// prefix\nconst count = 1;\n// suffix')
  f.assistant.review(id, 'recheck'); f.assistant.review(id, 'undo')
  assert.equal(f.text, '// prefix\nconst value = 1;\n// suffix')
})

for (const applied of [false, true]) test(`选区内的新编辑不能被${applied ? '撤回' : '应用'}覆盖`, async t => {
  const f = fixture(t); await f.propose(); const id = f.thread.proposal.id
  if (applied) f.assistant.review(id, 'apply')
  f.view.dispatch({ changes: { from: 6, to: 11, insert: 'other' } })
  f.assistant.review(id, 'recheck'); f.assistant.review(id, applied ? 'undo' : 'apply')
  assert.equal(f.text, 'const other = 1;'); assert.equal(f.thread.stale, true)
})

test('切换文件或只读状态不能应用提案，关闭气泡保留待审阅结果', async t => {
  const f = fixture(t); await f.propose(); const id = f.thread.proposal.id, thread = f.thread.id
  f.assistant.close(); f.assistant.open(thread); assert.equal(f.thread.proposal.id, id)
  f.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  f.assistant.review(id, 'apply'); assert.equal(f.text, 'const value = 1;')
  f.switchFile(); f.assistant.open(thread); f.assistant.review(id, 'apply')
  assert.equal(f.text, 'const value = 1;'); assert.equal(f.thread.proposal.state, 'pending')
})
