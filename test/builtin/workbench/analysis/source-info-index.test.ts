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
