import { library } from './library.js'

export interface LineRange { start: number; end: number }
interface Span { before: number; after: number; removed: number; added: number; equal: boolean }
const MAX_HISTORY_LINES = 20000
const DIFF_TIMEOUT_MS = 500
const MOVE_SIMILARITY = .6
const MOVE_MARGIN = .1
export const linesOf = (text: string): string[] => { const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop(); return lines }
export function sliceRange(text: string, range: LineRange): string {
  const lines = linesOf(text)
  return lines.slice(range.start - 1, range.end).join('\n') + (text.endsWith('\n') || range.end < lines.length ? '\n' : '')
}

function changes(before: string, after: string): NonNullable<ReturnType<typeof library.diff.diffLines>> {
  if (linesOf(before).length > MAX_HISTORY_LINES || linesOf(after).length > MAX_HISTORY_LINES) throw new Error('WORKBENCH_GIT_DIFF_LIMIT')
  const result = library.diff.diffLines(before, after, { timeout: DIFF_TIMEOUT_MS, maxEditLength: MAX_HISTORY_LINES })
  if (!result) throw new Error('WORKBENCH_GIT_DIFF_LIMIT')
  return result
}

export function similarity(before: string, after: string): number {
  const parts = changes(before, after)
  const common = parts.filter(part => !part.added && !part.removed).reduce((count, part) => count + (part.count || 0), 0)
  return common / Math.max(1, linesOf(before).length, linesOf(after).length)
}

function spansOf(before: string, after: string): Span[] {
  const spans: Span[] = []
  let old = 1, current = 1
  for (const part of changes(before, after)) {
    const equal = !part.added && !part.removed, count = part.count || 0
    let span = spans.at(-1)
    if (!span || equal || span.equal) { span = { before: old, after: current, removed: 0, added: 0, equal }; spans.push(span) }
    if (!part.added) { span.removed += count; old += count }
    if (!part.removed) { span.added += count; current += count }
  }
  return spans
}

function exactLocations(before: string, after: string, range: LineRange): LineRange[] {
  const selected = linesOf(after).slice(range.start - 1, range.end), previous = linesOf(before), matches: LineRange[] = []
  for (let i = 0; i + selected.length <= previous.length; i++) {
    if (selected.every((line, offset) => line === previous[i + offset])) matches.push({ start: i + 1, end: i + selected.length })
  }
  return matches
}

function movedRange(before: string, after: string, range: LineRange, spans: Span[]): { range: LineRange | null; ambiguous: boolean } {
  const exact = exactLocations(before, after, range)
  if (exact.length) {
    const moved = exact.filter(range => spans.some(span => !span.equal && span.before <= range.start && span.before + span.removed > range.end))
    return { range: moved.length === 1 ? moved[0]! : null, ambiguous: moved.length > 1 }
  }
  const selected = sliceRange(after, range)
  const candidates = spans.filter(span => !span.equal && span.removed).map(span => {
    const range = { start: span.before, end: span.before + span.removed - 1 }
    return { range, score: similarity(sliceRange(before, range), selected) }
  }).sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.score < MOVE_SIMILARITY) return { range: null, ambiguous: false }
  const ambiguous = !!candidates[1] && best.score - candidates[1].score < MOVE_MARGIN
  return { range: ambiguous ? null : best.range, ambiguous }
}

/** 从新版本反向映射；前方插行不算修改，整段移动按唯一旧内容定位。 */
export function mapRange(before: string, after: string, range: LineRange): { range: LineRange | null; changed: boolean; ambiguous: boolean } {
  const spans = spansOf(before, after), mapped: LineRange[] = []
  let changed = false, ambiguous = false
  for (const span of spans) {
    if (!span.added) {
      if (span.after > range.start && span.after <= range.end) { changed = true; mapped.push({ start: span.before, end: span.before + span.removed - 1 }) }
      continue
    }
    const start = Math.max(range.start, span.after), end = Math.min(range.end, span.after + span.added - 1)
    if (start > end) continue
    if (span.equal) { mapped.push({ start: span.before + start - span.after, end: span.before + end - span.after }); continue }
    changed = true
    if (span.removed) mapped.push({ start: span.before, end: span.before + span.removed - 1 })
    ambiguous ||= !!span.removed && (span.after < range.start || span.after + span.added - 1 > range.end)
  }
  if (changed && !mapped.length) return { ...movedRange(before, after, range, spans), changed }
  return { range: mapped.length ? { start: Math.min(...mapped.map(item => item.start)), end: Math.max(...mapped.map(item => item.end)) } : null, changed, ambiguous }
}
