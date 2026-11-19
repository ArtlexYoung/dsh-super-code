import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { z } from 'zod'
import type { WorkbenchFiles, WorkbenchRoot } from './files.js'
import { pathSchema } from './files.js'
import { literalMatches, locationBatches } from './search-query.js'
import type { SearchLocation } from './search-query.js'
import { textFilter, mayContain } from './text-filter.js'

const searchSchema = z.object({ search: z.string().min(1).max(4096), replace: z.string().max(65536), caseSensitive: z.boolean(), locations: z.boolean().optional(), buffers: z.array(pathSchema.min(1)).optional() }).strict()
export type ProjectMatch = { kind: 'file'; path: string; count: number; version: string; sample: string }
export type ProjectSearchEvent = ProjectMatch | { kind: 'matches'; path: string; version: string; matches: SearchLocation[] } | { kind: 'done'; skipped: number; scanned: number }
const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', '.env', '.venv', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'target'])

/** 搜索与替换共用文本扫描；位置按批返回，未保存缓冲由调用视图计算。 */
export async function* searchProject(fs: FileSystem, files: WorkbenchFiles, root: WorkbenchRoot, sessionId: string, value: unknown, signal: AbortSignal): AsyncGenerator<ProjectSearchEvent> {
  const input = searchSchema.parse(value)
  const buffers = new Set(input.buffers)
  const cache = await files.index(root, signal), retained = new Set<string>()
  const base = await fs.resolve(root.cwd, { signal }), queue: { target: FsTarget; path: string }[] = [{ target: base, path: '' }], seen = new Set([base.targetKey])
  let scanned = 0, skipped = 0
  for (let cursor = 0; cursor < queue.length; cursor++) {
    signal.throwIfAborted()
    const folder = queue[cursor]!
    const entries = await fs.listDir(folder.target, signal)
    if (folder.path && entries.some(entry => entry.name === 'pyvenv.cfg' && entry.type === 'file')) continue
    for (const entry of entries) {
      signal.throwIfAborted()
      if (excluded.has(entry.name) || !fs.contains(base, entry.target)) continue
      const path = folder.path ? `${folder.path}/${entry.name}` : entry.name
      if (path === '.dsh-super-code/index') continue
      if (entry.type === 'directory' && !seen.has(entry.target.targetKey)) { seen.add(entry.target.targetKey); queue.push({ target: entry.target, path }); continue }
      if (entry.type !== 'file') continue
      retained.add(path)
      const cached = cache.get(path, entry.version)
      if (cached && !buffers.has(path) && !mayContain(Uint32Array.from(cached.filter), input.search)) { scanned++; continue }
      let file
      try { file = await files.read(sessionId, path, signal) }
      catch (error) {
        if (error instanceof Error && (['WORKBENCH_FILE_SIZE', 'WORKBENCH_NOT_TEXT'].includes(error.message) || 'code' in error && error.code === 'FS_NOT_TEXT')) { skipped++; continue }
        throw error
      }
      scanned++
      cache.set({ path, version: file.version, filter: cached?.version === file.version ? cached.filter : Array.from(textFilter(file.text)) })
      if (input.locations) {
        if (buffers.has(path)) yield { kind: 'matches', path, version: file.version, matches: [] }
        else for (const matches of locationBatches(file.text, input.search, input.caseSensitive)) {
          signal.throwIfAborted()
          yield { kind: 'matches', path, version: file.version, matches }
        }
        continue
      }
      let count = 0, sample = ''
      for (const match of literalMatches(file.text, input.search, input.caseSensitive)) { if (!count) sample = file.text.slice(Math.max(0, file.text.lastIndexOf('\n', match.from) + 1), match.to + 120).split('\n')[0]!.slice(0, 240); count++; if (count % 1000 === 0) signal.throwIfAborted() }
      if (count) yield { kind: 'file', path, count, version: file.version, sample }
    }
  }
  cache.retain(retained)
  await cache.flush(root, signal)
  yield { kind: 'done', scanned, skipped }
}
