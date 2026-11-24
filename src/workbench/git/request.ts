import { z } from 'zod'

const MAX_PATH_LENGTH = 4096
const path = z.string().min(1).max(MAX_PATH_LENGTH).refine(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.split('/').some(part => ['.', '..', '.git'].includes(part)), 'WORKBENCH_GIT_PATH')
const version = z.string().regex(/^[a-f0-9]{64}$/)
const oid = z.string().regex(/^[a-f0-9]{40}$/)
const range: z.ZodType<{ path: string; start: number; end: number }> = z.object({ path, start: z.number().int().min(1), end: z.number().int().min(1) }).strict().refine(value => value.end >= value.start, 'WORKBENCH_GIT_RANGE')
const historyEntry = z.object({ oid, parent: oid.nullable(), before: range.nullable(), after: range }).strict()
const paths = z.array(path).min(1).refine(items => new Set(items).size === items.length)
const branch = z.string().min(1).max(240).refine(value => !['@', 'HEAD'].includes(value) && !value.startsWith('-') && !value.startsWith('/') && !value.endsWith('/') && !value.endsWith('.') && !/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) && !value.includes('..') && !value.includes('@{') && !value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock')), 'WORKBENCH_GIT_BRANCH')
const remote = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/)
const auth = z.object({ username: z.string().max(256), password: z.string().max(8192) }).strict().optional()
const author = z.object({ name: z.string().trim().min(1).max(256).refine(value => !/[\r\n<>]/.test(value)), email: z.email().max(320) }).strict()

export const gitRequestSchema: z.ZodType<GitRequest> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('diff'), path, side: z.enum(['worktree', 'staged', 'total']), version }).strict(),
  z.object({ action: z.literal('restoreHunk'), path, side: z.enum(['worktree', 'staged', 'total']), hunk: z.number().int().min(0).max(20000), version }).strict(),
  z.object({ action: z.literal('stageHunk'), path, hunk: z.number().int().min(0).max(20000), version }).strict(),
  z.object({ action: z.literal('conflict'), path, version }).strict(),
  z.object({ action: z.literal('resolveConflict'), path, text: z.string().refine(value => !value.includes('\0') && Buffer.byteLength(value) <= 2 * 1024 * 1024).nullable(), version }).strict(),
  z.object({ action: z.literal('stats'), paths: paths.max(64), version }).strict(),
  z.object({ action: z.literal('init'), branch }).strict(),
  z.object({ action: z.literal('stage'), paths, version }).strict(),
  z.object({ action: z.literal('unstage'), paths, version }).strict(),
  z.object({ action: z.literal('commitFiles'), oid, version }).strict(),
  z.object({ action: z.literal('historyDiff'), oid, path, version }).strict(),
  z.object({ action: z.literal('lineHistory'), target: range, text: z.string().max(2 * 1024 * 1024), version }).strict(),
  z.object({ action: z.literal('lineHistoryDiff'), entry: historyEntry, version }).strict(),
  z.object({ action: z.literal('commit'), message: z.string().trim().min(1).max(16000), author, version }).strict(),
  z.object({ action: z.literal('branch'), branch, version }).strict(),
  z.object({ action: z.literal('checkout'), branch, version }).strict(),
  z.object({ action: z.literal('deleteBranch'), branch, version }).strict(),
  z.object({ action: z.literal('merge'), branch, author, version }).strict(),
  z.object({ action: z.literal('abortMerge'), version }).strict(),
  z.object({ action: z.literal('remote'), remote, url: z.string().max(4096), version }).strict(),
  z.object({ action: z.enum(['fetch', 'pull', 'push']), remote, auth, version }).strict(),
])

export type GitRequest =
  | { action: 'status' }
  | { action: 'diff'; path: string; side: 'worktree' | 'staged' | 'total'; version: string }
  | { action: 'restoreHunk'; path: string; side: 'worktree' | 'staged' | 'total'; hunk: number; version: string }
  | { action: 'stageHunk'; path: string; hunk: number; version: string }
  | { action: 'conflict'; path: string; version: string }
  | { action: 'resolveConflict'; path: string; text: string | null; version: string }
  | { action: 'stats'; paths: string[]; version: string }
  | { action: 'init'; branch: string }
  | { action: 'stage' | 'unstage'; paths: string[]; version: string }
  | { action: 'commitFiles'; oid: string; version: string }
  | { action: 'historyDiff'; oid: string; path: string; version: string }
  | { action: 'lineHistory'; target: GitRange; text: string; version: string }
  | { action: 'lineHistoryDiff'; entry: Pick<GitHistoryEntry, 'oid' | 'parent' | 'before' | 'after'>; version: string }
  | { action: 'commit'; message: string; author: { name: string; email: string }; version: string }
  | { action: 'branch' | 'checkout' | 'deleteBranch'; branch: string; version: string }
  | { action: 'merge'; branch: string; author: { name: string; email: string }; version: string }
  | { action: 'abortMerge'; version: string }
  | { action: 'remote'; remote: string; url: string; version: string }
  | { action: 'fetch' | 'pull' | 'push'; remote: string; auth?: { username: string; password: string }; version: string }

export interface GitChange { path: string; head: number; worktree: number; stage: number; conflict?: boolean }
export interface GitState {
  exists: boolean; version: string; branch: string | null; head: string | null; writable: boolean
  changes: GitChange[]; branches: string[]; remotes: { remote: string; url: string }[]
  history: { oid: string; message: string; author: string; timestamp: number }[]
  author: { name: string; email: string }
  backend: 'native' | 'builtin'; merging: boolean; remoteBranches: string[]
}
export interface GitDiff {
  path: string; binary: boolean; before: string; after: string
  beforeStart?: number; afterStart?: number
  lines: { kind: 'context' | 'added' | 'removed'; text: string; before: number | null; after: number | null }[]
}
export type GitRange = z.infer<typeof range>
export interface GitHistoryEntry {
  oid: string; parent: string | null; before: GitRange | null; after: GitRange
  message: string; author: string; timestamp: number
}
export interface GitLineHistory {
  head: string | null; target: GitRange; entries: GitHistoryEntry[]; uncommitted: boolean
  warnings: ('missing' | 'ambiguous' | 'range' | 'unsupported')[]
}
export interface GitStat { path: string; added: number; removed: number; binary: boolean; limited?: boolean }
export interface GitConflict { path: string; ours: string | null; theirs: string | null; result: string | null; version: string }
export type GitResult = { kind: 'state'; state: GitState } | { kind: 'diff'; diff: GitDiff } | { kind: 'commitFiles'; oid: string; files: string[] } | { kind: 'stats'; version: string; stats: GitStat[] } | { kind: 'lineHistory'; history: GitLineHistory } | { kind: 'conflict'; conflict: GitConflict }

export function remoteUrl(value: string, native = false): string {
  if (native && /^[\w.-]+@[\w.-]+:[^\s\0]+$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('WORKBENCH_GIT_URL') }
  const ssh = native && url.protocol === 'ssh:'
  if ((!ssh && !['https:', 'http:'].includes(url.protocol)) || (!ssh && url.username) || url.password || url.search || url.hash) throw new Error('WORKBENCH_GIT_URL')
  return url.href
}
