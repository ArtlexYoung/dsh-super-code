import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'
import { outlineScopes, readScope, scopeContext, symbolKind } from '../../../../builtin/workbench/editor/scope.js'

async function stateAt(file: string, doc: string, at: string) {
  let state = EditorState.create({ doc, selection: { anchor: doc.indexOf(at) }, extensions: [await loadLanguage(file), scopeContext] })
  ensureSyntaxTree(state, state.doc.length, 1000)
  state = state.update({}).state
  return state
}
const pathOf = (state: EditorState) => state.field(scopeContext).path.map(item => item.name)

test('TS 命名声明按外到内排列，多声明变量绑定到正确箭头函数', async () => {
  const doc = 'export class Store {\n  async load(\n    value: number\n  ) {\n    const count = 1, process = (input: number) => {\n      return input + count;\n    };\n    return process(value);\n  }\n}'
  const state = await stateAt('store.ts', doc, 'input + count')
  assert.deepEqual(pathOf(state), ['Store', 'load', 'process'])
  assert.deepEqual(state.field(scopeContext).path.map(item => doc.slice(item.head, item.head + item.name.length)), ['Store', 'load', 'process'])
  assert.deepEqual(state.field(scopeContext).path.map(item => item.kind), ['type', 'function', 'function'])
})

test('匿名回调不虚构名称，已有的函数表达式和对象方法仍可导航', async () => {
  const sources = [
    ['function load() { return items.map(value => { return value; }); }', 'return value', ['load']],
    ['const load = function named() { return 1; };', 'return 1', ['named']],
    ['const load = function() { return 1; };', 'return 1', ['load']],
    ['const store = { load: () => { return 1; } };', 'return 1', ['load']],
    ['const store = { load() { return 1; } };', 'return 1', ['load']],
    ['class Store { load = () => { return 1; }; }', 'return 1', ['Store', 'load']],
  ] as const
  for (const [doc, at, expected] of sources) assert.deepEqual(pathOf(await stateAt('a.ts', doc, at)), expected, doc)
})

test('结构语言使用真实 AST，不从返回类型、接收参数、泛型参数猜函数名', async () => {
  const sources = [
    ['a.py', 'class Store:\n    def run(self):\n        def inner():\n            return 1\n        return inner()\n', 'return 1', ['Store', 'run', 'inner']],
    ['a.go', 'package main\ntype Store struct {}\nfunc (s Store) run(value int) int {\n  return value\n}', 'return value', ['run']],
    ['a.go', 'package main\nfunc run(value int) int { return value }', 'return value', ['run']],
    ['a.rs', 'struct Store {}\nimpl Store {\n  fn run(value: i32) -> i32 {\n    value\n  }\n}', '    value', ['Store', 'run']],
    ['a.rs', 'impl<T> Handler<T> for Store<T> { fn run() { work(); } }', 'work()', ['Store', 'run']],
    ['a.rs', 'impl<T> Handler<T> for crate::Store<T> { fn run() { work(); } }', 'work()', ['crate::Store', 'run']],
    ['a.java', 'class Store {\n  public String run(int value) {\n    return "done";\n  }\n}', 'return', ['Store', 'run']],
    ['a.java', 'class Store { Store() { init(); } }', 'init()', ['Store', 'Store']],
    ['a.cpp', 'class Store {\n  Result run(int value) {\n    return value;\n  }\n};', 'return', ['Store', 'run']],
    ['a.cpp', 'Result* Store::run(int value) { return value; }', 'return', ['Store::run']],
    ['a.c', 'int run(int value) { return value; }', 'return', ['run']],
    ['a.php', '<?php class Store {\n  function run($value) {\n    return $value;\n  }\n}', 'return', ['Store', 'run']],
    ['a.php', '<?php function run() { return 1; }', 'return', ['run']],
    ['a.html', '<script>function run() { return 1; }</script>', 'return', ['run']],
  ] as const
  for (const [file, doc, at, expected] of sources) assert.deepEqual(pathOf(await stateAt(file, doc, at)), expected, file + ': ' + doc)
})

test('循环和条件块供活动缩进读取，不混入命名导航', async () => {
  const doc = 'class Store {\n  run() {\n    for (const value of items) {\n      if (value) {\n        use(value);\n\n      }\n    }\n  }\n}'
  const state = await stateAt('a.ts', doc, 'use(value)')
  const context = state.field(scopeContext)
  assert.deepEqual(pathOf(state), ['Store', 'run'])
  assert.equal(state.doc.lineAt(context.block.header).text, '      if (value) {')
  assert.equal(doc[context.block.to], '}')
  assert.deepEqual(readScope(state), context)
})

test('反向选区以活动端定位，关闭花括号之后回到文件顶层', async () => {
  const doc = 'function first() { return 1; }\n\nfunction second() { return 2; }\n'
  let state = await stateAt('a.ts', doc, 'return 1')
  state = state.update({ selection: { anchor: doc.indexOf('return 2'), head: doc.indexOf('return 1') } }).state
  assert.deepEqual(pathOf(state), ['first'])
  state = state.update({ selection: { anchor: doc.indexOf('}') + 1 } }).state
  assert.deepEqual(pathOf(state), [])
  assert.equal(state.field(scopeContext).block, null)
  state = state.update({ selection: { anchor: doc.length } }).state
  assert.deepEqual(pathOf(state), [])
})

test('注释及字符串中的声明不产生伪导航，未闭合的真实函数仍可读取', async () => {
  for (const [doc, at] of [
    ['function run() {\n /* class Fake {\n  comment\n } */\n}', 'comment'],
    ['function run() {\n return `function fake() {\n text\n }`;\n}', 'text'],
    ['function run() {\n if (true) {\n  work();\n', 'work()'],
  ]) assert.deepEqual(pathOf(await stateAt('a.ts', doc, at)), ['run'])
  const state = await stateAt('a.ts', 'function run() {\n  work();\n', 'work()')
  assert.deepEqual(pathOf(state.update({ selection: { anchor: state.doc.length } }).state), ['run'])
})

test('空文件、顶层文本及旧词法语言不伪造命名作用域', async () => {
  for (const [file, doc, at] of [
    ['a.ts', '', ''], ['a.ts', 'const value = 1;', 'value'],
    ['a.txt', 'class Store {\n function load() {}\n}', 'load'],
    ['a.sh', 'function run() {\n  echo ready\n}', 'echo'],
    ['a.cs', 'class Store { void Run() { work(); } }', 'work'],
    ['a.json', '{"function":"fake"}', 'fake'],
  ]) assert.deepEqual(pathOf(await stateAt(file, doc, at)), [], file)
})

test('状态在修改、删除和撤销文本后读取最新语法树，空事务保留派生状态', async () => {
  const doc = 'function load() {\n  return 1;\n}'
  let state = await stateAt('a.ts', doc, 'return')
  assert.equal(state.update({}).state.field(scopeContext), state.field(scopeContext))
  state = state.update({ changes: { from: 9, to: 13, insert: 'read' } }).state
  assert.deepEqual(pathOf(state), ['read'])
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: '' }, selection: { anchor: 0 } }).state
  assert.deepEqual(pathOf(state), [])
  assert.equal(state.field(scopeContext).block, null)
})

test('延后解析不误报文件顶层，语法树推进后更新为真实作用域', async () => {
  const doc = 'class Store {\n  run() {\n' + Array.from({ length: 25000 }, (_, i) => '    const item' + i + ' = ' + i + ';').join('\n') + '\n  }\n}'
  const head = doc.indexOf('item20000')
  let state = EditorState.create({ doc, selection: { anchor: head }, extensions: [await loadLanguage('a.ts'), scopeContext] })
  assert.equal(state.field(scopeContext).ready, false)
  const symbols = [{ name: 'item20000', kind: 'variable', offset: head }]
  assert.equal(outlineScopes(state, symbols).has(head), false)
  ensureSyntaxTree(state, head + 100, 1000)
  state = state.update({}).state
  assert.equal(state.field(scopeContext).ready, true)
  assert.deepEqual(pathOf(state), ['Store', 'run'])
  assert.equal(outlineScopes(state, symbols).get(head)?.local, true)
  assert.equal(state.doc.toString(), doc)
})

test('文件结构根据源码显示 Python 类型、方法、字段和嵌套声明', async () => {
  const doc = 'class Reader:\n    limit = 3\n    def summarize():\n        def helper():\n            item = 1\n            return item\n        return helper()\n'
  const state = await stateAt('a.py', doc, 'summarize')
  const definitions = [['Reader', 'variable'], ['limit', 'variable'], ['summarize', 'function'], ['helper', 'function'], ['item', 'variable']] as const
  const symbols = definitions.map(([name, kind]) => ({ name, kind, offset: doc.indexOf(name) }))
  assert.deepEqual([...outlineScopes(state, symbols).values()], [
    { kind: 'type', depth: 0, parent: '', local: false },
    { kind: 'variable', depth: 1, parent: 'Reader', local: false },
    { kind: 'method', depth: 1, parent: 'Reader', local: false },
    { kind: 'function', depth: 2, parent: 'Reader.summarize', local: false },
    { kind: 'variable', depth: 3, parent: 'Reader.summarize.helper', local: true },
  ])
  assert.equal(outlineScopes(await stateAt('a.rb', doc, 'summarize'), symbols).size, 0)
  assert.equal(outlineScopes(state, [{ name: 'old_name', kind: 'variable', offset: doc.indexOf('limit') }]).size, 0)
})

test('括号里的箭头函数保留绑定名称和嵌套声明', async () => {
  const doc = 'const load = ((key: string) => { function normalize() { return key; } return normalize(); });'
  const state = await stateAt('a.ts', doc, 'return key')
  const symbols = ['load', 'normalize'].map(name => ({ name, kind: 'function', offset: doc.indexOf(name) }))
  assert.deepEqual(pathOf(state), ['load', 'normalize'])
  assert.deepEqual(outlineScopes(state, symbols).get(doc.indexOf('normalize')), {
    kind: 'function', depth: 1, parent: 'load', local: false,
  })
})

test('命名空间里的函数保留源码归属和函数图标，未索引的父级不占缩进', async () => {
  const doc = 'namespace Cache { export function load() { const count = 1; return count; } }'
  const state = await stateAt('a.ts', doc, 'return')
  const symbols = [{ name: 'load', kind: 'function', offset: doc.indexOf('load') }]
  const [parent, child] = readScope(state).path
  assert.deepEqual([parent.name, child.name], ['Cache', 'load'])
  assert.equal(symbolKind(child.kind, parent.kind), 'function')
  assert.deepEqual(outlineScopes(state, symbols).get(child.head), {
    kind: 'function', depth: 0, parent: 'Cache', local: false,
  })
})
