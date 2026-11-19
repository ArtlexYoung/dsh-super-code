import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'

for (const [file, text] of [
  ['config.yaml', '# settings\nname: "demo"\ncount: 42\nenabled: true\n'],
  ['config.yml', '# settings\nname: "demo"\ncount: 42\nenabled: true\n'],
  ['config.toml', '# settings\n[project]\nname = "demo"\ncount = 42\nenabled = true\n'],
]) test(file + ' 使用现有解析器识别注释、字符串和数字', async () => {
  const state = EditorState.create({ doc: text, extensions: [await loadLanguage(file)] })
  const tree = ensureSyntaxTree(state, text.length, 1000)
  assert.ok(tree)
  const tokens: { text: string; classes: string }[] = []
  highlightTree(tree, classHighlighter, (from, to, classes) => tokens.push({ text: text.slice(from, to), classes }))
  assert.ok(tokens.some(item => item.classes.includes('tok-comment') && item.text.includes('settings')))
  assert.ok(tokens.some(item => item.classes.includes('tok-string') && item.text.includes('demo')))
  assert.ok(tokens.some(item => item.classes.includes('tok-number') && item.text === '42'))
})
