import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { readerDocuments } from '../../../../builtin/workbench/editor/reader.js'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'

async function documents(file: string, text: string, ranges = [{ from: 0, to: text.length }]) {
  let state = EditorState.create({ doc: text, extensions: [await loadLanguage(file)] })
  ensureSyntaxTree(state, state.doc.length, 1000)
  state = state.update({}).state
  return readerDocuments(state, file, ranges)
}

test('阅读器只排版独立多行文档，覆盖其整行缩进且不修改原文', async () => {
  const text = 'class Store {\n  /**\n   * 读取任务。\n   */\n  load() {}\n}\n'
  const result = await documents('tasks.ts', text)
  assert.equal(result.length, 1)
  assert.equal(text.slice(result[0].from, result[0].to), '  /**\n   * 读取任务。\n   */')
  assert.equal(result[0].raw, '/**\n   * 读取任务。\n   */')
})

test('普通注释、单行文档、表达式内注释、字符串和未闭合文档保留原文', async () => {
  for (const text of [
    '/* 普通注释\n * 保持原文\n */\nconst x = 1;', '/** 单行文档 */\nconst x = 1;',
    'const x = /**\n * 类型断言\n */ value;', '/**\n * 内联文档\n */ const x = 1;',
    'const x = `/**\n * 字符串\n */`;', '/**\n * 正在输入的文档',
  ]) assert.deepEqual(await documents('tasks.ts', text), [], text)
  assert.deepEqual(await documents('tasks.txt', '/**\n * 不是代码语言\n */'), [])
})

test('Python 仅排版模块、类、函数首条真实文档字符串', async () => {
  const text = '# 说明\n"""模块。\n更多。\n"""\nclass Store:\n    """类说明。\n    更多。\n    """\n    async def load(self):\n        # 文档前注释\n        r"""读取。\n\n        Args:\n            self (Store): 当前实例。\n        """\n        return 1\n'
  const result = await documents('tasks.py', text)
  assert.equal(result.length, 3)
  assert.equal(result[2].raw, '读取。\n\nArgs:\n    self (Store): 当前实例。')
  assert.ok(result.every(value => value.language === 'Python'))
})

test('Python 普通字符串、后续独立字符串和可执行插值不排版', async () => {
  for (const text of [
    'value = """数据\n更多\n"""', 'def run():\n    value = 1\n    """普通值\n更多\n    """',
    'if True:\n    """不是文档\n更多\n    """', 'def run():\n    f"""{value}\n更多\n    """',
    'def run():\n    b"""bytes\nmore\n    """', 'def run():\n    """未闭合\n更多',
  ]) assert.deepEqual(await documents('tasks.py', text), [], text)
})

test('Java、C++、PHP 共用文档排版，不把普通注释当文档', async () => {
  for (const [file, text] of [
    ['Tasks.java', '/**\n * 读取任务。\n */\nclass Tasks {}'],
    ['tasks.cpp', '/**\n * 读取任务。\n */\nvoid load() {}'],
    ['tasks.php', '<?php\n/**\n * @param string $name 名称。\n */\nfunction load($name) {}'],
  ]) assert.equal((await documents(file, text))[0].language, file.endsWith('.php') ? 'PHP' : '')
})

test('只收集可见范围、相交范围去重，长文档不构造巨型排版', async () => {
  const text = '/**\n * 第一段\n */\nconst a = 1;\n/**\n * 第二段\n */\nconst b = 2;'
  const from = text.indexOf('/**', 3)
  assert.equal((await documents('tasks.ts', text, [{ from, to: text.length }])).length, 1)
  assert.equal((await documents('tasks.ts', text, [{ from: 0, to: text.length }, { from, to: text.length }])).length, 2)
  assert.deepEqual(await documents('tasks.ts', '/**\n' + ' * 很长的说明\n'.repeat(2000) + ' */'), [])
  assert.deepEqual(await documents('tasks.ts', ''), [])
})
