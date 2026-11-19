import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLanguage } from '../../../../builtin/workbench/editor/languages.js'
import { parameterRange } from '../../../../builtin/workbench/editor/parameters.js'

test('TypeScript方法、泛型、访问修饰符和生成器映射到原签名的参数', async () => {
  const { language } = await loadLanguage('sample.ts')
  for (const declaration of [
    'execute(value: number): number', 'async execute<T>(value: T): Promise<T>',
    'private static execute(value: number): void', '*execute(value: number): Generator<number>',
    '#execute(value: number): number', 'constructor(value: number)', 'set value(value: number)',
  ]) {
    const range = parameterRange(declaration, language, { argument: 0, keyword: null, member: true })
    assert.ok(range, declaration)
    assert.equal(declaration.slice(range.from, range.to), declaration.includes('value: T') ? 'value: T' : 'value: number', declaration)
    assert.equal(range.name, 'value', declaration)
  }
})

test('方法的泛型约束、嵌套函数类型和默认值不抢占外层参数', async () => {
  const { language } = await loadLanguage('sample.ts')
  const declaration = 'execute<T extends (key: string) => number>(first: Map<string, number>, next: (a: number, b: string) => void, label = "a,b", ...remaining: string[]): void'
  for (const [argument, expected, name] of [
    [0, 'first: Map<string, number>', 'first'], [1, 'next: (a: number, b: string) => void', 'next'],
    [2, 'label = "a,b"', 'label'], [8, '...remaining: string[]', 'remaining'],
  ] as const) {
    const range = parameterRange(declaration, language, { argument, keyword: null, member: true })
    assert.ok(range)
    assert.equal(declaration.slice(range.from, range.to), expected)
    assert.equal(range.name, name)
  }
})

test('JavaScript和TSX方法保留默认值，普通函数、箭头及无参方法保持原约定', async () => {
  for (const file of ['sample.js', 'sample.tsx']) {
    const { language } = await loadLanguage(file)
    for (const declaration of ['execute(first, next = "a,b")', 'function execute(first, next = "a,b")', 'const execute = (first, next = "a,b") =>']) {
      const range = parameterRange(declaration, language, { argument: 1, keyword: null })
      assert.ok(range, declaration)
      assert.equal(declaration.slice(range.from, range.to), 'next = "a,b"')
      assert.equal(parameterRange(declaration, language, { argument: 3, keyword: null }), null)
      assert.equal(parameterRange(declaration, language, { argument: 0, spread: true }), null)
    }
    assert.equal(parameterRange('execute()', language, { argument: 0, keyword: null }), null)
    assert.equal(parameterRange('get value()', language, { argument: 0, keyword: null }), null)
  }
})
