import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex } from '../../../../builtin/workbench/analysis/index.js'

test('不完整声明、Unicode及不同换行保留符号位置', async () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const text = '// 注释😀' + separator + 'const first = "🧪"; const 数量: number ='
    const index = new SymbolIndex()
    await index.change('sample.ts', text)
    const symbol = (await index.describe(index.candidates('sample.ts', '数量')))[0]!
    assert.equal(symbol.offset, text.replace(/\r\n?/g, '\n').indexOf('数量'))
    assert.equal(symbol.declaration, 'const 数量: number =')
  }
})

test('项目符号按名称和来源路径检索，同名多语言声明分别保留，限制结果并支持取消', async () => {
  const index = new SymbolIndex()
  await index.change('src/a.ts', 'export function calculate() {}')
  await index.change('test/b.ts', 'export function calculate() {}')
  await index.change('中文/c.py', 'def calculate():\n    return 1')
  assert.deepEqual((await index.symbols('calculate')).matches.map(item => item.file).sort(), ['src/a.ts', 'test/b.ts', '中文/c.py'])
  assert.equal((await index.symbols('CALCULATE 中文')).matches[0].file, '中文/c.py')
  const limited = await index.symbols('calculate', 2)
  assert.equal(limited.matches.length, 2); assert.equal(limited.truncated, true); assert.equal(limited.indexed, 3)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(index.symbols('', 1000, abort.signal), { name: 'AbortError' })
  index.remove('src/a.ts'); assert.equal((await index.symbols('calculate')).matches.length, 2)
})
