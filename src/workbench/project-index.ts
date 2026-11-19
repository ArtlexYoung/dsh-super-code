import { createHash } from 'node:crypto'
import type { FileSystem, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { z } from 'zod'
import type { WorkbenchRoot } from './files.js'

export const INDEX_BYTES: number = 16 * 1024 * 1024
const OWNER = 'dsh-super-code-workbench'
const FORMAT = 1
const CACHE_PATH = '.dsh-super-code/index/workbench-v1.json'
const path = z.string().min(1).max(4096).refine(value => !/[\\\0]/.test(value) && !value.startsWith('/') && !/^[a-z]:/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..') && !value.startsWith('.dsh-super-code/index/'))
const position = z.number().int().nonnegative().max(2 * 1024 * 1024)
const symbol = z.object({ name: z.string().min(1).max(2 * 1024 * 1024), offset: position, line: position, character: position, kind: z.enum(['function', 'variable', 'property', 'selector', 'tag', 'schema']) }).strict()
export interface IndexSymbol { name: string; offset: number; line: number; character: number; kind: 'function' | 'variable' | 'property' | 'selector' | 'tag' | 'schema' }
export interface IndexEntry { path: string; version: string; filter: number[]; key?: string; symbols?: IndexSymbol[] }
const entry: z.ZodType<IndexEntry> = z.object({ path, version: z.string().min(1).max(4096), filter: z.array(z.number().int().min(0).max(0xffffffff)).length(64),
  key: z.string().regex(/^[a-z]+:[a-f0-9]{64}$/).optional(), symbols: z.array(symbol).optional(),
}).strict().refine(value => (value.key === undefined) === (value.symbols === undefined) && (value.symbols?.every((symbol, i, all) => !i || all[i - 1]!.offset <= symbol.offset) ?? true))
export const indexEntries: z.ZodType<IndexEntry[]> = z.array(entry)
const envelope = z.object({ owner: z.literal(OWNER), format: z.literal(FORMAT), root: z.string(), checksum: z.string(), entries: indexEntries }).strict()
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
const checksum = (entries: IndexEntry[]): string => digest(JSON.stringify(entries.map(item => [item.path, item.version, item.filter, item.key,
  item.symbols?.map(symbol => [symbol.name, symbol.offset, symbol.line, symbol.character, symbol.kind])])))

/** 缓存只拥有元数据；读取失败或预算不足均回到完整扫描。 */
export class ProjectIndex {
  private readonly entries = new Map<string, { entry: IndexEntry; bytes: number }>()
  private bytes = 0
  private dirty = false
  private writable = true
  private version?: FsVersion
  private pending: Promise<unknown> = Promise.resolve()
  private constructor(private readonly fs: FileSystem, private readonly base: FsTarget, private readonly target: FsTarget) {}

  static async open(fs: FileSystem, root: WorkbenchRoot, signal: AbortSignal): Promise<ProjectIndex> {
    const base = await fs.resolve(root.cwd, { signal })
    let target
    try { target = await fs.resolve(CACHE_PATH, { cwd: fs.processPath(base), signal }) }
    catch { signal.throwIfAborted(); const index = new ProjectIndex(fs, base, base); index.writable = false; return index }
    const index = new ProjectIndex(fs, base, target)
    if (!fs.contains(base, target)) { index.writable = false; return index }
    try {
      const info = await fs.stat(target, signal)
      if (!info) return index
      index.writable = false
      if (info.type !== 'file' || info.size !== undefined && info.size > INDEX_BYTES) return index
      const text = new TextDecoder('utf8', { fatal: true }).decode(await fs.readBytes(target, signal, INDEX_BYTES))
      const parsed = envelope.safeParse(JSON.parse(text))
      if (!parsed.success || parsed.data.root !== digest(base.targetKey) || parsed.data.checksum !== checksum(parsed.data.entries)) return index
      for (const item of parsed.data.entries) index.set(item)
      index.version = info.version; index.writable = true; index.dirty = false
    } catch { signal.throwIfAborted(); index.writable = false }
    return index
  }

  get(path: string, version: string | undefined): IndexEntry | undefined {
    const item = this.entries.get(path)
    return version !== undefined && item?.entry.version === version ? item.entry : undefined
  }

  set(value: IndexEntry): void {
    const old = this.entries.get(value.path)
    // 搜索更新过滤器时保留同版本的符号，版本变化则一起失效。
    const next = old?.entry.version === value.version ? { ...old.entry, ...value } : value
    const serialized = JSON.stringify(next), bytes = Buffer.byteLength(serialized) + 1
    if (old && serialized === JSON.stringify(old.entry)) return
    if (old) { this.entries.delete(value.path); this.bytes -= old.bytes }
    if (bytes > INDEX_BYTES - 1024) { this.dirty = true; return }
    while (this.bytes + bytes > INDEX_BYTES - 1024) {
      const key = this.entries.keys().next().value!
      this.bytes -= this.entries.get(key)!.bytes; this.entries.delete(key)
    }
    this.entries.set(value.path, { entry: next, bytes }); this.bytes += bytes; this.dirty = true
  }

  retain(paths: Set<string>): void {
    for (const [path, value] of this.entries) if (!paths.has(path)) { this.entries.delete(path); this.bytes -= value.bytes; this.dirty = true }
  }

  flush(root: WorkbenchRoot, signal: AbortSignal): Promise<boolean> {
    const work = this.pending.then(async () => {
      signal.throwIfAborted()
      if (!this.writable || root.policy?.mode === 'read-only') return false
      if (!this.dirty) return true
      try {
        if (root.policy?.mode === 'workspace-write' && !this.fs.contains(await this.fs.resolve(root.policy.workspaceRoot, { signal }), this.target)) return false
        const target = await this.fs.resolve(CACHE_PATH, { cwd: this.fs.processPath(this.base), signal })
        if (target.targetKey !== this.target.targetKey || !this.fs.contains(this.base, target)) return false
        const entries = [...this.entries.values()].map(value => value.entry)
        const content = JSON.stringify({ owner: OWNER, format: FORMAT, root: digest(this.base.targetKey), checksum: checksum(entries), entries })
        this.dirty = false
        const result = await this.fs.writeText(target, content, this.version ? { kind: 'replaceIfVersion', version: this.version } : { kind: 'createIfAbsent' }, signal, root.policy)
        this.version = result.version
        return true
      } catch { this.dirty = true; signal.throwIfAborted(); return false }
    })
    this.pending = work.catch(() => {})
    return work
  }
}
