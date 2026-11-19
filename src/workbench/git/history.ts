import type { GitHistoryEntry, GitLineHistory, GitRange, GitRequest, GitDiff } from './request.js'
import type { HistoryReader, HistoryBlob, HistoryCommit } from './history-reader.js'
import { historyText } from './history-reader.js'
import { linesOf, mapRange, similarity, sliceRange } from './history-range.js'
import { textDiff } from './diff.js'
import { MAX_FILE_BYTES } from '../files.js'

type Warnings = Set<GitLineHistory['warnings'][number]>
type Target = { oid: string; range: GitRange }
interface TraceContext { reader: HistoryReader; warnings: Warnings; signal: AbortSignal }
type PreviousFile = { kind: 'found'; path: string; blob: HistoryBlob } | { kind: 'created' } | { kind: 'ambiguous' }
const RENAME_SIMILARITY = .6
const RENAME_MARGIN = .1

function skipUnsupported(error: unknown, warnings: Warnings): void {
  if (!(error instanceof Error) || !['WORKBENCH_FILE_SIZE', 'WORKBENCH_GIT_HISTORY_FILE', 'WORKBENCH_GIT_DIFF_LIMIT'].includes(error.message)) throw error
  warnings.add('unsupported')
}

async function previousFile(context: TraceContext, current: HistoryBlob, target: Target, parent: string): Promise<PreviousFile> {
  const { reader, warnings, signal } = context
  const existing = await reader.file(parent, target.range.path)
  if (existing) return { kind: 'found', path: target.range.path, blob: existing }
  const candidates: { path: string; blob: HistoryBlob; score: number }[] = []
  let text: string | undefined
  for (const path of await reader.deleted(parent, target.oid)) {
    signal.throwIfAborted()
    const blob = await reader.file(parent, path)
    if (!blob || (blob.mode & 0o170000) !== 0o100000) continue
    if (blob.oid === current.oid) { candidates.push({ path, blob, score: 1 }); continue }
    try {
      text ??= await historyText(current)
      const score = similarity(await historyText(blob), text)
      if (score >= RENAME_SIMILARITY) candidates.push({ path, blob, score })
    } catch (error) { skipUnsupported(error, warnings) }
  }
  candidates.sort((a, b) => b.score - a.score)
  if (candidates[1] && candidates[0]!.score - candidates[1].score < RENAME_MARGIN) { warnings.add('ambiguous'); return { kind: 'ambiguous' } }
  return candidates[0] ? { kind: 'found', ...candidates[0] } : { kind: 'created' }
}

async function traceParent(context: TraceContext, current: Target, blob: HistoryBlob, parent: string | null): Promise<{ before: GitRange | null; changed: boolean } | null> {
  const { reader, warnings } = context
  try {
    const previous = parent ? await previousFile(context, blob, current, parent) : { kind: 'created' as const }
    if (previous.kind === 'ambiguous') return null
    if (previous.kind === 'created') return { before: null, changed: true }
    if ((previous.blob.mode & 0o170000) !== 0o100000) throw new Error('WORKBENCH_GIT_HISTORY_FILE')
    if (blob.oid === previous.blob.oid) return { before: { ...current.range, path: previous.path }, changed: previous.path !== current.range.path }
    const mapping = mapRange(await historyText(previous.blob), await historyText(blob), current.range)
    if (mapping.ambiguous) warnings.add(mapping.range ? 'range' : 'ambiguous')
    if (mapping.ambiguous && !mapping.range) return null
    return { before: mapping.range && { ...mapping.range, path: previous.path }, changed: mapping.changed || previous.path !== current.range.path }
  } catch (error) { skipUnsupported(error, warnings); return null }
}

function sortHistory(entries: GitHistoryEntry[], commits: Map<string, HistoryCommit | null>): void {
  const order = new Map<string, number>(), pending = new Map<string, Set<string>>()
  for (const [oid, commit] of commits) {
    if (!pending.has(oid)) pending.set(oid, new Set())
    for (const parent of commit?.parent || []) { if (!pending.has(parent)) pending.set(parent, new Set()); pending.get(parent)!.add(oid) }
  }
  const ready = [...pending].filter(([, children]) => !children.size).map(([oid]) => oid)
  for (let i = 0; i < ready.length; i++) {
    const oid = ready[i]!; order.set(oid, i)
    for (const parent of commits.get(oid)?.parent || []) { const children = pending.get(parent)!; children.delete(oid); if (!children.size) ready.push(parent) }
  }
  entries.sort((a, b) => order.get(a.oid)! - order.get(b.oid)!)
}

function checkRange(text: string, range: GitRange): void {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
  if (range.end > Math.max(1, linesOf(text).length)) throw new Error('WORKBENCH_GIT_RANGE')
}

/** 每次查询只保留提交和范围；源码在当前父子比较结束后释放，不建立磁盘索引。 */
export async function lineHistory(reader: HistoryReader, head: string | null, request: Extract<GitRequest, { action: 'lineHistory' }>, signal: AbortSignal): Promise<GitLineHistory> {
  const { target, text } = request, warnings: Warnings = new Set()
  const context = { reader, warnings, signal }
  const result: GitLineHistory = { head, target, entries: [], uncommitted: false, warnings: [] }
  checkRange(text, target)
  if (text.includes('\0')) throw new Error('WORKBENCH_GIT_HISTORY_FILE')
  const headFile = head ? await reader.file(head, target.path) : null
  if (!headFile) { result.uncommitted = !!text; return result }
  const mapped = mapRange(await historyText(headFile), text, target)
  result.uncommitted = mapped.changed
  if (mapped.ambiguous) warnings.add(mapped.range ? 'range' : 'ambiguous')
  const queue: Target[] = mapped.range && head ? [{ oid: head, range: { ...mapped.range, path: target.path } }] : []
  const seen = new Set<string>(), entries = new Set<string>(), commits = new Map<string, HistoryCommit | null>()
  const commitOf = async (oid: string) => {
    if (!commits.has(oid)) commits.set(oid, await reader.commit(oid))
    return commits.get(oid)!
  }
  for (let index = 0; index < queue.length; index++) {
    signal.throwIfAborted()
    const current = queue[index]!, key = JSON.stringify(current)
    if (seen.has(key)) continue
    seen.add(key)
    const commit = await commitOf(current.oid)
    if (!commit) { warnings.add('missing'); continue }
    const blob = await reader.file(current.oid, current.range.path)
    if (!blob) { warnings.add('missing'); continue }
    for (const parent of commit.parent.length ? commit.parent : [null]) {
      signal.throwIfAborted()
      if (parent && !await commitOf(parent)) { warnings.add('missing'); continue }
      const trace = await traceParent(context, current, blob, parent)
      if (!trace) continue
      const { before, changed } = trace
      if (changed) {
        const entry: GitHistoryEntry = { ...commit, parent, before, after: current.range }
        const identity = JSON.stringify([entry.oid, parent, before, current.range])
        if (!entries.has(identity)) { entries.add(identity); result.entries.push(entry) }
      }
      if (parent && before) queue.push({ oid: parent, range: before })
    }
  }
  // 提交时间可以倒退，展示顺序以子提交先于父提交的拓扑顺序为准。
  sortHistory(result.entries, commits)
  result.warnings = [...warnings]
  return result
}

async function reachableCommit(reader: HistoryReader, head: string | null, target: string, signal: AbortSignal): Promise<HistoryCommit | null> {
  const pending = head ? [head] : [], seen = new Set<string>()
  for (let i = 0; i < pending.length; i++) {
    signal.throwIfAborted()
    const oid = pending[i]!
    if (seen.has(oid)) continue
    seen.add(oid)
    const current = await reader.commit(oid)
    if (oid === target) return current
    pending.push(...current?.parent || [])
  }
  return null
}

export async function lineHistoryDiff(reader: HistoryReader, head: string | null, entry: Pick<GitHistoryEntry, 'oid' | 'parent' | 'before' | 'after'>, signal: AbortSignal): Promise<GitDiff> {
  const commit = await reachableCommit(reader, head, entry.oid, signal)
  if (!commit || (entry.parent ? !commit.parent.includes(entry.parent) : commit.parent.length > 0) || !entry.parent && entry.before) throw new Error('WORKBENCH_GIT_STALE')
  const read = async (oid: string, range: GitRange) => {
    const blob = await reader.file(oid, range.path)
    if (!blob) throw new Error('WORKBENCH_GIT_STALE')
    const text = await historyText(blob); checkRange(text, range)
    return sliceRange(text, range)
  }
  const before = entry.before && entry.parent ? await read(entry.parent, entry.before) : ''
  const after = await read(entry.oid, entry.after)
  return { ...textDiff(entry.after.path, Buffer.from(before), Buffer.from(after)), beforeStart: entry.before?.start || 1, afterStart: entry.after.start }
}
