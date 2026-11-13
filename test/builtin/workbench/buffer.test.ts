import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { createBuffer } from '../../../builtin/workbench/buffer.js'
import { wordAt } from '../../../builtin/workbench/editor/code-info.js'

test('大文档编辑、撤销到原文与保存期间的新修改保留正确状态', () => {
  const text = 'const value = 1;\n'.repeat(50000)
  const buffer = createBuffer({ path: 'large.ts', text, version: 'v1' })
  let state = EditorState.create({ doc: text })
  buffer.state = state
  assert.equal(buffer.dirty, false)
  state = state.update({ changes: { from: state.doc.length, insert: '// changed' } }).state
  buffer.state = state
  assert.equal(buffer.dirty, true)
  assert.equal(buffer.text, text + '// changed')
  const sent = buffer.text
  buffer.state = state.update({ changes: { from: state.doc.length, insert: '\n// later' } }).state
  buffer.original = sent
  assert.equal(buffer.dirty, true)
  assert.equal(buffer.text, sent + '\n// later')
  buffer.state = EditorState.create({ doc: sent })
  assert.equal(buffer.dirty, false)
})

test('外部文件重新读取时不会复用旧文档文本，长标识符和文档末尾定位正常', () => {
  const buffer = createBuffer({ path: 'main.ts', text: 'before', version: '1' })
  buffer.state = EditorState.create({ doc: 'before changed' })
  assert.equal(buffer.text, 'before changed')
  Object.assign(buffer, { text: 'after', version: '2', original: 'after', state: null })
  assert.equal(buffer.text, 'after'); assert.equal(buffer.dirty, false)
  const name = 'longName'.repeat(80), source = ' '.repeat(1000000) + name
  assert.equal(wordAt(EditorState.create({ doc: source }).doc, source.length - 10).word, name)
  assert.equal(wordAt(source, source.length).word, name)
})

test('编辑缓冲保留 CRLF，撤销后恢复干净状态而不改写整份文件的换行', () => {
  const text = 'first\r\nsecond\r\n', buffer = createBuffer({ path: 'windows.ts', text, version: '1' })
  const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of('\r\n')] })
  buffer.state = state; assert.equal(buffer.text, text); assert.equal(buffer.dirty, false)
  buffer.state = state.update({ changes: { from: 0, to: 5, insert: 'changed' } }).state
  assert.equal(buffer.text, 'changed\r\nsecond\r\n'); assert.equal(buffer.dirty, true)
  buffer.state = state; assert.equal(buffer.dirty, false); assert.equal(buffer.text, text)
})

test('长单行标识符只扫描新增块，Unicode 字母不被窗口边界截断', () => {
  const name = '𐐀'.repeat(300) + 'a'.repeat(1800000), source = ` ${name} `
  let scanned = 0
  const doc = { length: source.length, sliceString(from: number, to: number) { scanned += to - from; return source.slice(from, to) } }
  assert.deepEqual(wordAt(doc, 129), { word: name, from: 1, to: 1 + name.length })
  assert.ok(scanned < source.length * 3, '扫描和最终取词均保持线性，不反复复制整个词')
})
