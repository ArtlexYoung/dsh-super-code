import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles, MAX_FILE_BYTES } from '../../src/workbench/files.js'
import { searchProject } from '../../src/workbench/search.js'
import { literalMatches } from '../../src/workbench/search-query.js'
import { validationRoot } from '../validation-root.js'

test('全局替换使用字面文本，保留正则符号、中文、换行及大小写的准确偏移', () => {
  assert.deepEqual([...literalMatches('A.$甲\nA.$', 'a.$', false)], [{ from: 0, to: 3 }, { from: 5, to: 8 }])
  assert.deepEqual([...literalMatches('😀Foo\r\nfoo', 'Foo', true)], [{ from: 2, to: 5 }])
  assert.deepEqual([...literalMatches('a\nb', '\nb', true)], [{ from: 1, to: 3 }])
  assert.deepEqual([...literalMatches('anything', '', false)], [])
})

test('全局替换遍历超过2000个文本文件，不借有限索引，明确统计二进制和大文件', async t => {
  await mkdir(validationRoot, { recursive: true }); const root = await mkdtemp(join(validationRoot, 'search-project-'))
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const files = new WorkbenchFiles(ctx.fs, async () => ({ cwd: root }))
  for (let i = 0; i < 2005; i += 50) await Promise.all(Array.from({ length: Math.min(50, 2005 - i) }, (_, index) => writeFile(join(root, `file${i + index}.txt`), 'hello 项目')))
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules/skip.txt'), 'hello')
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2])); await writeFile(join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 1))
  const signal = new AbortController().signal, matches = []
  for await (const event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: 'HELLO', replace: '你好', caseSensitive: false }, signal)) matches.push(event)
  assert.equal(matches.filter(event => event.kind === 'file').length, 2005)
  assert.deepEqual(matches.at(-1), { kind: 'done', scanned: 2005, skipped: 2 })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: 'hello', replace: '', caseSensitive: true }, abort.signal)) {} })
  await assert.rejects(async () => { for await (const _event of searchProject(ctx.fs, files, { cwd: root }, 'session', { search: '', replace: '', caseSensitive: true }, signal)) {} })
})
