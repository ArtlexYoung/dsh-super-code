import type { WorkbenchFiles, WorkbenchFile } from '../files.js'
import type { ReadingRequest, ReadingSource, ReadingRange, ReadingReference, ModelReadingReference } from './types.js'

const MAX_SOURCE_CHARS = 24000
const MAX_CONTEXT_CHARS = 180000
const MAX_READ_CHARS = 4 * 1024 * 1024
const MAX_SOURCES = 24
const MAX_SEARCH_FILES = 80
const MAX_SEARCH_RESULTS = 30
const DEFAULT_SOURCE_LINES = 180
const STEP_CONTEXT_LINES = 40
const MAX_CATALOG_CHARS = 48000

/** 每次阅读请求独立持有源码快照和预算，模型只能引用已取得的片段。 */
export class ReadingContext {
  readonly sources: ReadingSource[] = []
  readonly catalog: string[] = []
  partial = false
  private readonly cache = new Map<string, WorkbenchFile>()
  private chars = 0
  private readChars = 0

  constructor(private readonly files: WorkbenchFiles, private readonly sessionId: string, private readonly input: ReadingRequest, private readonly signal: AbortSignal) {}

  async prepare(): Promise<void> {
    const project = await this.files.project(this.sessionId, this.signal)
    const root = await this.files.list(this.sessionId, '', this.signal)
    this.partial = project.truncated || root.truncated
    let chars = 0
    for (const file of new Set([...root.entries.filter(entry => entry.type === 'file').map(entry => entry.path), ...project.files])) {
      chars += file.length
      if (chars > MAX_CATALOG_CHARS) { this.partial = true; break }
      this.catalog.push(file)
    }
    const initial = this.input.step?.refs ?? (this.input.file ? [{ file: this.input.file, fromLine: 1, toLine: DEFAULT_SOURCE_LINES }] : [])
    for (const range of initial) {
      if ('quote' in range) {
        const file = await this.file(range.file)
        if (file.text.split('\n').slice(range.fromLine - 1, range.toLine).join('\n') !== range.quote) throw new Error('READING_REFERENCE')
        await this.read({ file: range.file, fromLine: Math.max(1, range.fromLine - STEP_CONTEXT_LINES), toLine: Math.max(DEFAULT_SOURCE_LINES, range.toLine + STEP_CONTEXT_LINES) })
      } else await this.read(range)
    }
    if (!initial.length) {
      const readme = this.catalog.find(file => /^readme(?:\.md|\.txt)?$/i.test(file))
      if (readme) await this.read({ file: readme, fromLine: 1, toLine: DEFAULT_SOURCE_LINES })
    }
  }

  private async file(path: string): Promise<WorkbenchFile> {
    this.signal.throwIfAborted()
    const cached = this.cache.get(path)
    if (cached) return cached
    const disk = await this.files.read(this.sessionId, path, this.signal)
    const buffer = this.input.buffers.find(file => file.path === path)
    const result = buffer ? { path, text: buffer.text, version: buffer.version } : disk
    if (this.readChars + result.text.length > MAX_READ_CHARS) throw new Error('READING_READ_LIMIT')
    this.readChars += result.text.length
    this.cache.set(path, result)
    return result
  }

  async read(range: ReadingRange): Promise<ReadingSource> {
    const file = await this.file(range.file), lines = file.text.split('\n')
    if (range.fromLine > lines.length || range.toLine < range.fromLine) throw new Error('READING_RANGE')
    const toLine = Math.min(range.toLine, lines.length), selected: string[] = []
    let chars = 0
    for (const line of lines.slice(range.fromLine - 1, toLine)) {
      if (chars + line.length + 1 > MAX_SOURCE_CHARS) { this.partial = true; break }
      selected.push(line); chars += line.length + 1
    }
    if (!selected.length) throw new Error('READING_SOURCE_SIZE')
    const actualEnd = range.fromLine + selected.length - 1
    const existing = this.sources.find(source => source.file === range.file && source.fromLine === range.fromLine && source.toLine === actualEnd)
    if (existing) return existing
    if (this.sources.length >= MAX_SOURCES || this.chars + chars > MAX_CONTEXT_CHARS) throw new Error('READING_CONTEXT_LIMIT')
    const source = { id: `S${this.sources.length + 1}`, file: range.file, fromLine: range.fromLine, toLine: actualEnd, text: selected.join('\n'), version: file.version }
    this.sources.push(source); this.chars += chars
    return source
  }

  async search(query: string): Promise<{ matches: { file: string; line: number; text: string }[]; partial: boolean; unavailable: string[] }> {
    const matches: { file: string; line: number; text: string }[] = [], unavailable: string[] = []
    const paths = [...this.catalog].sort((a, b) => Number(b === this.input.file) - Number(a === this.input.file))
    let examined = 0, limited = false
    for (const path of paths) {
      if (examined === MAX_SEARCH_FILES || this.readChars >= MAX_READ_CHARS) { limited = true; break }
      examined++
      let file: WorkbenchFile
      try { file = await this.file(path) }
      catch (error) {
        this.signal.throwIfAborted()
        if (error instanceof Error && error.message === 'READING_READ_LIMIT') { limited = true; break }
        unavailable.push(path); continue
      }
      const lines = file.text.split('\n')
      for (let line = 0; line < lines.length; line++) {
        if (!lines[line]!.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue
        matches.push({ file: path, line: line + 1, text: lines[line]!.slice(0, 600) })
        if (matches.length === MAX_SEARCH_RESULTS) { this.partial = true; return { matches, partial: true, unavailable } }
      }
    }
    const partial = this.partial || limited || unavailable.length > 0
    this.partial ||= partial
    return { matches, partial, unavailable }
  }

  references(refs: ModelReadingReference[]): ReadingReference[] {
    return refs.map(ref => {
      const source = this.sources.find(source => source.id === ref.source)
      if (!source || ref.fromLine < source.fromLine || ref.toLine > source.toLine || ref.toLine < ref.fromLine) throw new Error('READING_REFERENCE')
      const quote = source.text.split('\n').slice(ref.fromLine - source.fromLine, ref.toLine - source.fromLine + 1).join('\n')
      if (!quote.trim() && source.text.trim()) throw new Error('READING_REFERENCE')
      return { file: source.file, fromLine: ref.fromLine, toLine: ref.toLine, quote }
    })
  }

  modelSources(): object[] {
    return this.sources.map(source => ({ ...source, text: source.text.split('\n').map((line, index) => `${source.fromLine + index}: ${line}`).join('\n') }))
  }
}
