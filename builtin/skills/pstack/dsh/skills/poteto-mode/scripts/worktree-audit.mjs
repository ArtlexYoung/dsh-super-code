import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function git(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 })
}

/** Inspect Git state only. No worktree is classified as safe to delete. */
export function auditWorktrees(repository, base) {
  const root = resolve(repository)
  const baseCommit = base ? git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim() : ''
  const records = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean)
  const worktrees = records.map(record => {
    const fields = Object.fromEntries(record.split('\0').filter(Boolean).map(line => {
      const space = line.indexOf(' ')
      return space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)]
    }))
    if (!fields.worktree || !fields.HEAD) throw new Error('Unexpected Git worktree record')
    const row = { path: fields.worktree, head: fields.HEAD, branch: fields.branch ?? '(detached)',
      locked: Object.hasOwn(fields, 'locked'), activity: 'unknown', recommendation: 'retain-until-ownership-confirmed' }
    try {
      const status = git(fields.worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignored=matching'])
      let merge = 'not-checked'
      if (baseCommit) {
        try { git(root, ['merge-base', '--is-ancestor', fields.HEAD, baseCommit]); merge = 'ancestor' }
        catch (error) { if (error.status !== 1) throw error; merge = 'not-ancestor' }
      }
      return { ...row, inspection: 'available', dirty: status.length > 0, status, merge }
    } catch {
      return { ...row, inspection: 'unavailable', recommendation: 'retain-inspection-failed' }
    }
  })
  return { repository: root, ...(baseCommit ? { baseCommit } : {}), worktrees }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--help') || args.includes('-h')) console.log('Usage: worktree-audit.sh [-b|--base <ref>] [repo-path]\nRead-only JSON; conversation activity is unknown and removals require confirmation.')
    else {
      let base, repository = process.cwd(), seenPath = false
      while (args.length) {
        const arg = args.shift()
        if (arg === '-b' || arg === '--base') { if (!args[0]) throw new Error('Missing base ref'); base = args.shift() }
        else if (arg.startsWith('-')) throw new Error('Unknown option')
        else { if (seenPath) throw new Error('Only one repository path is accepted'); repository = arg; seenPath = true }
      }
      console.log(JSON.stringify(auditWorktrees(repository, base), null, 2))
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
