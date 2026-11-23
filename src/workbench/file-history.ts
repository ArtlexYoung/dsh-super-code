import * as native from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { z } from 'zod'
import { operateFile, operationSchema } from './operations.js'
import type { WorkbenchRoot } from './files.js'
import { containsPath } from './git/filesystem.js'
import { moveToTrash } from './trash.js'

const tokenSchema = z.string().uuid()
const schema = z.union([operationSchema,
  z.object({ action: z.enum(['undo', 'redo']), token: tokenSchema, version: z.string().min(1).max(4096).optional() }).strict(),
  z.object({ action: z.literal('releaseHistory'), tokens: z.array(tokenSchema).max(100) }).strict(),
])
interface FileRecord { root: string; path: string; backup: string; before: string | null; after: string | null; undone: boolean }
interface MoveRecord { root: string; path: string; destination: string; version: string | undefined; undone: boolean }
export interface FileOperationResult { path: string; previousPath?: string; version?: string; previousVersion?: string; token?: string }

/** 内容指纹不依赖复制后的时间戳，也覆盖二进制、空目录和权限变化。 */
async function fingerprint(path: string, signal: AbortSignal): Promise<string | null> {
  const hash = createHash('sha256'), queue = [path]
  while (queue.length) {
    signal.throwIfAborted()
    const current = queue.pop()!
    let info
    try { info = await native.lstat(current, { bigint: true }) }
    catch (error) { if (current === path && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (info.isSymbolicLink()) {
      if (current === path) throw new Error('WORKBENCH_FILE_LINK')
      hash.update(JSON.stringify([current.slice(path.length), 'link', await native.readlink(current)])); continue
    }
    if (!info.isDirectory() && !info.isFile()) throw new Error('WORKBENCH_FILE_LINK')
    hash.update(JSON.stringify([current.slice(path.length), info.isDirectory(), String(info.mode), info.isFile() ? String(info.size) : null]))
    if (info.isDirectory()) {
      const names = (await native.readdir(current)).sort()
      hash.update(JSON.stringify(names))
      for (const name of names.reverse()) queue.push(join(current, name))
    } else {
      for await (const part of createReadStream(current, { signal })) hash.update(part)
      const after = await native.stat(current, { bigint: true })
      if (info.size !== after.size || info.mtimeNs !== after.mtimeNs || info.ino !== after.ino) throw new Error('WORKBENCH_UNDO_CONFLICT')
    }
  }
  return hash.digest('hex')
}

async function copyExclusive(source: string, target: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const info = await native.lstat(source)
  if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new Error('WORKBENCH_FILE_LINK')
  if (info.isFile()) { await native.copyFile(source, target, constants.COPYFILE_EXCL); await native.chmod(target, info.mode); return }
  await native.mkdir(target, { mode: 0o700 })
  const queue = [{ source, target, mode: info.mode }]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const directory = queue[cursor]!
    for (const name of await native.readdir(directory.source)) {
      signal.throwIfAborted()
      const from = join(directory.source, name), to = join(directory.target, name), item = await native.lstat(from)
      if (item.isSymbolicLink()) { await native.symlink(await native.readlink(from), to); continue }
      if (!item.isDirectory() && !item.isFile()) throw new Error('WORKBENCH_FILE_LINK')
      if (item.isDirectory()) { await native.mkdir(to, { mode: 0o700 }); queue.push({ source: from, target: to, mode: item.mode }) }
      else { await native.copyFile(from, to, constants.COPYFILE_EXCL); await native.chmod(to, item.mode) }
    }
  }
  for (const directory of queue.reverse()) await native.chmod(directory.target, directory.mode)
}

/** 恢复令牌只在本次宿主进程内有效，备份放在项目之外。 */
export class FileHistory {
  private readonly records = new Map<string, FileRecord | MoveRecord>()
  private pending: Promise<unknown> = Promise.resolve()
  private closed = false
  constructor(private readonly fs: FileSystem, private readonly storage: string = tmpdir(), private readonly trash: typeof moveToTrash = moveToTrash) {}

  run(root: WorkbenchRoot, value: unknown, signal: AbortSignal): Promise<FileOperationResult> {
    const input = schema.parse(value)
    const result = this.pending.then(async () => {
      signal.throwIfAborted()
      if (this.closed) throw new Error('WORKBENCH_FILE_BUSY')
      const base = await operateFile(this.fs, root, { action: 'absolutePath', path: '' }, signal)
      if (input.action === 'releaseHistory') {
        for (const token of input.tokens) if (this.records.get(token)?.root === base.path) await this.release(token)
        return { path: '' }
      }
      if ('token' in input) return this.restore(root, base.path, input, signal)
      if (input.action === 'absolutePath') return operateFile(this.fs, root, input, signal)
      if (input.action === 'move') {
        const result = await operateFile(this.fs, root, input, signal), token = randomUUID()
        this.moved(base.path, result)
        this.records.set(token, { root: base.path, path: input.path, destination: input.destination, version: result.version, undone: false })
        return { ...result, token }
      }
      return this.record(root, base.path, input, signal)
    })
    this.pending = result.catch(() => {})
    return result
  }

  private async record(root: WorkbenchRoot, base: string, input: z.infer<typeof operationSchema> & { action: 'createFile' | 'createDirectory' | 'copy' | 'trash' }, signal: AbortSignal): Promise<FileOperationResult> {
    const path = input.action === 'copy' ? input.destination : input.path
    const target = await this.writable(root, base, path, signal)
    const backup = await native.mkdtemp(join(this.storage, 'dsh-workbench-history-'))
    let before: string | null = null
    try {
      if (input.action === 'trash') {
        before = await fingerprint(target, signal)
        if (before === null) throw new Error('WORKBENCH_UNDO_CONFLICT')
        await copyExclusive(target, join(backup, 'content'), signal)
        if (await fingerprint(target, signal) !== before || await fingerprint(join(backup, 'content'), signal) !== before) throw new Error('WORKBENCH_UNDO_CONFLICT')
      }
      const folder = input.action === 'trash' && (await native.lstat(target)).isDirectory()
      signal.throwIfAborted()
      // 开始写入后完成操作和撤销记录，避免取消留下已改文件却丢失恢复记录。
      const completed = new AbortController().signal
      const result = input.action === 'trash'
        ? (await this.trash(target, folder, completed), { path: input.path })
        : await operateFile(this.fs, root, input, completed)
      const after = await fingerprint(target, completed)
      if (input.action !== 'trash') await copyExclusive(target, join(backup, 'content'), completed)
      const token = randomUUID()
      this.records.set(token, { root: base, path, backup, before, after, undone: false })
      return { ...result, token }
    } catch (error) { await native.rm(backup, { recursive: true, force: true }); throw error }
  }

  private async writable(root: WorkbenchRoot, base: string, path: string, signal: AbortSignal): Promise<string> {
    const target = await this.fs.resolve(path, { cwd: base, signal }), origin = await this.fs.resolve(base, { signal })
    if (!this.fs.contains(origin, target)) throw new Error('WORKBENCH_PATH')
    if (root.policy?.mode === 'read-only' || root.policy?.mode === 'workspace-write' && !this.fs.contains(await this.fs.resolve(root.policy.workspaceRoot, { signal }), target)) throw new Error('WORKBENCH_FILES_READONLY')
    const local = await native.realpath(base)
    if (this.fs.processPathFromHostPath && this.fs.processPathFromHostPath(local) !== local) throw new Error('WORKBENCH_FILES_LOCAL')
    const result = this.fs.processPath(target)
    if (!containsPath(local, await native.realpath(dirname(result)))) throw new Error('WORKBENCH_PATH')
    return result
  }

  private async restore(root: WorkbenchRoot, base: string, input: { action: 'undo' | 'redo'; token: string; version?: string }, signal: AbortSignal): Promise<FileOperationResult> {
    const entry = this.records.get(input.token)
    if (!entry || entry.root !== base || entry.undone === (input.action === 'undo')) throw new Error('WORKBENCH_UNDO_EXPIRED')
    if ('destination' in entry) {
      const result = await operateFile(this.fs, root, { action: 'move', path: entry.undone ? entry.path : entry.destination, destination: entry.undone ? entry.destination : entry.path, version: input.version || entry.version }, signal)
      this.moved(base, result)
      entry.undone = !entry.undone; entry.version = result.version
      return { ...result, token: input.token }
    }
    const target = await this.writable(root, base, entry.path, signal)
    const expected = entry.undone ? entry.before : entry.after, next = entry.undone ? entry.after : entry.before
    if (await fingerprint(target, signal) !== expected) throw new Error('WORKBENCH_UNDO_CONFLICT')
    if (next !== null) {
      if (expected !== null) throw new Error('WORKBENCH_UNDO_CONFLICT')
      if (await fingerprint(join(entry.backup, 'content'), signal) !== next) throw new Error('WORKBENCH_UNDO_CONFLICT')
    }
    const folder = next === null && (await native.lstat(target)).isDirectory()
    signal.throwIfAborted()
    const completed = new AbortController().signal
    if (next === null) {
      await this.trash(target, folder, completed)
    } else {
      try { await copyExclusive(join(entry.backup, 'content'), target, completed) }
      catch (error) { throw new Error('WORKBENCH_HISTORY_PARTIAL', { cause: error }) }
    }
    entry.undone = !entry.undone
    return { path: entry.path, token: input.token }
  }

  private moved(root: string, result: FileOperationResult): void {
    // 硬链接移动会更新 ctime；同一份内容的旧移动记录也跟随新版本。
    if (!result.previousVersion) return
    for (const entry of this.records.values()) {
      if ('destination' in entry && entry.root === root && entry.version === result.previousVersion) entry.version = result.version
    }
  }

  private async release(token: string): Promise<void> {
    const record = this.records.get(token)
    if (record) { if ('backup' in record) await native.rm(record.backup, { recursive: true, force: true }); this.records.delete(token) }
  }
  async dispose(): Promise<void> { this.closed = true; await this.pending; for (const token of this.records.keys()) await this.release(token) }
}
