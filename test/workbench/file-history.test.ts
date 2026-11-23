import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { FileHistory } from '../../src/workbench/file-history.js'
import { moveToTrash } from '../../src/workbench/trash.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: any, onTrash: (signal: AbortSignal) => void = () => {}) {
  await mkdir(validationRoot, { recursive: true })
  const directory = await mkdtemp(join(validationRoot, 'file-history-')), root = join(directory, 'project'), prefix = `super-code-history-${crypto.randomUUID()}`
  await mkdir(root)
  const ctx = new Context(); await ctx.plugin(LocalFileSystem, { cwd: root, diffBasisMaxBytes: 1024 })
  const history = new FileHistory(ctx.fs, directory, async (path, _folder, signal) => { const to = join(directory, `recycled-${crypto.randomUUID()}`); await rename(path, to); onTrash(signal); return to }), signal = new AbortController().signal
  const run = (input: unknown, cwd = root, policy?: any) => history.run({ cwd, policy }, input, signal)
  t.after(async () => {
    await history.dispose(); await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { root, directory, prefix, history, run, signal, fs: ctx.fs }
}

test('回收已经成功时，随后取消仍完成撤销记录并能恢复与重做', async t => {
  const abort = new AbortController(), { root, history, run } = await fixture(t, () => abort.abort())
  await writeFile(join(root, 'sample.txt'), 'original')
  const deleted = await history.run({ cwd: root }, { action: 'trash', path: 'sample.txt' }, abort.signal)
  assert.equal(abort.signal.aborted, true); assert.ok(deleted.token)
  await assert.rejects(stat(join(root, 'sample.txt')), { code: 'ENOENT' })
  await run({ action: 'undo', token: deleted.token }); assert.equal(await readFile(join(root, 'sample.txt'), 'utf8'), 'original')
  await run({ action: 'redo', token: deleted.token }); await assert.rejects(stat(join(root, 'sample.txt')), { code: 'ENOENT' })
})

test('创建已经成功时，随后取消仍完成备份与撤销记录', async t => {
  const { root, history, run, fs } = await fixture(t), abort = new AbortController(), write = fs.writeText.bind(fs)
  t.mock.method(fs, 'writeText', async (...args: Parameters<typeof write>) => { const result = await write(...args); abort.abort(); return result })
  const created = await history.run({ cwd: root }, { action: 'createFile', path: 'created.ts' }, abort.signal)
  assert.equal(abort.signal.aborted, true); assert.ok(created.token)
  assert.equal(await readFile(join(root, 'created.ts'), 'utf8'), '')
  await run({ action: 'undo', token: created.token }); await assert.rejects(stat(join(root, 'created.ts')), { code: 'ENOENT' })
  await run({ action: 'redo', token: created.token }); assert.equal(await readFile(join(root, 'created.ts'), 'utf8'), '')
})

test('回收命令内部完成移动时取消，仍返回令牌并保留恢复能力', async t => {
  const abort = new AbortController(), { root, history, run } = await fixture(t, signal => { abort.abort(); signal.throwIfAborted() })
  await writeFile(join(root, 'sample.txt'), 'original')
  const deleted = await history.run({ cwd: root }, { action: 'trash', path: 'sample.txt' }, abort.signal)
  assert.equal(abort.signal.aborted, true); assert.ok(deleted.token)
  await run({ action: 'undo', token: deleted.token }); assert.equal(await readFile(join(root, 'sample.txt'), 'utf8'), 'original')
  await run({ action: 'redo', token: deleted.token }); await assert.rejects(stat(join(root, 'sample.txt')), { code: 'ENOENT' })
})

for (const action of ['undo', 'redo'] as const) test(`${action} 已回收文件时取消，仍更新历史状态并能执行反向操作`, async t => {
  let pendingAbort: AbortController | undefined
  const { root, history, run } = await fixture(t, signal => { pendingAbort?.abort(); signal.throwIfAborted() })
  await writeFile(join(root, 'source.txt'), 'original')
  const entry = action === 'undo'
    ? await run({ action: 'copy', path: 'source.txt', destination: 'sample.txt' })
    : await run({ action: 'trash', path: 'source.txt' })
  if (action === 'redo') await run({ action: 'undo', token: entry.token })
  pendingAbort = new AbortController()
  const result = await history.run({ cwd: root }, { action, token: entry.token }, pendingAbort.signal)
  assert.equal(pendingAbort.signal.aborted, true); assert.equal(result.token, entry.token)
  const path = action === 'undo' ? 'sample.txt' : 'source.txt'
  await assert.rejects(stat(join(root, path)), { code: 'ENOENT' })
  await run({ action: action === 'undo' ? 'redo' : 'undo', token: entry.token })
  assert.equal(await readFile(join(root, path), 'utf8'), 'original')
})

test('开始前取消仍不创建文件，取消请求不阻断下一项文件操作', async t => {
  const { root, history, run } = await fixture(t), abort = new AbortController()
  abort.abort()
  await assert.rejects(history.run({ cwd: root }, { action: 'createFile', path: 'cancelled.ts' }, abort.signal), { name: 'AbortError' })
  await assert.rejects(stat(join(root, 'cancelled.ts')), { code: 'ENOENT' })
  const created = await run({ action: 'createFile', path: 'next.ts' }); assert.ok(created.token)
  await run({ action: 'undo', token: created.token }); await assert.rejects(stat(join(root, 'next.ts')), { code: 'ENOENT' })
})

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

test('普通文件改名移动不覆盖目标，保留内容和权限，可反复撤销重做', async t => {
  const { root, run } = await fixture(t)
  await mkdir(join(root, 'folder')); await writeFile(join(root, '原名.ts'), 'original', { mode: 0o640 })
  const moved = await run({ action: 'move', path: '原名.ts', destination: 'folder/renamed.ts' })
  assert.equal(moved.path, 'folder/renamed.ts'); assert.equal(moved.previousPath, '原名.ts'); assert.ok(moved.token)
  await assert.rejects(stat(join(root, '原名.ts')), { code: 'ENOENT' })
  assert.equal(await readFile(join(root, moved.path), 'utf8'), 'original')
  assert.equal((await stat(join(root, moved.path))).mode & 0o777, 0o640)
  const undone = await run({ action: 'undo', token: moved.token })
  assert.equal(undone.path, '原名.ts'); assert.equal(await readFile(join(root, '原名.ts'), 'utf8'), 'original')
  await run({ action: 'redo', token: moved.token }); assert.equal(await readFile(join(root, moved.path), 'utf8'), 'original')
  await writeFile(join(root, 'occupied.ts'), 'keep')
  await assert.rejects(run({ action: 'move', path: moved.path, destination: 'occupied.ts' }), /WORKBENCH_FILE_EXISTS/)
  assert.equal(await readFile(join(root, 'occupied.ts'), 'utf8'), 'keep')
})

test('文件移动与撤销核对版本、访问模式和普通文件类型', async t => {
  const { root, run } = await fixture(t)
  await mkdir(join(root, 'folder')); await writeFile(join(root, 'a.ts'), 'before')
  await assert.rejects(run({ action: 'move', path: 'a.ts', destination: 'b.ts', version: 'old' }), /WORKBENCH_CONFLICT/)
  await assert.rejects(async () => run({ action: 'move', path: 'a.ts', destination: '../out.ts' }))
  await assert.rejects(run({ action: 'move', path: 'a.ts', destination: 'b.ts' }, root, { mode: 'read-only' }), /WORKBENCH_FILES_READONLY/)
  await assert.rejects(run({ action: 'move', path: 'folder', destination: 'other' }), /WORKBENCH_MOVE_FILE/)
  await symlink('a.ts', join(root, 'link.ts'))
  await assert.rejects(run({ action: 'move', path: 'link.ts', destination: 'b.ts' }), /WORKBENCH_FILE_LINK/)
  const moved = await run({ action: 'move', path: 'a.ts', destination: 'b.ts' })
  await writeFile(join(root, 'b.ts'), 'external')
  await assert.rejects(run({ action: 'undo', token: moved.token }), /WORKBENCH_CONFLICT/)
  assert.equal(await readFile(join(root, 'b.ts'), 'utf8'), 'external')
})

for (const stage of ['beforeLink', 'afterMove']) test(`文件移动期间外部写入不被新版本掩盖：${stage}`, async t => {
  const { root, run, fs, signal } = await fixture(t)
  await writeFile(join(root, 'a.ts'), 'before')
  const source = await fs.resolve('a.ts', { cwd: root, signal }), version = (await fs.stat(source, signal))?.version
  const originalStat = fs.stat.bind(fs)
  let changed = false
  t.mock.method(fs, 'stat', async (...args: Parameters<typeof originalStat>) => {
    const path = fs.processPath(args[0]), match = path === join(root, stage === 'beforeLink' ? 'a.ts' : 'b.ts')
    if (match && !changed) {
      changed = true
      if (stage === 'beforeLink') { const previous = await originalStat(...args); await writeFile(path, 'external'); return previous }
      await writeFile(path, 'external')
    }
    return originalStat(...args)
  })
  if (stage === 'beforeLink') {
    await assert.rejects(run({ action: 'move', path: 'a.ts', destination: 'b.ts', version }), /WORKBENCH_MOVE_PARTIAL/)
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'external')
  }
  if (stage === 'afterMove') {
    const result = await run({ action: 'move', path: 'a.ts', destination: 'b.ts', version })
    assert.equal(result.version, version)
    await assert.rejects(run({ action: 'undo', token: result.token, version: result.version }), /WORKBENCH_CONFLICT/)
  }
  assert.equal(changed, true); assert.equal(await readFile(join(root, 'b.ts'), 'utf8'), 'external')
})

test('连续移动未打开文件后逐项撤销与重做，不因移动产生的版本变化失效', async t => {
  const { root, run } = await fixture(t)
  await writeFile(join(root, 'a.ts'), 'same content')
  const first = await run({ action: 'move', path: 'a.ts', destination: 'b.ts' })
  const second = await run({ action: 'move', path: 'b.ts', destination: 'c.ts' })
  await run({ action: 'undo', token: second.token }); await run({ action: 'undo', token: first.token })
  assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'same content')
  await run({ action: 'redo', token: first.token }); await run({ action: 'redo', token: second.token })
  assert.equal(await readFile(join(root, 'c.ts'), 'utf8'), 'same content')
})
