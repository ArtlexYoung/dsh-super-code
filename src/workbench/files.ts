/** 工作台只操作会话工作目录，通过宿主文件系统保留沙箱和版本检查。 */
import { z } from 'zod'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

export const MAX_FILE_BYTES: number = 2 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 2000
const MAX_PROJECT_FILES = 2000
const MAX_PROJECT_DIRECTORIES = 1000
const skipped = new Set(['.git', '.hg', '.svn', 'node_modules', '.env', '.venv', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'target'])
const sourceExtension = /\.(?:[cm]?[jt]sx?|py|pyi|go|rs|c|h|cc|cpp|cxx|hpp|java|cs|kt|kts|swift|rb|php|sh|bash|zsh|json|ya?ml|html?|vue|svelte|css|scss|sql|md|toml)$/i
const pathSchema = z.string().max(4096).refine(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.split('/').some(part => part === '..' || part === '.'), 'WORKBENCH_PATH')
const saveSchema = z.object({ path: pathSchema.min(1), version: z.string().min(1).max(4096), text: z.string().refine(text => !text.includes('\0'), 'WORKBENCH_NOT_TEXT') }).strict()

export interface WorkbenchRoot { cwd: string; policy?: SandboxExecutionPolicy }
export interface WorkbenchFile { path: string; text: string; version: string }
export interface WorkbenchEntry { name: string; path: string; type: 'file' | 'directory'; size?: number }

export class WorkbenchFiles {
  constructor(private readonly fs: FileSystem, private readonly rootOf: (sessionId: string) => Promise<WorkbenchRoot>) {}

  private async locate(sessionId: string, path: string, signal?: AbortSignal): Promise<{ root: FsTarget; target: FsTarget; policy: SandboxExecutionPolicy | undefined }> {
    pathSchema.parse(path)
    const { cwd, policy } = await this.rootOf(sessionId)
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
    return { entries: entries.slice(0, MAX_DIRECTORY_ENTRIES), truncated: entries.length > MAX_DIRECTORY_ENTRIES }
  }

  async read(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkbenchFile> {
    pathSchema.min(1).parse(path)
    const { target } = await this.locate(sessionId, path, signal)
    const info = await this.fs.stat(target, signal)
    if (!info || info.type !== 'file') throw new Error('WORKBENCH_NOT_FILE')
    if (info.size !== undefined && info.size > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
    let text = '', bytes = 0
    for await (const chunk of await this.fs.streamText(target, signal)) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
      if (chunk.includes('\0')) throw new Error('WORKBENCH_NOT_TEXT')
      text += chunk
    }
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

  async project(sessionId: string, signal?: AbortSignal): Promise<{ files: string[]; truncated: boolean }> {
    const { root } = await this.locate(sessionId, '', signal)
    const queue = [{ target: root, path: '' }], seen = new Set([root.targetKey]), files: string[] = []
    let directories = 0
    while (queue.length) {
      signal?.throwIfAborted()
      const folder = queue.shift()!
      if (++directories > MAX_PROJECT_DIRECTORIES) return { files, truncated: true }
      for (const entry of await this.fs.listDir(folder.target, signal)) {
        if (skipped.has(entry.name) || !this.fs.contains(root, entry.target)) continue
        const path = folder.path ? `${folder.path}/${entry.name}` : entry.name
        if (entry.type === 'directory' && !seen.has(entry.target.targetKey)) {
          seen.add(entry.target.targetKey); queue.push({ target: entry.target, path })
        } else if (entry.type === 'file' && sourceExtension.test(entry.name) && (entry.size ?? 0) <= MAX_FILE_BYTES) {
          files.push(path)
          if (files.length === MAX_PROJECT_FILES) return { files, truncated: true }
        }
      }
    }
    return { files, truncated: false }
  }
}
