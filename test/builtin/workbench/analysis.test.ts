import test from 'node:test'
import assert from 'node:assert/strict'
import { SymbolIndex } from '../../../builtin/workbench/analysis/index.js'
import { languages, fixtureFiles } from './fixtures/fixtures.mjs'
import { syntaxSuggestions } from '../../../builtin/workbench/editor/languages.js'
import { zh, en, message } from '../../../builtin/workbench/locales.js'

for (const language of languages) test(`${language.language}：定义、变量、跨文件用法和源码签名`, async () => {
  const index = new SymbolIndex(), file = `${language.id}/billing.${language.ext}`, caller = `${language.id}/main.${language.ext}`
  await index.change(file, language.source); await index.change(caller, language.call)
  const definitions = await index.describe(index.candidates(caller, language.fn))
  assert.equal(definitions.length, 1)
  const symbol = definitions[0]!
  assert.equal(symbol.file, file)
  assert.ok(symbol.declaration.includes(language.fn))
  assert.ok(index.candidates(caller, language.variable).some(item => item.file === file))
  assert.ok(index.candidates(caller, language.fn.slice(0, -3), false).some(item => item.name === language.fn))
  assert.ok(index.candidates(caller, language.variable.slice(0, -2), false).some(item => item.name === language.variable))
  const usages = await index.navigate(file, language.fn, symbol.offset)
  assert.equal(usages.kind, 'usages')
  assert.ok(usages.matches.some(item => item.file === caller))
})

test('基础索引处理结构文件、不完整代码、多个变量和 Go 接收者方法', async () => {
  const index = new SymbolIndex(), fixtures = fixtureFiles()
  for (const file of ['data/config.json', 'data/schema.sql', 'data/index.html', 'data/style.css', 'edges/incomplete.py', 'edges/emoji.js']) {
    await index.change(file, fixtures.get(file)!)
    assert.ok(index.files.get(file)!.symbols.length > 0, file)
  }
  assert.equal(index.candidates('edges/emoji.js', 'emojiFunction')[0]!.character, 28)
  await index.change('broken.json', '{"unfinished')
  await index.change('vars.mts', 'const first = 1, second = 2;')
  assert.ok(index.candidates('caller.ts', 'second').length > 0)
  await index.change('method.go', 'package billing\nfunc (b Billing) Total(price int) int { return price }')
  const method = (await index.describe(index.candidates('caller.go', 'Total')))[0]!
  assert.ok(method.declaration.includes('price int'))
  await index.change('call.cs', 'class Main { double Run() {\nreturn CalculateCsTotal(100);\n} }')
  assert.equal(index.candidates('caller.cs', 'CalculateCsTotal').length, 0)
})

test('语言后缀别名与大小写使用同一套符号规则', async () => {
  const index = new SymbolIndex()
  await index.change('billing.PHP', '<?php\n$subtotal = 100;\nfunction calculateTotal($price) { return $price; }')
  const call = '<?php\ncalculateTotal($subtotal);'
  await index.change('main.php', call)
  assert.equal(index.candidates('main.php', '$subtotal')[0]!.name, 'subtotal')
  assert.equal(index.candidates('billing.PHP', '$subtotal')[0]!.name, 'subtotal')
  const declaration = await index.navigate('main.php', '$subtotal', call.indexOf('$subtotal') + 3)
  assert.equal(declaration.matches[0]!.file, 'billing.PHP')
  await index.change('billing.pyi', 'def calculate_total(price: float) -> float:\n    """计算总金额。"""\n    ...')
  assert.match((await index.describe(index.candidates('main.py', 'calculate_total')))[0]!.documentation.description, /计算总金额/)
})

test('补全和编辑器文案跟随语言，常用语言提供基础类型', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const [file, type] of [['main.ts', 'number'], ['main.py', 'float'], ['main.cpp', 'int'], ['main.java', 'double'], ['main.cs', 'string'], ['main.swift', 'Int']]) {
    assert.ok(syntaxSuggestions(file!).some(item => item.label === type && item.type === 'type'))
  }
  assert.ok(syntaxSuggestions('main.ts', key => en[key]).some(item => item.detail === 'Primitive type'))
  assert.ok(syntaxSuggestions('main.ts', key => zh[key]).some(item => item.detail === '基础类型'))
  assert.equal(message(key => en[key], 'sourceLocation', { file: 'main.ts', line: 3 }), 'main.ts · Line 3')
})

test('代码索引保留类型、参数文档和真实引用，排除注释与字符串', async () => {
  const index = new SymbolIndex(), files = fixtureFiles()
  for (const file of ['documentation/pricing.ts', 'documentation/checkout.ts']) await index.change(file, files.get(file)!)
  const symbol = (await index.describe(index.candidates('documentation/checkout.ts', 'calculateTotal')))[0]!
  assert.match(symbol.declaration, /price: number/)
  assert.match(symbol.declaration, /\): number/)
  assert.match(symbol.documentation.description, /含税金额/)
  assert.ok(symbol.documentation.params.some(item => item.name === 'taxRate'))
  const result = await index.navigate(symbol.file, symbol.name, symbol.offset)
  assert.deepEqual(result.matches.filter(item => item.file === 'documentation/checkout.ts').map(item => item.line), [0, 3, 6, 11])
})

test('索引更新移除旧定义，搜索支持单行多次匹配、中文和空查询', async () => {
  const index = new SymbolIndex()
  await index.change('中文 目录/文件.ts', 'function 计算合计() {}\n计算合计(); 计算合计();')
  assert.equal(index.candidates('other.js', '计算合计').length, 1)
  assert.equal((await index.search('计算合计')).matches.length, 3)
  assert.deepEqual(await index.search(''), { matches: [], truncated: false })
  assert.equal((await index.search('计算合计', 1)).truncated, true)
  await index.change('中文 目录/文件.ts', '')
  assert.equal(index.candidates('other.js', '计算合计').length, 0)
})

test('全局搜索直接返回原文位置，Unicode 大小写转换和表情不偏移选区', async () => {
  const index = new SymbolIndex(), text = '// İ前缀 🧪 Value VALUE [x] value\nconst next = "😀 value";'
  await index.change('unicode.ts', text)
  for (const query of ['value', 'VALUE', '🧪', '[x]', '😀', '前缀']) {
    const result = await index.search(query)
    for (const match of result.matches) {
      const line = text.split('\n')[match.line]!
      assert.equal(line.slice(match.character, match.character + match.length).toLowerCase(), query.toLowerCase())
    }
    assert.equal(result.matches.length, query.toLowerCase() === 'value' ? 4 : 1)
  }
  assert.deepEqual((await index.search('value', 2)).matches.map(item => item.character), [text.indexOf('Value'), text.indexOf('VALUE')])
  assert.equal((await index.search('value', 2)).truncated, true)
})

test('异步分析保留最新缓冲区，删除后不恢复旧索引', async () => {
  const index = new SymbolIndex()
  await index.change('main.ts', 'function original() {}')
  const stale = index.change('main.ts', 'function stale() {}')
  await index.change('main.ts', 'function original() {}')
  await stale
  assert.equal(index.candidates('main.ts', 'stale').length, 0)
  assert.equal(index.candidates('main.ts', 'original').length, 1)
  const pending = index.change('deleted.ts', 'function removed() {}')
  index.remove('deleted.ts')
  await pending
  assert.equal(index.files.has('deleted.ts'), false)
  const clearing = index.change('cleared.ts', 'function cleared() {}')
  index.clear()
  await clearing
  assert.equal(index.files.size, 0)
})

test('不同换行风格的索引与编辑器使用相同坐标，定义、用法及搜索可准确跳转', async () => {
  const normalized = '// header\n'.repeat(12) + 'function plus(value: number) { return value + 1; }\nplus(2);\n'
  for (const separator of ['\n', '\r\n', '\r']) {
    const index = new SymbolIndex(), text = normalized.replaceAll('\n', separator)
    await index.change('main.ts', text)
    const definition = index.candidates('main.ts', 'plus')[0]!
    assert.equal(definition.offset, normalized.indexOf('plus'))
    assert.equal(definition.line, 12)
    const target = await index.navigate('main.ts', 'plus', normalized.lastIndexOf('plus') + 2)
    assert.equal(target.kind, 'definitions'); assert.equal(target.matches[0]?.offset, definition.offset)
    const usages = await index.navigate('main.ts', 'plus', definition.offset)
    assert.equal(usages.kind, 'usages'); assert.equal(usages.matches[0]?.line, 13)
    assert.deepEqual((await index.search('plus')).matches.map((match: any) => [match.line, match.character]), [[12, 9], [13, 0]])
  }
})
