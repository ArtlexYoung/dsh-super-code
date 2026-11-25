import type { Change } from 'diff'
import type { GitDiff } from './request.js'

export const MAX_DIFF_LINES = 20000

/** 两处界面与 Git 后端共用逐行差异，不按文件后缀判断文本。 */
export function compareText(path: string, before: string, after: string, changes: Change[] | undefined): GitDiff {
  if (!changes) throw new Error('WORKBENCH_GIT_DIFF_LIMIT')
  const lines: GitDiff['lines'] = []
  let previous = 1, next = 1
  for (const part of changes) {
    const text = part.value.split('\n'); if (text.at(-1) === '') text.pop()
    for (const value of text) {
      if (lines.length === MAX_DIFF_LINES) throw new Error('WORKBENCH_GIT_DIFF_LIMIT')
      lines.push({ kind: part.added ? 'added' : part.removed ? 'removed' : 'context', text: value,
        before: part.added ? null : previous++, after: part.removed ? null : next++ })
    }
  }
  return { path, binary: false, before, after, lines }
}

export interface DiffBlock { before: number; after: number; removed: number; added: number }
export function diffBlocks(lines: GitDiff['lines']): DiffBlock[] {
  const blocks: DiffBlock[] = []
  let before = 1, after = 1, current: DiffBlock | undefined
  for (const line of lines) {
    if (line.kind === 'context') { current = undefined; before++; after++; continue }
    if (!current) { current = { before, after, removed: 0, added: 0 }; blocks.push(current) }
    if (line.kind === 'removed') { current.removed++; before++ } else { current.added++; after++ }
  }
  return blocks
}

/** 使用原文偏移替换，保留 CRLF、BOM 和文件末尾是否换行。 */
function copyTextHunk(diff: GitDiff, hunk: number, forward: boolean): string {
  const block = diffBlocks(diff.lines)[hunk]
  if (diff.binary || !Number.isInteger(hunk) || !block) throw new Error('WORKBENCH_GIT_HUNK')
  const offset = (text: string, line: number) => {
    let at = 0
    for (let i = 1; i < line; i++) { const next = text.indexOf('\n', at); if (next < 0) return text.length; at = next + 1 }
    return at
  }
  const [target, targetLine, targetCount, source, sourceLine, sourceCount] = forward
    ? [diff.before, block.before, block.removed, diff.after, block.after, block.added] as const
    : [diff.after, block.after, block.added, diff.before, block.before, block.removed] as const
  return target.slice(0, offset(target, targetLine))
    + source.slice(offset(source, sourceLine), offset(source, sourceLine + sourceCount))
    + target.slice(offset(target, targetLine + targetCount))
}

export const restoreTextHunk = (diff: GitDiff, hunk: number): string => copyTextHunk(diff, hunk, false)
export const stageTextHunk = (diff: GitDiff, hunk: number): string => copyTextHunk(diff, hunk, true)

export interface ConflictBlock { from: number; to: number; ours: string; theirs: string }
export function conflictBlocks(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  const marker = /^(<{7,}|\|{7,}|={7,}|>{7,})(?: ([^\r\n]*))?\r?$/gm
  let current: { from: number; start: number; size: number; oursEnd?: number; split?: number } | undefined
  let match: RegExpExecArray | null
  while ((match = marker.exec(text))) {
    const token = match[1]!, next = marker.lastIndex + (text[marker.lastIndex] === '\n' ? 1 : 0)
    if (token[0] === '<') { current = { from: match.index, start: next, size: token.length }; continue }
    if (!current || token.length !== current.size) continue
    if (token[0] === '|' && current.split === undefined) current.oursEnd ??= match.index
    if (token[0] === '=' && match[2] === undefined && current.split === undefined) { current.oursEnd ??= match.index; current.split = next }
    if (token[0] === '>' && current.split !== undefined) {
      blocks.push({ from: current.from, to: next, ours: text.slice(current.start, current.oursEnd!), theirs: text.slice(current.split, match.index) })
      current = undefined
    }
  }
  return blocks
}
