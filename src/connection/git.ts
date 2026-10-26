import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { resolve, relative, sep, isAbsolute } from 'node:path'
import type { GitSnapshot, WorkspaceChanges } from './types.js'
const exec = promisify(execFile)
async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', ['--no-optional-locks', '-C', cwd, ...args], {
    timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return result.stdout
}
/** Bound untracked observations and never follow symlinks into another workspace. */
async function untrackedFingerprint(cwd: string, root: string): Promise<string> {
  const paths = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])).split('\0').filter(Boolean)
  if (paths.length > 160) throw new Error('Untracked observation limit')
  const hash = createHash('sha256')
  let bytes = 0
  for (const path of paths) {
    const absolute = resolve(cwd, path), fromRoot = relative(root, absolute)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Outside worktree')
    const info = await lstat(absolute)
    hash.update(path)
    if (info.isSymbolicLink()) { hash.update(await readlink(absolute)); continue }
    bytes += info.size
    if (!info.isFile() || bytes > 1024 * 1024) throw new Error('Untracked observation limit')
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await file.stat()
      if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size) throw new Error('File changed during observation')
      const buffer = Buffer.alloc(info.size + 1)
      const read = await file.read(buffer, 0, buffer.length, 0)
      if (read.bytesRead !== info.size) throw new Error('File changed during observation')
      hash.update(buffer.subarray(0, read.bytesRead))
    } finally { await file.close() }
  }
  return hash.digest('hex')
}
export async function gitWorktreeRoot(cwd: string): Promise<string | false> {
  try { return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() } catch { return false }
}
export async function gitSnapshot(cwd: string): Promise<GitSnapshot> {
  try {
    cwd = await realpath(cwd)
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    const head = await git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => 'unborn')
    const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
    const args = ['--no-ext-diff', '--no-textconv']
    const diff = head === 'unborn'
      ? await git(cwd, ['diff', ...args, '--', '.']) + await git(cwd, ['diff', ...args, '--cached', '--', '.'])
      : await git(cwd, ['diff', ...args, 'HEAD', '--', '.'])
    const untracked = await untrackedFingerprint(cwd, root)
    return { available: true, root, head, fingerprint: createHash('sha256').update(head).update(status).update(diff).update(untracked).digest('hex'),
      dirty: status.split('\0').filter(Boolean).slice(0, 160).map(row => row.slice(0, 1024)) }
  } catch { return { available: false, root: '', head: '', fingerprint: '', dirty: [] } }
}
export async function workspaceChanges(cwd: string, baseline: GitSnapshot): Promise<WorkspaceChanges> {
  const current = await gitSnapshot(cwd)
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--stat', ...(current.head === 'unborn' ? [] : ['HEAD']), '--', '.']
  const stat = current.available ? await git(cwd, args).catch(() => '') : ''
  const available = baseline.available && current.available
  return { available, baselineDirty: baseline.dirty, currentDirty: current.dirty,
    changedSinceStart: available && baseline.fingerprint !== current.fingerprint, headChanged: available && baseline.head !== current.head,
    diffStat: stat.slice(0, 8000), truncated: !available || stat.length > 8000 || current.dirty.length >= 160, attribution: 'workspace-observation' }
}
