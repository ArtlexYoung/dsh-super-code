import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'
import { scopeLines } from '../../../../builtin/workbench/editor/sticky.js'

async function headers(file: string, text: string, at: string) {
  let state = EditorState.create({ doc: text, extensions: [await loadLanguage(file)] })
  ensureSyntaxTree(state, state.doc.length, 1000)
  state = state.update({}).state
  return scopeLines(state, text.indexOf(at)).map(line => ({ text: state.doc.sliceString(line.from, line.to), number: line.number }))
}

test('粘性行保留类、完整的跨行方法签名和循环，不扫相邻函数', async () => {
  const text = 'export class Store {\n  async run(\n    value: string\n  ) {\n    for (const item of value) {\n      console.log(item);\n    }\n  }\n}\nfunction other() {\n  return 1;\n}'
  assert.deepEqual(await headers('store.ts', text, 'console'), [
    { text: 'export class Store {', number: 1 },
    { text: '  async run(\n    value: string\n  ) {', number: 2 },
    { text: '    for (const item of value) {', number: 5 },
  ])
  assert.deepEqual(await headers('store.ts', text, 'return'), [{ text: 'function other() {', number: 10 }])
})

test('声明标题止于正文，极长签名有界，Python 保留冒号前的返回类型', async () => {
  const inline = 'function run() { const hidden = 0;\n  return hidden;\n}'
  assert.deepEqual(await headers('a.ts', inline, 'return'), [{ text: 'function run() {', number: 1 }])
  const long = `function run(\n  value = "${'a'.repeat(4000)}"\n) {\n  return value;\n}`
  const [header] = await headers('a.ts', long, 'return')
  assert.ok(header.text.startsWith('function run(\n  value'))
  assert.ok(header.text.length < 4000)
  const python = 'class Store:\n    def run(\n        self,\n        value: int,\n    ) -> int:\n        return value\n'
  assert.deepEqual(await headers('a.py', python, 'return'), [
    { text: 'class Store:', number: 1 }, { text: '    def run(\n        self,\n        value: int,\n    ) -> int:', number: 2 },
  ])
})

test('保留结构语言的作用域，不把注释和字符串里的括号当作用域', async () => {
  const sources = [
    ['a.py', 'class Store:\n    def run(self):\n        for item in self.items:\n            print(item)\n', 'print', ['class Store:', '    def run(self):', '        for item in self.items:']],
    ['a.go', 'package main\nfunc run() {\n  for i := 0; i < 3; i++ {\n    println(i)\n  }\n}', 'println', ['func run() {', '  for i := 0; i < 3; i++ {']],
    ['a.java', 'class Store {\n  void run() {\n    System.out.println("done");\n  }\n}', 'System', ['class Store {', '  void run() {']],
    ['a.rs', 'fn run() {\n  for value in 0..10 {\n    println!("{}", value);\n  }\n}', 'println', ['fn run() {', '  for value in 0..10 {']],
    ['a.cpp', 'class Store {\n  void run() {\n    int value = 1;\n  }\n};', 'int value', ['class Store {', '  void run() {']],
    ['a.js', 'function run() {\n  /* function fake() {\n    comment\n  } */\n  return `{\n    text\n  }`;\n}', 'comment', ['function run() {']],
    ['a.js', 'function run() {\n  return `{\n    text\n  }`;\n}', 'text', ['function run() {']],
  ] as const
  for (const [file, text, at, expected] of sources) assert.deepEqual((await headers(file, text, at)).map(line => line.text), expected, file)
})

test('文件首行、空文件、纯文本和旧词法模式没有虚构的粘性作用域', async () => {
  for (const [file, text, at] of [
    ['a.ts', 'export class Store {\n}', 'export'], ['a.ts', '', ''],
    ['a.txt', 'not a class {\n  plain text\n}', 'plain'], ['a.sh', 'function run() {\n  echo ready\n}', 'echo'],
  ]) assert.deepEqual(await headers(file, text, at), [])
})

test('同一行开始的嵌套声明去重，深层嵌套最多三行', async () => {
  const text = 'class A { method() {\n  for (;;) {\n    if (true) {\n      while (true) {\n        console.log(1)\n      }\n    }\n  }\n}}'
  assert.deepEqual((await headers('a.ts', text, 'console')).map(line => line.number), [1, 2, 3])
})

test('尚未闭合的类和函数仍沿真实语法树展示作用域', async () => {
  const text = 'export class Store {\n  run() {\n    const value = 1;\n    console.log(value);\n'
  assert.deepEqual((await headers('a.ts', text, 'console')).map(line => line.number), [1, 2])
})
