import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { z } from 'zod'
import type { WorkbenchFiles, WorkbenchRoot } from './files.js'
import { literalMatches } from './search-query.js'

const searchSchema = z.object({ search: z.string().min(1).max(4096), replace: z.string().max(65536), caseSensitive: z.boolean() }).strict()
export type ProjectMatch = { kind: 'file'; path: string; count: number; version: string; sample: string }
export type ProjectSearchEvent = ProjectMatch | { kind: 'done'; skipped: number; scanned: number }
const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', '.env', '.venv', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'target'])

/** 替换遍历不使用有限源码索引；二进制和超过编辑器限制的文件明确统计为跳过。 */
export async function* searchProject(fs: FileSystem, files: WorkbenchFiles, root: WorkbenchRoot, sessionId: string, value: unknown, signal: AbortSignal): AsyncGenerator<ProjectSearchEvent> {
  const input = searchSchema.parse(value)
  const base = await fs.resolve(root.cwd, { signal }), queue: { target: FsTarget; path: string }[] = [{ target: base, path: '' }], seen = new Set([base.targetKey])
  let scanned = 0, skipped = 0
  for (let cursor = 0; cursor < queue.length; cursor++) {
    signal.throwIfAborted()
    const folder = queue[cursor]!
    for (const entry of await fs.listDir(folder.target, signal)) {
      signal.throwIfAborted()
      if (excluded.has(entry.name) || !fs.contains(base, entry.target)) continue
      const path = folder.path ? `${folder.path}/${entry.name}` : entry.name
      if (entry.type === 'directory' && !seen.has(entry.target.targetKey)) { seen.add(entry.target.targetKey); queue.push({ target: entry.target, path }); continue }
      if (entry.type !== 'file') continue
      let file
      try { file = await files.read(sessionId, path, signal) }
      catch (error) {
        if (error instanceof Error && (['WORKBENCH_FILE_SIZE', 'WORKBENCH_NOT_TEXT'].includes(error.message) || 'code' in error && error.code === 'FS_NOT_TEXT')) { skipped++; continue }
        throw error
      }
      scanned++
      let count = 0, sample = ''
      for (const match of literalMatches(file.text, input.search, input.caseSensitive)) { if (!count) sample = file.text.slice(Math.max(0, file.text.lastIndexOf('\n', match.from) + 1), match.to + 120).split('\n')[0]!.slice(0, 240); count++; if (count % 1000 === 0) signal.throwIfAborted() }
      if (count) yield { kind: 'file', path, count, version: file.version, sample }
    }
  }
  yield { kind: 'done', scanned, skipped }
}
