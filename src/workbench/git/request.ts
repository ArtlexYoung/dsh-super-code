import { z } from 'zod'

const MAX_PATH_LENGTH = 4096
const MAX_PATHS = 2000
// 路径的单个字符在 JSON 中最多占六个字符，另留请求字段的空间。
export const MAX_GIT_REQUEST_LENGTH: number = MAX_PATHS * (MAX_PATH_LENGTH * 6 + 3) + 16384
const path = z.string().min(1).max(MAX_PATH_LENGTH).refine(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value) && !value.split('/').some(part => ['.', '..', '.git'].includes(part)), 'WORKBENCH_GIT_PATH')
const version = z.string().regex(/^[a-f0-9]{64}$/)
const oid = z.string().regex(/^[a-f0-9]{40}$/)
const paths = z.array(path).min(1).max(MAX_PATHS).refine(items => new Set(items).size === items.length)
const branch = z.string().min(1).max(240).refine(value => !['@', 'HEAD'].includes(value) && !value.startsWith('-') && !value.startsWith('/') && !value.endsWith('/') && !value.endsWith('.') && !/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) && !value.includes('..') && !value.includes('@{') && !value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock')), 'WORKBENCH_GIT_BRANCH')
const remote = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/)
const auth = z.object({ username: z.string().max(256), password: z.string().max(8192) }).strict().optional()
const author = z.object({ name: z.string().trim().min(1).max(256).refine(value => !/[\r\n<>]/.test(value)), email: z.email().max(320) }).strict()

export const gitRequestSchema: z.ZodType<GitRequest> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('diff'), path, side: z.enum(['worktree', 'staged']), version }).strict(),
  z.object({ action: z.literal('init'), branch }).strict(),
  z.object({ action: z.literal('stage'), paths, version }).strict(),
  z.object({ action: z.literal('unstage'), paths, version }).strict(),
  z.object({ action: z.literal('commitFiles'), oid, version }).strict(),
  z.object({ action: z.literal('historyDiff'), oid, path, version }).strict(),
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
  | { action: 'diff'; path: string; side: 'worktree' | 'staged'; version: string }
  | { action: 'init'; branch: string }
  | { action: 'stage' | 'unstage'; paths: string[]; version: string }
  | { action: 'commitFiles'; oid: string; version: string }
  | { action: 'historyDiff'; oid: string; path: string; version: string }
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
  lines: { kind: 'context' | 'added' | 'removed'; text: string; before: number | null; after: number | null }[]
}
export type GitResult = { kind: 'state'; state: GitState } | { kind: 'diff'; diff: GitDiff } | { kind: 'commitFiles'; oid: string; files: string[] }

export function remoteUrl(value: string, native = false): string {
  if (native && /^[\w.-]+@[\w.-]+:[^\s\0]+$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch { throw new Error('WORKBENCH_GIT_URL') }
  const ssh = native && url.protocol === 'ssh:'
  if ((!ssh && !['https:', 'http:'].includes(url.protocol)) || (!ssh && url.username) || url.password || url.search || url.hash) throw new Error('WORKBENCH_GIT_URL')
  return url.href
}
