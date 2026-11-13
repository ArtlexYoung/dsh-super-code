import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { WorkbenchFiles, MAX_FILE_BYTES } from '../../src/workbench/files.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: any) {
  await mkdir(validationRoot, { recursive: true })
  const directory = await mkdtemp(join(validationRoot, 'workbench-')), root = join(directory, 'project')
  await mkdir(root)
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 })
  const files = new WorkbenchFiles(ctx.fs, async id => { if (id !== 'session') throw new Error('WORKBENCH_SESSION'); return { cwd: root } })
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { files, root, directory, ctx }
}

test('工作台精确保留空文件、中文路径、CRLF 和末尾换行', async t => {
  const { files, root } = await fixture(t)
  for (const [path, text] of [['空 文件.ts', 'const 金额 = 1;\r\n\r\n'], ['empty.py', '']]) {
    await writeFile(join(root, path!), text!)
    const original = await files.read('session', path!)
    assert.equal(original.text, text)
    const saved = await files.save('session', { path, version: original.version, text: text + '// updated\r\n' })
    assert.equal(await readFile(join(root, path!), 'utf8'), saved.text)
  }
})

test('工作台拒绝绝对路径、越界、目录、二进制和不存在的文件', async t => {
  const { files, root } = await fixture(t)
  await writeFile(join(root, 'binary.ts'), Buffer.from([0, 1, 2]))
  for (const path of ['../outside.ts', '/etc/passwd', 'C:/private.ts', 'a/../outside.ts', 'a\\b.ts', '.', 'a\0b']) {
    await assert.rejects(files.read('session', path))
    await assert.rejects(files.list('session', path))
  }
  for (const path of ['', 'missing.ts', 'binary.ts']) await assert.rejects(files.read('session', path))
  await assert.rejects(files.list('unknown', ''))
  await writeFile(join(root, 'text.ts'), 'original')
  const text = await files.read('session', 'text.ts')
  await assert.rejects(files.save('session', { ...text, text: 'binary\0text' }), /WORKBENCH_NOT_TEXT/)
  assert.equal(await readFile(join(root, 'text.ts'), 'utf8'), 'original')
})

test('工作台不读取或保存指向工作目录之外的符号链接', async t => {
  const { files, root, directory } = await fixture(t)
  await writeFile(join(directory, 'outside.ts'), 'private')
  await symlink(join(directory, 'outside.ts'), join(root, 'link.ts'))
  await assert.rejects(files.read('session', 'link.ts'), /WORKBENCH_PATH/)
  assert.deepEqual((await files.list('session', '')).entries, [])
})

test('磁盘内容变化或两个窗口同时保存时，不覆盖新内容', async t => {
  const { files, root } = await fixture(t)
  await writeFile(join(root, 'main.ts'), 'original')
  const first = await files.read('session', 'main.ts')
  await writeFile(join(root, 'main.ts'), 'external edit')
  await assert.rejects(files.save('session', { ...first, text: 'stale edit' }), /WORKBENCH_CONFLICT/)
  assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), 'external edit')
  const current = await files.read('session', 'main.ts')
  const results = await Promise.allSettled(['one', 'two'].map(text => files.save('session', { ...current, text })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
})

test('索引跳过依赖和循环链接，保留中文源文件并限制大文件', async t => {
  const { files, root } = await fixture(t)
  await mkdir(join(root, '中文 目录'))
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, '中文 目录', 'main.swift'), 'func hello() {}')
  await writeFile(join(root, 'node_modules', 'ignored.ts'), 'const privateDependency = 1')
  await writeFile(join(root, 'big.ts'), 'x'.repeat(MAX_FILE_BYTES + 1))
  await symlink(root, join(root, 'loop'))
  assert.deepEqual(await files.project('session'), { files: ['中文 目录/main.swift'], truncated: false })
  await assert.rejects(files.read('session', 'big.ts'), /WORKBENCH_FILE_SIZE/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(files.project('session', abort.signal))
})
