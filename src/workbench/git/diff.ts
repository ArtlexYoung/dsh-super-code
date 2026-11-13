import type { PromiseFsClient } from 'isomorphic-git'
import { library } from './library.js'
import { MAX_FILE_BYTES } from '../files.js'
import type { GitDiff, GitStat } from './request.js'

const MAX_DIFF_LINES = 20000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export async function repositoryContents(options: { fs: PromiseFsClient; dir: string; head: string | null }, file: string, side: 'staged' | 'worktree' | 'total', conflict = false): Promise<{ before: Uint8Array; after: Uint8Array }> {
  const { git } = library
  const head = () => git.TREE({ ref: options.head || EMPTY_TREE })
  const trees = side === 'staged' ? [head(), git.STAGE()] : [side === 'total' || conflict ? head() : git.STAGE(), git.WORKDIR({ refresh: false })]
  return treeContents(options, file, trees)
}

export async function repositoryDiff(options: { fs: PromiseFsClient; dir: string; head: string | null }, file: string, side: 'staged' | 'worktree' | 'total', conflict = false): Promise<GitDiff> {
  const { before, after } = await repositoryContents(options, file, side, conflict)
  return textDiff(file, before, after)
}

type Options = { fs: PromiseFsClient; dir: string }
async function treeContents(options: Options, file: string, trees: ReturnType<typeof library.git.TREE>[]): Promise<{ before: Uint8Array; after: Uint8Array }> {
  const { git } = library
  const rows: { before: Uint8Array; after: Uint8Array }[] = await git.walk({ ...options, trees,
    map: async (path, entries) => {
      if (path !== file) return path === '.' || file.startsWith(path + '/') ? undefined : null
      const values = await Promise.all(entries.map(async entry => {
        if (!entry || await entry.type() !== 'blob') return new Uint8Array()
        const content = await entry.content() ?? (await git.readBlob({ ...options, oid: await entry.oid() })).blob
        if ((content?.byteLength ?? 0) > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
        return content || new Uint8Array()
      }))
      return { before: values[0], after: values[1] }
    },
  })
  return rows[0] || { before: new Uint8Array(), after: new Uint8Array() }
}

export async function commitFiles(options: Options, oid: string): Promise<string[]> {
  const { git } = library
  const { commit } = await git.readCommit({ ...options, oid })
  const files = await git.walk({ ...options, trees: [git.TREE({ ref: commit.parent[0] || EMPTY_TREE }), git.TREE({ ref: oid })],
    map: async (path, [before, after]) => {
      if (path === '.' || await (after || before)!.type() === 'tree') return undefined
      return await before?.oid() === await after?.oid() && await before?.mode() === await after?.mode() ? undefined : path
    },
  })
  return files
}

export async function commitDiff(options: Options, oid: string, file: string): Promise<GitDiff> {
  const { git } = library
  const { commit } = await git.readCommit({ ...options, oid })
  const { before, after } = await treeContents(options, file, [git.TREE({ ref: commit.parent[0] || EMPTY_TREE }), git.TREE({ ref: oid })])
  return textDiff(file, before, after)
}

/** 侧栏只统计可见文件，不构造逐行对比视图。 */
export function textStat(file: string, old: Uint8Array, current: Uint8Array): GitStat {
  const result = { path: file, added: 0, removed: 0, binary: false }
  if (old.byteLength > MAX_FILE_BYTES || current.byteLength > MAX_FILE_BYTES) return { ...result, limited: true }
  let before: string, after: string
  try {
    const decoder = new TextDecoder('utf8', { fatal: true })
    before = decoder.decode(old); after = decoder.decode(current)
    if (before.includes('\0') || after.includes('\0')) return { ...result, binary: true }
  } catch { return { ...result, binary: true } }
  const changes = library.diff.diffLines(before, after, { timeout: 100, maxEditLength: MAX_DIFF_LINES })
  if (!changes) return { ...result, limited: true }
  for (const part of changes) {
    if (part.added) result.added += part.count || 0
    if (part.removed) result.removed += part.count || 0
  }
  return result
}

export function textDiff(file: string, old: Uint8Array, current: Uint8Array): GitDiff {
  if (old.byteLength > MAX_FILE_BYTES || current.byteLength > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
  let before: string, after: string
  try {
    const decoder = new TextDecoder('utf8', { fatal: true })
    before = decoder.decode(old); after = decoder.decode(current)
    if (before.includes('\0') || after.includes('\0')) throw new Error('binary')
  } catch { return { path: file, binary: true, before: '', after: '', lines: [] } }
  const changes = library.diff.diffLines(before, after, { timeout: 500, maxEditLength: MAX_DIFF_LINES })
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
  return { path: file, binary: false, before, after, lines }
}
