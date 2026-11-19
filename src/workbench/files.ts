/** 工作台只操作会话工作目录，通过宿主文件系统保留沙箱和版本检查。 */
import { z } from 'zod'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { ProjectIndex, indexEntries } from './project-index.js'
import type { IndexEntry } from './project-index.js'

export const MAX_FILE_BYTES: number = 2 * 1024 * 1024
const skipped = new Set(['.git', '.hg', '.svn', 'node_modules', '.env', '.venv', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'target'])
const sourceExtension = /\.(?:[cm]?[jt]sx?|py|pyi|go|rs|c|h|cc|cpp|cxx|hpp|java|cs|kt|kts|swift|rb|php|sh|bash|zsh|json|ya?ml|html?|vue|svelte|css|scss|sql|md|toml)$/i
export interface WorkbenchProject { files: string[]; truncated: boolean; cached?: Record<string, IndexEntry> }
export const pathSchema: z.ZodString = z.string().max(4096).refine(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.split('/').some(part => part === '..' || part === '.'), 'WORKBENCH_PATH')
const saveSchema = z.object({ path: pathSchema.min(1), version: z.string().min(1).max(4096), text: z.string().refine(text => !text.includes('\0'), 'WORKBENCH_NOT_TEXT') }).strict()

export interface WorkbenchRoot { cwd: string; policy?: SandboxExecutionPolicy }
export interface WorkbenchFile { path: string; text: string; version: string }
export interface WorkbenchEntry { name: string; path: string; type: 'file' | 'directory'; size?: number }

export class WorkbenchFiles {
  private readonly indexes = new Map<string, Promise<ProjectIndex>>()
  constructor(private readonly fs: FileSystem, private readonly rootOf: (sessionId: string, signal?: AbortSignal) => Promise<WorkbenchRoot>) {}

  async index(root: WorkbenchRoot, signal: AbortSignal): Promise<ProjectIndex> {
    const base = await this.fs.resolve(root.cwd, { signal })
    let work = this.indexes.get(base.targetKey)
    if (!work) {
      work = ProjectIndex.open(this.fs, root, signal)
      this.indexes.set(base.targetKey, work)
      void work.catch(() => { if (this.indexes.get(base.targetKey) === work) this.indexes.delete(base.targetKey) })
      // 只限制可复用缓存的项目数，项目扫描不受影响。
      if (this.indexes.size > 4) this.indexes.delete(this.indexes.keys().next().value!)
    }
    try { const index = await work; signal.throwIfAborted(); return index }
    catch (error) { if (!signal.aborted && (error as Error).name === 'AbortError') { this.indexes.delete(base.targetKey); return this.index(root, signal) }; throw error }
  }

  async storeIndex(sessionId: string, value: unknown, signal: AbortSignal): Promise<{ persisted: boolean }> {
    signal.throwIfAborted()
    const entries = indexEntries.parse(value), root = await this.rootOf(sessionId, signal), base = await this.fs.resolve(root.cwd, { signal }), index = await this.index(root, signal)
    for (const entry of entries) {
      signal.throwIfAborted()
      try {
        const target = await this.fs.resolve(entry.path, { cwd: this.fs.processPath(base), signal })
        if (this.fs.contains(base, target) && (await this.fs.stat(target, signal))?.version === entry.version) index.set(entry)
      } catch { signal.throwIfAborted(); return { persisted: false } }
    }
    return { persisted: await index.flush(root, signal) }
  }

  private async locate(sessionId: string, path: string, signal?: AbortSignal): Promise<{ root: FsTarget; target: FsTarget; policy: SandboxExecutionPolicy | undefined }> {
    pathSchema.parse(path)
    const { cwd, policy } = await this.rootOf(sessionId, signal)
    const root = await this.fs.resolve(cwd, { signal })
    const target = path ? await this.fs.resolve(path, { cwd: this.fs.processPath(root), signal }) : root
    if (!this.fs.contains(root, target)) throw new Error('WORKBENCH_PATH')
    return { root, target, policy }
  }

  async list(sessionId: string, path: string, signal?: AbortSignal): Promise<{ entries: WorkbenchEntry[]; truncated: boolean }> {
    const { root, target } = await this.locate(sessionId, path, signal)
    const entries = (await this.fs.listDir(target, signal)).flatMap(entry => (entry.type === 'file' || entry.type === 'directory') && this.fs.contains(root, entry.target)
      ? [{ name: entry.name, path: path ? `${path}/${entry.name}` : entry.name, type: entry.type, size: entry.size }] : [])
    entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))
    return { entries, truncated: false }
  }

  async read(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkbenchFile> {
    pathSchema.min(1).parse(path)
    const { target } = await this.locate(sessionId, path, signal)
    const info = await this.fs.stat(target, signal)
    if (!info || info.type !== 'file') throw new Error('WORKBENCH_NOT_FILE')
    if (info.size !== undefined && info.size > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
    let bytes: Uint8Array
    try { bytes = await this.fs.readBytes(target, signal, MAX_FILE_BYTES) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'FS_TOO_LARGE') throw new Error('WORKBENCH_FILE_SIZE', { cause: error })
      throw error
    }
    let text: string
    // 编辑器需要保留 BOM，宿主的普通文本读取会将它当作编码信息移除。
    try { text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch (error) { if (error instanceof TypeError) throw new Error('WORKBENCH_NOT_TEXT', { cause: error }); throw error }
    if (text.includes('\0')) throw new Error('WORKBENCH_NOT_TEXT')
    if ((await this.fs.stat(target, signal))?.version !== info.version) throw new Error('WORKBENCH_CONFLICT')
    return { path, text, version: info.version }
  }

  async save(sessionId: string, content: unknown, signal?: AbortSignal): Promise<WorkbenchFile> {
    const input = saveSchema.parse(content)
    if (Buffer.byteLength(input.text) > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
    const { target, policy } = await this.locate(sessionId, input.path, signal)
    const info = await this.fs.stat(target, signal)
    if (!info || info.type !== 'file' || info.version !== input.version) throw new Error('WORKBENCH_CONFLICT')
    const result = await this.fs.writeText(target, input.text, { kind: 'replaceIfVersion', version: info.version }, signal, policy)
    return { path: input.path, text: input.text, version: result.version }
  }

  async project(sessionId: string, signal?: AbortSignal): Promise<WorkbenchProject> {
    const { root } = await this.locate(sessionId, '', signal)
    const cache = await this.index(await this.rootOf(sessionId, signal), signal || new AbortController().signal), cached: Record<string, IndexEntry> = Object.create(null)
    const queue = [{ target: root, path: '' }], seen = new Set([root.targetKey]), files: string[] = []
    while (queue.length) {
      signal?.throwIfAborted()
      const folder = queue.pop()!
      const entries = await this.fs.listDir(folder.target, signal)
      // 虚拟环境可以取任意目录名，按 Python 的环境标记识别，避免索引依赖副本。
      if (folder.path && entries.some(entry => entry.name === 'pyvenv.cfg' && entry.type === 'file')) continue
      for (const entry of entries) {
        signal?.throwIfAborted()
        if (skipped.has(entry.name) || !this.fs.contains(root, entry.target)) continue
        const path = folder.path ? `${folder.path}/${entry.name}` : entry.name
        if (path === '.dsh-super-code/index') continue
        if (entry.type === 'directory' && !seen.has(entry.target.targetKey)) {
          seen.add(entry.target.targetKey); queue.push({ target: entry.target, path })
        } else if (entry.type === 'file' && sourceExtension.test(entry.name) && (entry.size ?? 0) <= MAX_FILE_BYTES) {
          files.push(path)
          const found = cache.get(path, entry.version)
          if (found?.symbols) cached[path] = found
        }
      }
    }
    return { files, truncated: false, ...(Object.keys(cached).length ? { cached } : {}) }
  }
}
