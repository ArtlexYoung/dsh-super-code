import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'
import { callAt, parameterRange } from '../../../../builtin/workbench/editor/parameters.js'

async function state(file: string, source: string) {
  const head = source.indexOf('|')
  assert.ok(head >= 0)
  const result = EditorState.create({ doc: source.replace('|', ''), selection: { anchor: head }, extensions: [await loadLanguage(file), EditorState.allowMultipleSelections.of(true)] })
  assert.ok(ensureSyntaxTree(result, result.doc.length, 1000), file)
  return result.update({}).state
}

test('参数位置使用语法树，嵌套调用、容器和字符串中的逗号不影响外层', async () => {
  const cases = [
    ['run(|)', 'run', 0], ['run(1, |2)', 'run', 1], ['run({a: 1, b: 2}, |3)', 'run', 1],
    ['run([1, 2], "a,b", |3)', 'run', 2], ['run(inner(1, |2), 3)', 'inner', 1],
    ['run(inner(1, 2), |3)', 'run', 1], ['run("a,|b", 2)', 'run', 0],
    ['run(1, /* a,b */ |2)', 'run', 1], ['run(1,\n |', 'run', 1],
    ['store?.run<Map<string,number>>(1, |2)', 'run', 1],
  ] as const
  for (const [source, name, argument] of cases) {
    const call = callAt(await state('calls.ts', source))
    assert.equal(call?.name, name, source)
    assert.equal(call?.argument, argument, source)
  }
})

test('声明、普通括号、注释、调用结束及旧词法模式不猜测参数信息', async () => {
  for (const source of ['function run(a, |b) {}', '(1, |2)', 'run(1, /* |note */ 2)', 'run(1, 2)|', 'const x = "|hello"']) {
    assert.equal(callAt(await state('calls.ts', source)), null, source)
  }
  assert.equal(callAt(await state('calls.sh', 'run 1 |2')), null)
  const original = await state('calls.ts', 'run(1, |2)')
  const selected = original.update({ selection: { anchor: 4, head: 5 } }).state
  assert.equal(callAt(selected), null)
  const multiple = original.update({ selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(7)]) }).state
  assert.equal(callAt(multiple), null)
})

test('常用语法树语言识别方法、泛型、命名参数与嵌套调用', async () => {
  const cases = [
    ['calls.py', 'obj.run(1, name=|2)', 'name'],
    ['calls.php', '<?php $obj->run(first:1, second:|2);', 'second'],
    ['calls.go', 'package main\nfunc main(){ obj.Run[int](1, |2) }', null],
    ['calls.rs', 'fn main(){ store.run(1, |2); }', null],
    ['calls.rs', 'fn main(){ run::<i32>(1, |2); }', null],
    ['calls.c', 'int main(){ run(1, |2); }', null],
    ['calls.java', 'class A { void main(){ store.run(1, |2); } }', null],
  ] as const
  for (const [file, source, keyword] of cases) {
    const call = callAt(await state(file, source))
    assert.ok(call, file)
    assert.equal(call.argument, 1, file)
    assert.equal(call.keyword, keyword, file)
    assert.match(call.name, /^(?:run|Run)$/)
  }
})

test('声明参数强调完整的类型和默认值，泛型与函数类型中的逗号不拆参数', async () => {
  const declaration = 'function run(first: Map<string, number>, next: (a: number, b: string) => void, label = "a,b")'
  const support = await loadLanguage('calls.ts'), language = support.language || support
  for (const [argument, expected] of [[0, 'first: Map<string, number>'], [1, 'next: (a: number, b: string) => void'], [2, 'label = "a,b"']] as const) {
    const range = parameterRange(declaration, language, { argument, keyword: null })
    assert.equal(declaration.slice(range.from, range.to), expected)
  }
  assert.equal(parameterRange(declaration, language, { argument: 4, keyword: null }), null)
})

test('泛型约束中的回调签名不抢占函数自身的参数', async () => {
  for (const [file, declaration, expected] of [
    ['calls.ts', 'function run<T extends (key: string) => number>(value: T, options: number): void', 'value: T'],
    ['calls.ts', 'const run = <T extends (key: string) => number>(value: T, options: number): void =>', 'value: T'],
    ['calls.rs', 'fn run<T: Fn(i32, i32) -> i32>(first: T, second: i32)', 'first: T'],
  ]) {
    const support = await loadLanguage(file), range = parameterRange(declaration, support.language || support, {argument:0,keyword:null})
    assert.ok(range, file)
    assert.equal(declaration.slice(range.from,range.to), expected)
  }
})

test('命名参数按名称对应，超过普通参数数量时不乱标，变长参数保留对应关系', async () => {
  for (const [file, declaration, call, expected] of [
    ['calls.py', 'def run(first: int, second: str):', {argument: 0, keyword: 'second'}, 'second: str'],
    ['calls.php', 'function run(int $first, string $second)', {argument: 0, keyword: 'second'}, 'string $second'],
    ['calls.ts', 'function run(first: number, ...remaining: string[])', {argument: 4, keyword: null}, '...remaining: string[]'],
    ['calls.py', 'def run(first, *remaining):', {argument: 4, keyword: null}, '*remaining'],
  ] as const) {
    const support = await loadLanguage(file), range = parameterRange(declaration, support.language || support, call)
    assert.ok(range, file)
    assert.equal(declaration.slice(range.from, range.to), expected)
  }
})

test('展开参数和隐式接收者不作错误对应，Python 参数分隔符不占参数位置', async () => {
  const ts = await loadLanguage('calls.ts'), py = await loadLanguage('calls.py')
  const spread = callAt(await state('calls.ts', 'run(...values, |2)'))
  assert.equal(spread.spread, true)
  assert.equal(parameterRange('function run(first: number, second: number)', ts.language, spread), null)
  assert.equal(parameterRange('def run(self, first):', py.language, {argument:0,keyword:null,member:true}), null)
  assert.equal(parameterRange('def run(first, **options):', py.language, {argument:4,keyword:null}), null)
  const declaration = 'def run(first, /, second, *, third):'
  const range = parameterRange(declaration, py.language, {argument:1,keyword:null})
  assert.equal(declaration.slice(range.from,range.to), 'second')
})

test('Go 同类型分组参数和 Python 仅关键字参数不会错位', async () => {
  const go = await loadLanguage('calls.go'), py = await loadLanguage('calls.py')
  const declaration = 'func run(first, second int, last string)'
  for (const argument of [0,1]) {
    const range = parameterRange(declaration, go.language, {argument,keyword:null})
    assert.equal(declaration.slice(range.from,range.to), 'first, second int')
    assert.equal(range.name, argument === 0 ? 'first' : 'second')
  }
  const range = parameterRange(declaration, go.language, {argument:2,keyword:null})
  assert.equal(declaration.slice(range.from,range.to), 'last string')
  assert.equal(parameterRange('def run(first, *, last):', py.language, {argument:1,keyword:null}), null)
  const variadic = 'def run(first, *remaining, label="ready"):'
  const rest = parameterRange(variadic, py.language, {argument:4,keyword:null})
  assert.equal(variadic.slice(rest.from,rest.to), '*remaining')
  const named = parameterRange(variadic, py.language, {argument:1,keyword:'label'})
  assert.equal(variadic.slice(named.from,named.to), 'label="ready"')
})
