import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ReadingContext } from '../../../src/workbench/reading/context.js'
import { parseReadingRequest } from '../../../src/workbench/reading/types.js'
import { readingFixture } from './fixture.js'

const input = { kind: 'plan', goal: '读懂入口', locale: 'zh', buffers: [] }
test('阅读请求拒绝空目标、非法范围、重复或超量缓冲区和未知字段', () => {
  for (const patch of [{ goal: ' ' }, { kind: 'write' }, { locale: 'xx' }, { kind: 'explain' }, { tools: true },
    { buffers: [{ path: 'a.ts', text: '', version: 'v' }, { path: 'a.ts', text: '', version: 'v' }] },
    { buffers: [{ path: 'a.ts', text: 'x'.repeat(2 * 1024 * 1024 + 1), version: 'v' }] }]) {
    assert.throws(() => parseReadingRequest({ ...input, ...patch }), /READING_REQUEST/)
  }
})

test('阅读目录包含无后缀构建入口；片段采用未保存文本并保留中文与 CRLF', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'Makefile'), 'run:\n\tnode app.js\n')
  await writeFile(join(root, '中文.ts'), 'old\r\n')
  const context = new ReadingContext(files, 's', parseReadingRequest({ ...input, file: '中文.ts', buffers: [{ path: '中文.ts', text: '// 中文\r\nconst value = 2;\r\n', version: 'buffer' }] }), new AbortController().signal)
  await context.prepare()
  assert.ok(context.catalog.includes('Makefile'))
  assert.equal(context.sources[0]!.text, '// 中文\r\nconst value = 2;\r\n')
  assert.deepEqual(context.references([{ source: 'S1', fromLine: 2, toLine: 2 }]), [{ file: '中文.ts', fromLine: 2, toLine: 2, quote: 'const value = 2;\r' }])
  assert.equal((await files.read('s', '中文.ts')).text, 'old\r\n')
})

test('源码引用不能越过已读范围，搜索命中不自动变成引用权限', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'a.ts'), 'line1\nconst target = 1;\nline3\n')
  const context = new ReadingContext(files, 's', parseReadingRequest(input), new AbortController().signal)
  await context.prepare()
  const found = await context.search('target')
  assert.equal(found.matches[0]!.line, 2)
  assert.throws(() => context.references([{ source: 'S1', fromLine: 2, toLine: 2 }]), /READING_REFERENCE/)
  await context.read({ file: 'a.ts', fromLine: 2, toLine: 2 })
  assert.equal(context.references([{ source: 'S1', fromLine: 2, toLine: 2 }])[0]!.quote, 'const target = 1;')
  for (const ref of [{ source: 'S99', fromLine: 2, toLine: 2 }, { source: 'S1', fromLine: 1, toLine: 2 }, { source: 'S1', fromLine: 2, toLine: 3 }]) assert.throws(() => context.references([ref]), /READING_REFERENCE/)
  await assert.rejects(context.read({ file: '../outside.ts', fromLine: 1, toLine: 2 }), /WORKBENCH_PATH/)
  await assert.rejects(context.read({ file: 'a.ts', fromLine: 99, toLine: 100 }), /READING_RANGE/)
})

test('空文件可解释；片段和搜索达到上限时明确覆盖不完整', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'empty.py'), '')
  await writeFile(join(root, 'large.py'), ('value = ' + 'x'.repeat(1000) + '\n').repeat(40))
  const context = new ReadingContext(files, 's', parseReadingRequest({ ...input, file: 'empty.py' }), new AbortController().signal)
  await context.prepare()
  assert.equal(context.references([{ source: 'S1', fromLine: 1, toLine: 1 }])[0]!.quote, '')
  const source = await context.read({ file: 'large.py', fromLine: 1, toLine: 40 })
  assert.ok(source.toLine < 40); assert.equal(context.partial, true)
  assert.equal((await context.search('value')).partial, true)
})

test('旧步骤片段已变时在模型调用前拒绝，不用新代码解释旧证据', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'a.ts'), 'const value = 2;')
  const context = new ReadingContext(files, 's', parseReadingRequest({ ...input, kind: 'explain', step: {
    title: '值', reason: '读取值', refs: [{ file: 'a.ts', fromLine: 1, toLine: 1, quote: 'const value = 1;' }],
  } }), new AbortController().signal)
  await assert.rejects(context.prepare(), /READING_REFERENCE/)
})

test('步骤保留原引用校验，同时读取邻近的调用与上下文', async t => {
  const { root, files } = await readingFixture(t)
  await writeFile(join(root, 'a.ts'), 'export function value() {\n  return 1;\n}\nconst result = value();\n')
  const context = new ReadingContext(files, 's', parseReadingRequest({ ...input, kind: 'explain', step: {
    title: '值', reason: '读取值', refs: [{ file: 'a.ts', fromLine: 1, toLine: 3, quote: 'export function value() {\n  return 1;\n}' }],
  } }), new AbortController().signal)
  await context.prepare()
  assert.match(context.sources[0]!.text, /const result = value/)
  assert.equal(context.references([{ source: 'S1', fromLine: 4, toLine: 4 }])[0]!.quote, 'const result = value();')
})

test('搜索达到文件数或总读取预算时明确标记不完整', async t => {
  const { root, files } = await readingFixture(t)
  await Promise.all(Array.from({ length: 81 }, (_, index) => writeFile(join(root, `small-${index}.ts`), 'const value = 1;')))
  const context = new ReadingContext(files, 's', parseReadingRequest(input), new AbortController().signal)
  await context.prepare(); assert.equal((await context.search('not-found')).partial, true)
  await Promise.all(['a.ts', 'b.ts', 'c.ts'].map(file => writeFile(join(root, file), 'x'.repeat(1500000))))
  const limited = new ReadingContext(files, 's', parseReadingRequest(input), new AbortController().signal)
  await limited.prepare(); assert.equal((await limited.search('not-found')).partial, true)
})
