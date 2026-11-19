import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from '../../../../builtin/workbench/analysis/index.js'
import { parseSource, sourceSignature } from '../../../../builtin/workbench/analysis/source-info.js'

async function signatures(file: string, text: string) {
  return Object.fromEntries((await analyze(file, text)).symbols.map(symbol => [symbol.name, symbol.declaration]))
}

test('单行独立变量声明各自保留类型与初始化值，不带入前后声明', async () => {
  const text = 'export const first: number = 1; let second: string = "done"; const third = 3;'
  assert.deepEqual(await signatures('sample.ts', text), {
    first: 'const first: number = 1', second: 'let second: string = "done"', third: 'const third = 3',
  })
})

test('大量单行独立声明的签名总量只随各自声明增长', async () => {
  const rows = Array.from({ length: 800 }, (_, i) => `export const item${i}: number = ${i};`)
  const result = await analyze('dense.ts', rows.join(''))
  assert.deepEqual(result.symbols.map(symbol => symbol.declaration), rows.map(row => row.replace(/^export /, '').replace(/;$/, '')))
  assert.equal(result.symbols.at(-1)!.offset, rows.join('').lastIndexOf('item799'))
})

test('箭头及匿名函数的源码头不带入同一行的其他声明', async () => {
  const text = 'const first = 1; const run = (value: number): number => { return value; }; const read = function(value: string) { return value; };'
  const result = await signatures('sample.ts', text)
  assert.equal(result.run, 'const run = (value: number): number =>')
  assert.equal(result.read, 'const read = function(value: string)')
  assert.equal(result.first, 'const first = 1')
})

test('Python、Go、Rust、C/C++、Java和PHP按语法声明保留已有类型', async () => {
  for (const [file, text, expected] of [
    ['sample.py', 'first: int = 1; second: str = "done"', { first: 'first: int = 1', second: 'second: str = "done"' }],
    ['sample.go', 'package main\nvar first int = 1; var second string = "done"', { first: 'first int = 1', second: 'second string = "done"' }],
    ['sample.rs', 'const first: i32 = 1; const second: i32 = 2;', { first: 'const first: i32 = 1', second: 'const second: i32 = 2' }],
    ['sample.c', 'int first = 1; int second = 2;', { first: 'int first = 1', second: 'int second = 2' }],
    ['sample.cpp', 'int first = 1; int second = 2;', { first: 'int first = 1', second: 'int second = 2' }],
    ['sample.java', 'class Store { int first = 1; String second = "done"; }', { first: 'int first = 1', second: 'String second = "done"' }],
    ['sample.php', '<?php $first = 1; $second = 2;', { first: '$first = 1', second: '$second = 2' }],
  ] as const) {
    const result = await signatures(file, text)
    for (const [name, signature] of Object.entries(expected)) assert.equal(result[name], signature, `${file}: ${name}`)
  }
})

test('同一声明中的多个绑定保留共享类型、解构及跨行源码', async () => {
  const text = 'const first: number = 1, second: string = "two";\nconst { left, right } = point;\nconst values: Array<number> = [\n  1, 2,\n];'
  const result = await signatures('sample.ts', text)
  assert.equal(result.first, 'const first: number = 1, second: string = "two"')
  assert.equal(result.second, result.first)
  assert.equal(result.values, 'const values: Array<number> = [')
})

test('普通函数、多行参数及紧邻文档保持，修改后不使用旧签名', async () => {
  const text = 'const prefix = 1;\n/** 读取任务。\n * @param value 输入任务\n */\nexport function run(\n  value: number,\n): number { return value; }\nconst suffix = 2;'
  const result = await analyze('sample.ts', text), symbol = result.symbols.find(item => item.name === 'run')!
  assert.equal(symbol.declaration, 'function run(\n  value: number,\n): number')
  assert.match(symbol.documentation.description, /读取任务/)
  assert.ok(symbol.documentation.params.some(item => item.name === 'value'))
  const changed = await signatures('sample.ts', text.replaceAll('number', 'string'))
  assert.match(changed.run, /value: string/)
  assert.doesNotMatch(changed.run, /number/)
})

test('缺少语法树时保留原有源码头规则，空源码可以返回空签名', async () => {
  const parsed = { tree: null, excluded: [] }, text = 'public int Run(\n  int value\n) { return value; }'
  assert.equal(sourceSignature(text, { offset: text.indexOf('Run'), kind: 'function' }, parsed), 'public int Run(\nint value)')
  assert.equal(sourceSignature('', { offset: 0, kind: 'variable' }, parsed), '')
})

test('源码头范围从实际语法读取，字符串中的分号不拆成声明', async () => {
  const text = 'const first: string = "left;right"; const second = call(1, "a;b");'
  const parsed = await parseSource('sample.ts', text)
  assert.equal(sourceSignature(text, { offset: text.indexOf('first'), kind: 'variable' }, parsed), 'const first: string = "left;right"')
  assert.equal(sourceSignature(text, { offset: text.indexOf('second'), kind: 'variable' }, parsed), 'const second = call(1, "a;b")')
})
