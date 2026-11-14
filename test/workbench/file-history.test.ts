import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { FileHistory } from '../../src/workbench/file-history.js'
import { moveToTrash } from '../../src/workbench/trash.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: any) {
  await mkdir(validationRoot, { recursive: true })
  const directory = await mkdtemp(join(validationRoot, 'file-history-')), root = join(directory, 'project'), prefix = `super-code-history-${crypto.randomUUID()}`
  await mkdir(root)
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  const history = new FileHistory(ctx.fs, directory, async path => { const to = join(directory, `recycled-${crypto.randomUUID()}`); await rename(path, to); return to }), signal = new AbortController().signal
  const run = (input: unknown, cwd = root, policy?: any) => history.run({ cwd, policy }, input, signal)
  t.after(async () => {
    await history.dispose(); await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { root, directory, prefix, history, run, signal }
}

test('恢复令牌受目录、状态、权限和有效期约束，重复创建不覆盖', async t => {
  const { root, directory, prefix, run } = await fixture(t), path = `${prefix}.ts`
  const created = await run({ action: 'createFile', path })
  assert.ok(created.token)
  await assert.rejects(run({ action: 'createFile', path }), /WORKBENCH_FILE_EXISTS/)
  await assert.rejects(run({ action: 'undo', token: created.token }, directory), /WORKBENCH_UNDO_EXPIRED/)
  await assert.rejects(run({ action: 'redo', token: created.token }), /WORKBENCH_UNDO_EXPIRED/)
  await assert.rejects(run({ action: 'undo', token: created.token }, root, { mode: 'read-only' }), /WORKBENCH_FILES_READONLY/)
  await assert.rejects(async () => run({ action: 'undo', token: '../outside' }))
  await writeFile(join(root, path), 'external')
  await assert.rejects(run({ action: 'undo', token: created.token }), /WORKBENCH_UNDO_CONFLICT/)
  assert.equal(await readFile(join(root, path), 'utf8'), 'external')
  await run({ action: 'releaseHistory', tokens: [created.token] })
  await assert.rejects(run({ action: 'undo', token: created.token }), /WORKBENCH_UNDO_EXPIRED/)
})

test('文件历史不接受符号链接或越界输入，不把备份路径交给前端', async t => {
  const { root, directory, prefix, run } = await fixture(t)
  await mkdir(join(directory, 'outside')); await writeFile(join(directory, 'outside/private'), 'keep')
  await symlink(join(directory, 'outside'), join(root, 'link'))
  for (const input of [{ action: 'createFile', path: '../leak' }, { action: 'createFile', path: 'link/leak' }, { action: 'trash', path: 'link' }]) await assert.rejects(async () => run(input))
  const result = await run({ action: 'createDirectory', path: prefix })
  assert.deepEqual(Object.keys(result).sort(), ['path', 'token'])
  assert.equal((await stat(join(root, prefix))).isDirectory(), true)
})

test('回收和恢复目录时保留内部链接，不读取或修改链接指向的外部文件', async t => {
  const { root, directory, prefix, run } = await fixture(t), folder = `${prefix}-links`
  await mkdir(join(root, folder)); await writeFile(join(directory, 'outside.txt'), 'external')
  await symlink(join(directory, 'outside.txt'), join(root, folder, 'external-link'))
  await symlink('missing', join(root, folder, 'broken-link'))
  const deleted = await run({ action: 'trash', path: folder })
  await run({ action: 'undo', token: deleted.token })
  const { lstat, readlink } = await import('node:fs/promises')
  assert.equal((await lstat(join(root, folder, 'external-link'))).isSymbolicLink(), true)
  assert.equal(await readlink(join(root, folder, 'broken-link')), 'missing')
  assert.equal(await readFile(join(directory, 'outside.txt'), 'utf8'), 'external')
})

  test('本地文件恢复中新建、复制、中文目录及二进制可撤销和重做，原文件修改时拒绝', async t => {
    const { root, prefix, run } = await fixture(t), path = `${prefix}-新建目录`, copy = `${prefix}-复制目录`
    const created = await run({ action: 'createDirectory', path })
    await run({ action: 'undo', token: created.token }); await assert.rejects(stat(join(root, path)), { code: 'ENOENT' })
    await run({ action: 'redo', token: created.token }); assert.equal((await stat(join(root, path))).isDirectory(), true)
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1, 137)
    await mkdir(join(root, path, '子目录')); await writeFile(join(root, path, '子目录/data.bin'), bytes)
    await assert.rejects(run({ action: 'undo', token: created.token }), /WORKBENCH_UNDO_CONFLICT/)
    const copied = await run({ action: 'copy', path, destination: copy })
    await run({ action: 'undo', token: copied.token }); await assert.rejects(stat(join(root, copy)), { code: 'ENOENT' })
    await run({ action: 'redo', token: copied.token }); assert.deepEqual(await readFile(join(root, copy, '子目录/data.bin')), bytes)
    const trashed = await run({ action: 'trash', path: copy })
    await assert.rejects(stat(join(root, copy)), { code: 'ENOENT' })
    await run({ action: 'undo', token: trashed.token }); assert.deepEqual(await readFile(join(root, copy, '子目录/data.bin')), bytes)
    await run({ action: 'redo', token: trashed.token }); await assert.rejects(stat(join(root, copy)), { code: 'ENOENT' })
    await mkdir(join(root, copy)); await writeFile(join(root, copy, 'external'), 'keep')
    await assert.rejects(run({ action: 'undo', token: trashed.token }), /WORKBENCH_UNDO_CONFLICT/)
    assert.equal(await readFile(join(root, copy, 'external'), 'utf8'), 'keep')
  })

if (process.platform === 'darwin') test('macOS 系统回收站与文件历史联动，恢复后保留内容和重做能力', async t => {
  const { root, directory, prefix, signal } = await fixture(t)
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  const receipts: string[] = [], history = new FileHistory(ctx.fs, directory, async (path, folder, signal) => {
    const receipt = await moveToTrash(path, folder, signal); if (receipt) receipts.push(receipt); return receipt
  })
  t.after(async () => {
    await history.dispose(); await ctx.fiber.dispose()
    for (const [index, path] of receipts.entries()) { try { await rename(path, join(validationRoot, `${prefix}-recovered-${index}`)); await rm(join(validationRoot, `${prefix}-recovered-${index}`), { recursive: true, force: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  })
  const path = `${prefix}-系统回收站.txt`; await writeFile(join(root, path), 'original content')
  const deleted = await history.run({ cwd: root }, { action: 'trash', path }, signal)
  await assert.rejects(stat(join(root, path)), { code: 'ENOENT' })
  await history.run({ cwd: root }, { action: 'undo', token: deleted.token }, signal)
  assert.equal(await readFile(join(root, path), 'utf8'), 'original content')
  await history.run({ cwd: root }, { action: 'redo', token: deleted.token }, signal)
  await assert.rejects(stat(join(root, path)), { code: 'ENOENT' })
})
