import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeType, Tree, TreeCursor } from '@lezer/common'
import { analyze, SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'
import { sourceDeclarations } from '../../../../builtin/workbench/analysis/declarations.js'
import { parseSource } from '../../../../builtin/workbench/analysis/source-info.js'

test('大型接口的声明名称扫描不反复遍历已无关的成员', async () => {
  const text = 'interface Contract {\n' + Array.from({ length: 1000 }, (_, i) => `method${i}(value: number): number;`).join('\n') + '\n}\nconst after = 1;'
  const { tree } = await parseSource('sample.ts', text)
  const iterate = Tree.prototype.iterate, next = TreeCursor.prototype.next
  let steps = 0, result
  Tree.prototype.iterate = function (spec) {
    return iterate.call(this, { ...spec, enter(node) { steps++; return spec.enter(node) } })
  }
  TreeCursor.prototype.next = function (enter) { steps++; return next.call(this, enter) }
  try { result = sourceDeclarations(tree, text, 'ts') }
  finally { Tree.prototype.iterate = iterate; TreeCursor.prototype.next = next }
  assert.deepEqual(result.map(item => item.name), ['Contract', 'after'])
  assert.ok(steps < 80000, `1000个成员的声明提取访问了${steps}个语法节点`)
})

test('大初始化表达式中的引用不冒充声明，尾部声明及完整签名保留', async () => {
  const text = 'int result[] = {' + Array.from({ length: 1000 }, (_, i) => `seed${i}`).join(',') + '};\nint after = 1;'
  const compact = await analyze('sample.c', text, false), detailed = await analyze('sample.c', text)
  assert.deepEqual(compact.symbols.map(item => item.name), ['result', 'after'])
  assert.deepEqual(detailed.symbols.map(item => [item.name, item.offset]), compact.symbols.map(item => [item.name, item.offset]))
  assert.equal(detailed.symbols[0].declaration, 'int result[] =')
  assert.equal(detailed.symbols[1].declaration, 'int after = 1')
})

test('不完整声明不把零长度占位名称放入索引', async () => {
  const text = 'interface { member(value: number): number; }\nconst after = 1;'
  const index = new SymbolIndex()
  await index.change('sample.ts', text)
  for (const symbols of [(await analyze('sample.ts', text, false)).symbols, (await analyze('sample.ts', text)).symbols, index.declarations('sample.ts')]) {
    assert.deepEqual(symbols.map(item => item.name), ['after'])
    assert.equal(symbols[0].offset, text.indexOf('after'))
  }
  assert.deepEqual(index.candidates('sample.ts', ''), [])
})

test('名称查找跳过参数与函数体并局限于本声明，首个名称可在偏移零处', () => {
  const type = (id: number, name: string) => NodeType.define({ id, name })
  const program = type(0, 'Program'), declaration = type(1, 'FunctionDeclaration'), identifier = type(2, 'Identifier'), parameters = type(3, 'ParamList'), body = type(4, 'Block')
  const leaf = (length: number) => new Tree(identifier, [], [], length)
  const anonymous = new Tree(declaration, [new Tree(parameters, [leaf(9)], [0], 9), new Tree(body, [leaf(4)], [0], 4)], [0, 10], 14)
  const named = new Tree(declaration, [leaf(4)], [0], 4)
  const tree = new Tree(program, [anonymous, named], [0, 15], 19)
  assert.deepEqual(sourceDeclarations(tree, 'parameter body next', 'c'), [{ name: 'next', offset: 15, kind: 'function' }])
  assert.deepEqual(sourceDeclarations(new Tree(program, [named], [0], 4), 'next', 'c'), [{ name: 'next', offset: 0, kind: 'function' }])
})

test('常用语法树语言保留声明、嵌套绑定、泛型与不同作用域的同名位置', async () => {
  const samples = [
    ['sample.ts', 'type Container<T extends {input: number}> = { read(value: T): T; }; const after = 1;', ['Container', 'after']],
    ['sample.cpp', 'template<class T> T run(T input) { T local = input; return local; }', ['run', 'local']],
    ['sample.java', 'class Store { int run(int input) { int local = input; return local; } int other(int input) { int local = input; return local; } }', ['Store', 'run', 'local', 'other', 'local']],
    ['sample.rs', 'fn run<T>(input: T) -> T { let local = input; local }', ['run', 'local']],
    ['sample.go', 'package sample\nvar first, second = 1, 2\nfunc run(input int) int { local := input; return local }', ['first', 'second', 'run', 'local']],
    ['sample.py', 'def run(input):\n    local = input\n    return local\ndef other(input):\n    local = input\n    return local\n', ['run', 'local', 'other', 'local']],
    ['sample.php', '<?php function run($input) { $local = $input; return $local; }', ['run', 'local']],
  ] as const
  for (const [file, text, names] of samples) {
    const compact = await analyze(file, text, false), detailed = await analyze(file, text)
    assert.deepEqual(compact.symbols.map(item => item.name), names, file)
    assert.deepEqual(detailed.symbols.map(item => [item.name, item.offset]), compact.symbols.map(item => [item.name, item.offset]), file)
    assert.equal(new Set(compact.symbols.map(item => item.offset)).size, compact.symbols.length, file)
  }
})

test('空语法树与无声明的源码返回空列表，不读取不存在的名称', async () => {
  assert.deepEqual(sourceDeclarations(null, '', 'ts'), [])
  for (const text of ['', '// 只有说明\n', '"value";']) {
    const { tree } = await parseSource('sample.ts', text)
    assert.deepEqual(sourceDeclarations(tree, text, 'ts'), [])
  }
})
