import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze, SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'

test('JavaScript 和 TypeScript 的重新赋值是用法，不是新声明', async () => {
  const text = 'function run(input) {\n  let total = input;\n  total += 1;\n  total = total + 1;\n  input = 3;\n  this.count = total;\n  return total;\n}\nunknown = 1;'
  for (const file of ['store.js', 'store.ts']) {
    const { symbols } = await analyze(file, text, false)
    assert.deepEqual(symbols.map(item => item.name), ['run', 'total'], file)
    assert.equal(symbols[1]!.offset, text.indexOf('total'))
  }
})

test('C、C++、Rust、Java 和 Go 也只记录声明，参数和变量写入仍属于用法', async () => {
  const samples = [
    ['store.c', 'int run(int input) { int total = input; total += 1; total = total + 1; input = 3; return total; }'],
    ['store.cpp', 'int run(int input) { int total = input; total += 1; total = total + 1; input = 3; return total; }'],
    ['store.rs', 'fn run(mut input: i32) -> i32 { let mut total = input; total += 1; total = total + 1; input = 3; total }'],
    ['Store.java', 'class Store { int run(int input) { int total = input; total += 1; total = total + 1; input = 3; return total; } }'],
    ['store.go', 'package store\nfunc run(input int) int {\n total := input\n total += 1\n total = total + 1\n input = 3\n return total\n}'],
  ]
  for (const [file, text] of samples) {
    const { symbols } = await analyze(file!, text!, false)
    assert.equal(symbols.filter(item => item.name === 'total').length, 1, file)
    assert.equal(symbols.some(item => item.name === 'input'), false, file)
    assert.equal(symbols.filter(item => item.name === 'run').length, 1, file)
  }
})

test('显式声明保留不同代码块和函数内的同名变量及解构绑定', async () => {
  const text = 'const total = 0;\nfunction run() { let total = 1; { let total = 2; total += 1; } }\nconst {name: alias, id, ...rest} = source;\nconst [first, second] = items;'
  const { symbols } = await analyze('store.ts', text, false)
  assert.equal(symbols.filter(item => item.name === 'total').length, 3)
  for (const name of ['alias', 'id', 'rest', 'first', 'second']) assert.equal(symbols.filter(item => item.name === name).length, 1, name)
  assert.equal(symbols.some(item => ['source', 'items', 'name'].includes(item.name)), false)
})

test('循环保留声明及解构绑定，复用已有循环变量不新增定义', async () => {
  const text = 'function run(items) {\n for (const value of items) {}\n for (value of items) {}\n for (let key in items) {}\n for (const [first, second] of items) {}\n}'
  assert.deepEqual((await analyze('store.ts', text, false)).symbols.map(item => item.name), ['run', 'value', 'key', 'first', 'second'])
})

test('Go 的多变量声明保留全部名字，短声明只新增当前作用域尚未绑定的变量', async () => {
  const text = 'package store\nvar global, other = 1, 2\nfunc run(input int) int {\n total := input\n total, next := 1, 2\n input, more := 3, 4\n {total := 5; total, last := 6, 7; total=last}\n return total + more\n}\nfunc second() {total := 0}\n'
  assert.deepEqual((await analyze('store.go', text, false)).symbols.map(item => item.name), ['global', 'other', 'run', 'total', 'next', 'more', 'total', 'last', 'second', 'total'])
})

const dynamic = [
  { file: 'store.py', text: 'total = 0\ntotal = 1\nclass Store:\n    def run(self, input):\n        total = input\n        total += 1\n        total = total + 1\n        input = 3\n        self.count = total\n        return total\n    def other(self):\n        total = 1\n        return total\n', names: ['total', 'Store', 'run', 'total', 'other', 'total'] },
  { file: 'store.php', text: '<?php\n$total = 0;\n$total = 1;\nfunction run($input) {\n  $total = $input;\n  $total += 1;\n  $total = 3;\n  $input = 4;\n  $this->count = $total;\n  return $total;\n}\nfunction other() {$total=1;}', names: ['total', 'run', 'total', 'other', 'total'] },
]

for (const { file, text, names } of dynamic) test(`${file}：保留各作用域的首次赋值，后续赋值和参数写入不重复定义`, async () => {
  const compact = await analyze(file, text, false), detailed = await analyze(file, text)
  assert.deepEqual(compact.symbols.map(item => item.name), names)
  assert.deepEqual(detailed.symbols.map(item => [item.name, item.offset]), compact.symbols.map(item => [item.name, item.offset]))
  const index = new SymbolIndex()
  await index.change(file, text)
  assert.deepEqual(index.declarations(file).map(item => item.offset), compact.symbols.map(item => item.offset))
})

test('Python 多目标和链式赋值保留绑定，不将右侧变量、默认参数或外部绑定视为新定义', async () => {
  const text = 'total = 0\nfirst, second = (1, 2)\nchain = another = 3\ndef run(input: int = total, *args, **kwargs):\n    input = 4\n    args = ()\n    kwargs = {}\n    global total\n    total = 4\n    if True:\n        current = 1\n    current = 2\n    def inner():\n        nonlocal input\n        input = 5\n    return current\n'
  assert.deepEqual((await analyze('store.py', text, false)).symbols.map(item => item.name), ['total', 'first', 'second', 'chain', 'another', 'run', 'current', 'inner'])
})

test('PHP 闭包参数、use 捕获和 global 写入不产生伪声明，闭包自己的变量仍独立', async () => {
  const text = '<?php\nfunction run(int $input=1, ...$args) {\n global $total;\n $input=4; $args=[]; $total=4;\n $local=1;\n $fn=function($other) use ($input) { $other=1; $input=3; $local=0; $local=2; };\n $local=3;\n}'
  assert.deepEqual((await analyze('store.php', text, false)).symbols.map(item => item.name), ['run', 'local', 'fn', 'local'])
})

test('声明导航将重新赋值列为用法，从重新赋值处跳转到原声明', async () => {
  for (const [file, text, name] of [
    ['store.ts', 'let total = 0;\ntotal += 1;\ntotal = total + 1;', 'total'],
    ['store.py', 'total = 0\ntotal += 1\ntotal = total + 1\n', 'total'],
    ['store.php', '<?php\n$total = 0;\n$total += 1;\n$total = $total + 1;', '$total'],
  ]) {
    const index = new SymbolIndex()
    await index.change(file!, text!)
    const declaration = index.candidates(file!, name!)[0]!
    assert.equal(index.candidates(file!, name!).length, 1, file)
    const usages = await index.navigate(file!, name!, declaration.offset)
    assert.equal(usages.kind, 'usages')
    assert.equal(usages.matches.length, 3, file)
    assert.equal(usages.ambiguous, false)
    const navigation = await index.navigate(file!, name!, text!.lastIndexOf(name!) + 1)
    assert.equal(navigation.kind, 'definitions')
    assert.deepEqual(navigation.matches.map(item => item.offset), [declaration.offset])
  }
})

test('大量重新赋值不淹没文件结构，也不合并其他函数中的同名变量', async () => {
  const text = 'function first() {\nlet total=0;\n' + 'total += 1;\n'.repeat(3000) + '}\nfunction second() { let total=1; total=2; }'
  const { symbols } = await analyze('large.js', text, false)
  assert.deepEqual(symbols.map(item => item.name), ['first', 'total', 'second', 'total'])
})

test('函数绑定参与函数筛选，回调容器和调用结果仍是变量', async () => {
  const samples = [
    ['sample.js', 'const arrow = x => x, number = 1; const expression = function named() {}; const wrapped = (/* 保留注释 */ (() => 1)); const callback = make(() => 1); const container = {run: () => 1};', ['arrow', 'expression', 'wrapped']],
    ['sample.ts', 'const arrow: (x: number) => number = async (x: number) => x, number = 1; const expression = function named() {}; const wrapped = (() => 1); const callback = make(() => 1); const container = {run: () => 1};', ['arrow', 'expression', 'wrapped']],
    ['sample.py', 'arrow = lambda x: x\nnumber = 1\ncallback = make(lambda x: x)\ncontainer = [lambda x: x]\n', ['arrow']],
    ['sample.go', 'package demo\nfunc run() { arrow := func(x int) int {return x}; var expression = func() {}; number := 1; callback := make(arrow); container := []func(){expression} }', ['arrow', 'expression']],
    ['sample.rs', 'fn main() { let arrow = |x: i32| x; let number = 1; let callback = make(|| 1); let container = [|| 1]; }', ['arrow']],
    ['sample.php', '<?php $arrow = fn($x) => $x; $expression = function($x) { return $x; }; $number=1; $callback = make(fn()=>1); $container = [fn()=>1];', ['arrow', 'expression']],
  ] as const
  for (const [file, text, functions] of samples) {
    const result = await analyze(file, text, false), index = new SymbolIndex()
    await index.change(file, text)
    for (const symbols of [result.symbols, (await analyze(file, text)).symbols, index.declarations(file)]) {
      const kinds = Object.fromEntries(symbols.map(item => [item.name, item.kind]))
      for (const name of functions) assert.equal(kinds[name], 'function', `${file}: ${name}`)
      for (const name of ['number', 'callback', 'container']) assert.equal(kinds[name], 'variable', `${file}: ${name}`)
      assert.equal(symbols.filter(item => item.name === 'arrow').length, 1, file)
    }
  }
})
