import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { operateFile } from '../../src/workbench/operations.js'
import { trashCommands, moveToTrash } from '../../src/workbench/trash.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: any) {
  await mkdir(validationRoot, { recursive: true })
  const directory = await mkdtemp(join(validationRoot, 'file-actions-')), root = join(directory, 'project')
  await mkdir(root)
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  const signal = new AbortController().signal
  const run = (input: unknown, policy?: any) => operateFile(ctx.fs, { cwd: root, policy }, input, signal)
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { root, directory, ctx, run, signal }
}

test('新建中文文件和目录，重复目标不覆盖已有内容', async t => {
  const { root, run } = await fixture(t)
  await run({ action: 'createDirectory', path: '中文 目录' })
  await run({ action: 'createFile', path: '中文 目录/new file.ts' })
  assert.equal(await readFile(join(root, '中文 目录/new file.ts'), 'utf8'), '')
  await writeFile(join(root, '中文 目录/new file.ts'), 'keep')
  await assert.rejects(run({ action: 'createFile', path: '中文 目录/new file.ts' }), /WORKBENCH_FILE_EXISTS/)
  await assert.rejects(run({ action: 'createDirectory', path: '中文 目录' }), /WORKBENCH_FILE_EXISTS/)
  assert.equal(await readFile(join(root, '中文 目录/new file.ts'), 'utf8'), 'keep')
  assert.equal((await stat(join(root, '中文 目录'))).isDirectory(), true)
})

test('复制二进制、大文件与嵌套目录，不读取为文本，不覆盖目标', async t => {
  const { root, run } = await fixture(t)
  const content = Buffer.alloc(2 * 1024 * 1024 + 1, 137)
  await mkdir(join(root, 'src/nested'), { recursive: true })
  await writeFile(join(root, 'src/nested/data.bin'), content)
  await run({ action: 'copy', path: 'src/nested/data.bin', destination: 'copy.bin' })
  assert.deepEqual(await readFile(join(root, 'copy.bin')), content)
  await assert.rejects(run({ action: 'copy', path: 'copy.bin', destination: 'copy.bin' }), /WORKBENCH_FILE_EXISTS/)
  await run({ action: 'copy', path: 'src', destination: '副本' })
  assert.deepEqual(await readFile(join(root, '副本/nested/data.bin')), content)
  await assert.rejects(run({ action: 'copy', path: 'src', destination: 'src/child' }), /WORKBENCH_COPY_SELF/)
  await assert.rejects(run({ action: 'copy', path: 'src', destination: 'src' }), /WORKBENCH_COPY_SELF/)
  await assert.rejects(run({ action: 'copy', path: 'copy.bin', destination: '副本/nested/data.bin' }), /WORKBENCH_FILE_EXISTS/)
  assert.deepEqual(await readFile(join(root, '副本/nested/data.bin')), content)
})

test('路径、操作和只读策略在入口校验，不能变更项目之外的内容或删除根目录', async t => {
  const { root, directory, run, ctx } = await fixture(t)
  await writeFile(join(root, 'source.txt'), 'keep')
  for (const path of ['', '.', '..', '../outside', '/private/file', 'C:/file', 'a\\b', 'a/../b', 'a\0b']) {
    for (const action of ['createFile', 'createDirectory', 'trash']) await assert.rejects(run({ action, path }))
  }
  await assert.rejects(run({ action: 'remove', path: 'source.txt' }))
  await assert.rejects(run({ action: 'copy', path: 'source.txt', destination: '../outside' }))
  for (const input of [{ action: 'createFile', path: 'new.txt' }, { action: 'createDirectory', path: 'new' }, { action: 'copy', path: 'source.txt', destination: 'copy.txt' }, { action: 'trash', path: 'source.txt' }]) {
    await assert.rejects(run(input, { mode: 'read-only' }), /WORKBENCH_FILES_READONLY/)
    await assert.rejects(run(input, { mode: 'workspace-write', workspaceRoot: join(directory, 'elsewhere') }), /WORKBENCH_FILES_READONLY/)
  }
  assert.equal(await readFile(join(root, 'source.txt'), 'utf8'), 'keep')
  const abort = new AbortController(); abort.abort()
  await assert.rejects(operateFile(ctx.fs, { cwd: root }, { action: 'createFile', path: 'aborted.txt' }, abort.signal))
  await assert.rejects(stat(join(root, 'aborted.txt')), { code: 'ENOENT' })
})

test('符号链接不能借创建、复制或回收站越界', async t => {
  const { root, directory, run } = await fixture(t)
  await mkdir(join(directory, 'outside'))
  await writeFile(join(directory, 'outside/private.txt'), 'private')
  await symlink(join(directory, 'outside'), join(root, 'link'))
  for (const action of ['createFile', 'createDirectory', 'trash']) await assert.rejects(run({ action, path: 'link/private.txt' }), /WORKBENCH_PATH/)
  await assert.rejects(run({ action: 'copy', path: 'link/private.txt', destination: 'leaked.txt' }), /WORKBENCH_PATH/)
  await assert.rejects(run({ action: 'copy', path: 'link', destination: 'leaked' }), /WORKBENCH_PATH/)
  assert.equal(await readFile(join(directory, 'outside/private.txt'), 'utf8'), 'private')
  await mkdir(join(root, 'source'))
  await symlink(join(directory, 'outside/private.txt'), join(root, 'source/link.txt'))
  await assert.rejects(run({ action: 'copy', path: 'source', destination: 'copy' }), /WORKBENCH_COPY_PARTIAL/)
  await assert.rejects(stat(join(root, 'copy/link.txt')), { code: 'ENOENT' })
})

test('绝对路径复制只读且支持工作目录本身', async t => {
  const { root, run } = await fixture(t)
  await writeFile(join(root, '中文 文件.txt'), 'text')
  assert.equal((await run({ action: 'absolutePath', path: '中文 文件.txt' }, { mode: 'read-only' })).path, join(root, '中文 文件.txt'))
  assert.equal((await run({ action: 'absolutePath', path: '' })).path, root)
})

test('系统回收站命令不拼接外部路径，不包含永久删除命令', () => {
  const path = '/demo/中文 "$(touch marker); x.txt'
  const mac = trashCommands('darwin', path, false)[0]
  assert.equal(mac.executable, '/usr/bin/osascript')
  assert.equal(mac.args.at(-1), path)
  const win = trashCommands('win32', path, true)[0]
  assert.equal(win.executable, 'powershell.exe')
  assert.deepEqual(JSON.parse(win.input!), { path, directory: true })
  assert.ok(!win.args.join(' ').includes(path))
  assert.match(win.args.join(' '), /SendToRecycleBin/)
  assert.deepEqual(trashCommands('linux', path, false).map(command => command.executable), ['gio', 'trash-put'])
  for (const platform of ['darwin', 'win32', 'linux']) for (const command of trashCommands(platform, path, false)) assert.ok(!/\brm\b|Remove-Item|unlink/i.test(command.args.join(' ')))
  assert.throws(() => trashCommands('unsupported', path, false), /WORKBENCH_TRASH_UNAVAILABLE/)
})

if (process.platform === 'darwin') test('macOS 真实回收站保留内容，可以恢复到原处', async t => {
  const { root, signal } = await fixture(t)
  const path = join(root, `super-code-trash-${crypto.randomUUID()}-中文 文件.txt`)
  await writeFile(path, 'recoverable content')
  const receipt = await moveToTrash(path, false, signal)
  assert.ok(receipt)
  await assert.rejects(stat(path), { code: 'ENOENT' })
  assert.equal(await readFile(receipt, 'utf8'), 'recoverable content')
  const { rename } = await import('node:fs/promises')
  await rename(receipt, path)
  assert.equal(await readFile(path, 'utf8'), 'recoverable content')
})
