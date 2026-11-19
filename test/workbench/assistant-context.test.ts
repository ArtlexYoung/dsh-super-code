import test from 'node:test'
import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import { selectionContext, MAX_CONTEXT_CHARS } from '../../src/workbench/assistant-context.js'
import { parseAssistant } from '../../src/workbench/assistant.js'

test('合法大文件的小选区摘取有界上下文，头部、中部、末尾和Unicode选区均保留准确内容', () => {
  const source = 'prefix\n'.repeat(70000) + '中文😀suffix', doc = Text.of(source.split('\n'))
  for (const [from, to] of [[0, 6], [200000, 200010], [source.length - 10, source.length], [source.length - 8, source.length - 4]]) {
    const context = selectionContext(doc, from, to)
    assert.ok(context.text.length <= MAX_CONTEXT_CHARS)
    assert.equal(context.text.slice(context.from, context.to), source.slice(from, to))
    assert.doesNotThrow(() => parseAssistant({ file: 'large.ts', ...context, mode: 'ask', instruction: '解释', history: [] }))
  }
})

test('小文件完整保留，达到上限的选区仍可发送，超大选区明确拒绝', () => {
  assert.deepEqual(selectionContext(Text.of(['hello world']), 6, 11), { text: 'hello world', from: 6, to: 11 })
  const doc = Text.of(['a'.repeat(MAX_CONTEXT_CHARS + 30)])
  assert.equal(selectionContext(doc, 10, MAX_CONTEXT_CHARS + 10).text.length, MAX_CONTEXT_CHARS)
  assert.throws(() => selectionContext(doc, 0, MAX_CONTEXT_CHARS + 1), /WORKBENCH_SELECTION_SIZE/)
})
