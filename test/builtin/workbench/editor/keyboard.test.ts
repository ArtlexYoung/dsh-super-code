import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'
import { commentAt } from '../../../../builtin/workbench/editor/code-info.js'
import { editingCommands } from '../../../../builtin/workbench/editor/input.js'

test('注释中的同名函数不会触发气泡，真实代码仍可提示', async () => {
  for (const [file, text] of [['main.ts', '/** calculateTotal 示例 */\n// calculateTotal\nfunction calculateTotal() {}'], ['main.py', '# calculateTotal\ndef calculateTotal(): pass'], ['main.sh', '# calculateTotal\ncalculateTotal() { :; }']]) {
    const state = EditorState.create({ doc: text, extensions: [await loadLanguage(file)] })
    assert.equal(commentAt(state, text.indexOf('calculateTotal') + 3), true, file)
    assert.equal(commentAt(state, text.lastIndexOf('calculateTotal') + 3), false, file)
  }
})

test('单行注释命令按语言和所有选区切换，可撤回且不产生块注释', async () => {
  for (const [file, original, marker] of [['main.ts', 'const first = 1;\nconst second = 2;', '//'], ['main.py', 'first = 1\nsecond = 2', '#'], ['main.sh', 'first=1\nsecond=2', '#']]) {
    let state = EditorState.create({ doc: original, selection: { anchor: 0, head: original.length }, extensions: [await loadLanguage(file)] })
    const target = { get state() { return state }, dispatch(value: any) { state = state.update(value).state } }
    assert.equal(editingCommands.comment(target), true)
    assert.ok(state.doc.toString().split('\n').every(line => line.startsWith(marker)), file)
    assert.equal(editingCommands.comment(target), true)
    assert.equal(state.doc.toString(), original)
  }
})
