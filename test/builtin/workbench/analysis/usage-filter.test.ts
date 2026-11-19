import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex, analyze } from '../../../../builtin/workbench/analysis/index.js'
import { mayContain, textFilter } from '../../../../builtin/workbench/analysis/text-filter.js'
import { literalMatches } from '../../../../src/workbench/search-query.js'

test('查找用法跳过与名称无关的中英文混合文件，保留插值中的位置', async () => {
  const texts = new Map([
    ['billing.ts', 'export function calculateInvoice() { return 1; }\r\ncalculateInvoice();'],
    ['中文 目录/cart.mts', '// 计算订单金额 🧪\r\nconst label = `总价：${calculateInvoice()}`;'],
    ['note.ts', '// 示例 calculateInvoice()\nconst note = "calculateInvoice()";'],
    ...Array.from({ length: 48 }, (_, index): [string, string] => [
      `item${index}.ts`, `// 示例商品 ${index}\nexport const item${index} = ${index};`,
    ]),
  ])
  const reads: string[] = [], detailed: string[] = []
  const index = new SymbolIndex((file: string, text: string, detail?: boolean) => {
    if (detail !== false) detailed.push(file)
    return analyze(file, text, detail)
  }, { read: async (file: string) => { reads.push(file); return texts.get(file)! } })
  for (const [file, text] of texts) await index.change(file, text)
  for (const key of index.cache.keys()) index.forget(key)

  const [definition] = index.candidates('billing.ts', 'calculateInvoice')
  const result = await index.navigate(definition.file, definition.name, definition.offset)
  assert.equal(result.kind, 'usages')
  assert.deepEqual(result.matches.map(item => [item.file, item.line]), [['billing.ts', 1], ['中文 目录/cart.mts', 1]])
  for (const item of result.matches) assert.equal(item.lineText.slice(item.character, item.character + item.length), definition.name)
  assert.deepEqual(reads, ['billing.ts', '中文 目录/cart.mts', 'note.ts'])
  assert.deepEqual(detailed, reads)
})

test('混合字符后的 ASCII 片段仍可筛选，非 ASCII 与短查询仍走完整匹配', () => {
  const text = 'abc中文🚀DEF\0GHI\r\nfoo.bar [x] 计算'
  const filter = textFilter(text)
  for (const query of ['ABC', 'def\0G', 'GHI\r\n', 'FOO.BAR', '[X]', '计算', '🚀Def', 'a', 'xy']) {
    assert.equal(mayContain(filter, query), true, query)
  }
  for (const query of ['abcdef', 'no-invoice-here', 'calculate']) assert.equal(mayContain(filter, query), false, query)
  assert.equal(mayContain(textFilter('中文🚀'), 'def'), false)
})

test('Unicode 折叠到 ASCII 的匹配覆盖片段的开头、中间和末尾', () => {
  for (const [text, query] of [
    ['中文 ſtring', 'STRING'], ['🧪 ſKs', 'SKS'], ['价目表 BillKit', 'billkit'], ['中文 Docſ', 'docs'],
  ]) {
    assert.equal([...literalMatches(text, query, false)].length, 1, query)
    assert.equal(mayContain(textFilter(text), query), true, query)
  }
  assert.equal(mayContain(textFilter('İıßＫſK'), 'iss'), false)
})

test('查找中文名称继续返回同文件和跨文件的用法', async () => {
  const texts = new Map([
    ['billing.ts', 'function 计算账单() {}\n计算账单();'],
    ['cart.ts', '// 说明 🧪\n计算账单();'],
  ])
  const index = new SymbolIndex(undefined, { cacheBytes: 0, read: async (file: string) => texts.get(file)! })
  for (const [file, text] of texts) await index.change(file, text)
  const [definition] = index.candidates('billing.ts', '计算账单')
  const result = await index.navigate(definition.file, definition.name, definition.offset)
  assert.equal(result.kind, 'usages')
  assert.deepEqual(result.matches.map(item => [item.file, item.line, item.character]), [['billing.ts', 1, 0], ['cart.ts', 1, 0]])
})
