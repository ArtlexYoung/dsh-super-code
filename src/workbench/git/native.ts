import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { GitChange, GitRequest, GitState } from './request.js'
import { textDiff } from './diff.js'
import type { GitDiff } from './request.js'
import { remoteUrl } from './request.js'
import { MAX_FILE_BYTES } from '../files.js'

export type ConfineGit = (argv: readonly string[], policy: SandboxExecutionPolicy, signal: AbortSignal) => readonly string[] | Promise<readonly string[]>
interface CommandResult { code: number; stdout: Buffer; stderr: string }

export async function detectGit(executable: string): Promise<boolean> {
  return new Promise(resolve => { execFile(executable, ['--version'], { timeout: 3000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => resolve(!error && /^git version /m.test(stdout))) })
}

function commandError(stderr: string): Error {
  const code = /index\.lock|Unable to create.*\.lock/.test(stderr) ? 'BUSY'
    : /Not possible to fast-forward/.test(stderr) ? 'DIVERGED'
    : /not fully merged/.test(stderr) ? 'BRANCH_UNMERGED'
    : /non-fast-forward|fetch first|rejected/.test(stderr) ? 'PUSH_REJECTED'
    : /Authentication failed|could not read Username|Permission denied|401|403/.test(stderr) ? 'AUTH'
    : /identity unknown|unable to auto-detect email/.test(stderr) ? 'AUTHOR' : 'NATIVE'
  return new Error(`WORKBENCH_GIT_${code}`)
}

/** 原生 Git 只接受固定参数；凭据与提交正文经环境和 stdin 传递。 */
export class NativeGit {
  constructor(private readonly root: string, private readonly executable: string, private readonly signal: AbortSignal,
    private readonly policy: SandboxExecutionPolicy | undefined = undefined, private readonly confine: ConfineGit | undefined = undefined) {}

  private async run(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; write?: boolean; optional?: boolean } = {}): Promise<CommandResult> {
    this.signal.throwIfAborted()
    let argv: readonly string[] = [this.executable, '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', this.root, ...args]
    if (options.write && this.policy?.mode === 'read-only') throw new Error('WORKBENCH_GIT_READONLY')
    // status 等读取也可能启动仓库配置的 filter，所有受限命令使用同一沙箱。
    if (this.policy && this.policy.mode !== 'danger-full-access') {
      if (!this.confine) throw new Error('WORKBENCH_GIT_SANDBOX')
      argv = await this.confine(argv, this.policy, this.signal)
      this.signal.throwIfAborted()
    }
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...options.env }
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key]
    return new Promise((resolve, reject) => {
      const child = execFile(argv[0]!, argv.slice(1), { cwd: this.root, env, signal: this.signal, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (this.signal.aborted) { reject(this.signal.reason); return }
        if (error && typeof error.code !== 'number') { reject(new Error('WORKBENCH_GIT_NATIVE')); return }
        const result = { code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr: stderr.toString('utf8') }
        if (result.code && !options.optional) reject(commandError(result.stderr)); else resolve(result)
      })
      child.stdin?.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error) })
      child.stdin?.end(options.input)
    })
  }

  private async text(args: string[], optional = false): Promise<string> { return (await this.run(args, { optional })).stdout.toString('utf8').replace(/\n$/, '') }

  async snapshot(writable: boolean): Promise<GitState> {
    const state: GitState = { exists: false, version: '', branch: null, head: null, writable, changes: [], branches: [], remotes: [], history: [], author: { name: '', email: '' }, backend: 'native', merging: false, remoteBranches: [] }
    const repository = await this.run(['rev-parse', '--show-toplevel'], { optional: true })
    const hash = createHash('sha256')
    if (repository.code) {
      if (await fs.lstat(join(this.root, '.git')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('WORKBENCH_GIT_LAYOUT')
      state.version = hash.update('missing').digest('hex'); return state
    }
    if (await fs.realpath(repository.stdout.toString('utf8').replace(/\n$/, '')) !== this.root) throw new Error('WORKBENCH_GIT_ROOT')
    state.exists = true
    const [branch, head, refs, statusResult, remotes, name, email, gitdir] = await Promise.all([
      this.text(['symbolic-ref', '--quiet', '--short', 'HEAD'], true), this.text(['rev-parse', '--verify', '--quiet', 'HEAD'], true),
      this.text(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes']),
      this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
      this.text(['config', '--get-regexp', '^remote\\..*\\.url$'], true), this.text(['config', '--get', 'user.name'], true),
      this.text(['config', '--get', 'user.email'], true), this.text(['rev-parse', '--absolute-git-dir']),
    ])
    state.branch = branch || null; state.head = head || null; state.author = { name, email }
    const references = refs.split('\n').filter(Boolean).map(line => line.slice(0, line.lastIndexOf(' ')))
    state.branches = references.filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice(11))
    state.remoteBranches = references.filter(ref => ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')).map(ref => ref.slice(13))
    state.merging = !!await fs.readFile(join(gitdir, 'MERGE_HEAD'), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
    const status = statusResult.stdout.toString('utf8')
    const changes = new Map<string, GitChange>()
    for (const record of status.split('\0').filter(Boolean)) {
      const x = record[0]!, y = record[1]!, path = record.slice(3)
      const head = x === 'A' || x === '?' ? 0 : 1
      const stage = x === 'D' || x === '?' ? 0 : x === ' ' ? head : 2
      const worktree = y === 'D' || x === 'D' && y === ' ' ? 0 : y === ' ' ? stage : 3
      const old = changes.get(path)
      changes.set(path, old && x === '?' ? { ...old, worktree: 3 } : { path, head, stage, worktree, conflict: x === 'U' || y === 'U' || x === 'A' && y === 'A' || x === 'D' && y === 'D' })
    }
    state.changes = [...changes.values()]
    if (state.changes.length > 2000) throw new Error('WORKBENCH_GIT_CHANGE_LIMIT')
    for (const entry of remotes.split('\n').filter(Boolean)) {
      const match = /^remote\.(.+)\.url (.*)$/.exec(entry)
      if (!match) continue
      let url = ''; try { url = remoteUrl(match[2]!, true) } catch { /* 非支持地址不回传认证信息。 */ }
      state.remotes.push({ remote: match[1]!, url })
    }
    if (state.head) state.history = (await this.text(['log', '-30', '-z', '--format=%H%n%an%n%at%n%B'])).split('\0').filter(Boolean).map(record => {
      const [oid, author, timestamp, ...message] = record.split('\n')
      return { oid: oid!, author: author!, timestamp: Number(timestamp), message: message.join('\n') }
    })
    hash.update(JSON.stringify([state.head, state.branch, state.branches, state.remoteBranches, state.remotes, state.merging]))
    hash.update(refs)
    for (const name of ['index', 'config', 'MERGE_HEAD']) hash.update(await fs.readFile(join(gitdir, name)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error }))
    for (const file of state.changes) {
      const info = await fs.lstat(join(this.root, file.path)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      hash.update(JSON.stringify([file, info && [info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs]]))
    }
    state.version = hash.digest('hex'); return state
  }

  async diff(file: string, side: 'staged' | 'worktree', state: GitState): Promise<GitDiff> {
    const entry = state.changes.find(change => change.path === file)
    if (!entry) throw new Error('WORKBENCH_GIT_STALE')
    const staged = entry.conflict ? await this.blob(`HEAD:${file}`, true) : entry.stage ? await this.blob(`:${file}`) : Buffer.alloc(0)
    const before = side === 'staged' ? entry.head ? await this.blob(`HEAD:${file}`) : Buffer.alloc(0) : staged
    let after = staged
    if (side === 'worktree') {
      const info = await fs.lstat(join(this.root, file)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      if (info && info.size > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
      after = !info ? Buffer.alloc(0) : info.isSymbolicLink() ? Buffer.from(await fs.readlink(join(this.root, file))) : await fs.readFile(join(this.root, file))
    }
    return textDiff(file, before, after)
  }

  private async blob(ref: string, optional = false): Promise<Buffer> {
    const size = await this.run(['cat-file', '-s', ref], { optional })
    if (size.code) return Buffer.alloc(0)
    if (Number(size.stdout.toString('utf8')) > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
    return (await this.run(['show', ref])).stdout
  }

  async commitFiles(oid: string): Promise<string[]> {
    const parent = (await this.text(['rev-list', '--parents', '-n', '1', oid])).split(' ')[1]
    const args = parent ? [parent, oid] : ['--root', oid]
    const files = (await this.text(['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', ...args])).split('\0').filter(Boolean)
    if (files.length > 2000) throw new Error('WORKBENCH_GIT_CHANGE_LIMIT')
    return files
  }

  async commitDiff(oid: string, file: string): Promise<GitDiff> {
    const parent = (await this.text(['rev-list', '--parents', '-n', '1', oid])).split(' ')[1]
    return textDiff(file, parent ? await this.blob(`${parent}:${file}`, true) : Buffer.alloc(0), await this.blob(`${oid}:${file}`, true))
  }

  async mutate(request: GitRequest, state: GitState): Promise<void> {
    const write = { write: true }
    switch (request.action) {
      case 'init': await this.run(['init', '-b', request.branch], write); return
      case 'stage': await this.run(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { ...write, input: request.paths.join('\0') + '\0' }); return
      case 'unstage': await this.run(state.head ? ['reset', '-q', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'] : ['rm', '--cached', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], { ...write, input: request.paths.join('\0') + '\0' }); return
      case 'commit':
        if (!state.merging && !state.changes.some(file => file.head !== file.stage)) throw new Error('WORKBENCH_GIT_EMPTY_COMMIT')
        if (state.changes.some(file => file.conflict)) throw new Error('WORKBENCH_GIT_CONFLICT')
        await this.run(['commit', '-F', '-'], { ...write, input: request.message, env: this.author(request.author) }); return
      case 'branch': await this.run(['branch', '--', request.branch], write); return
      case 'deleteBranch': await this.run(['branch', '-d', '--', request.branch], write); return
      case 'checkout':
        if (state.changes.length || state.merging) throw new Error('WORKBENCH_GIT_DIRTY')
        if (!state.branches.includes(request.branch)) throw new Error('WORKBENCH_GIT_BRANCH')
        await this.run(['checkout', request.branch, '--'], write); return
      case 'merge': {
        if (state.changes.length || state.merging) throw new Error('WORKBENCH_GIT_DIRTY')
        if (!state.branch || ![...state.branches, ...state.remoteBranches].includes(request.branch)) throw new Error('WORKBENCH_GIT_BRANCH')
        const ref = state.branches.includes(request.branch) ? `refs/heads/${request.branch}` : `refs/remotes/${request.branch}`
        const result = await this.run(['merge', '--no-edit', '--', ref], { ...write, env: this.author(request.author), optional: true })
        if (result.code && !await this.text(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], true)) throw commandError(result.stderr)
        return
      }
      case 'abortMerge':
        if (!state.merging) throw new Error('WORKBENCH_GIT_NO_MERGE')
        await this.run(['merge', '--abort'], write); return
      case 'remote':
        await this.run(state.remotes.some(item => item.remote === request.remote) ? ['remote', 'set-url', request.remote, remoteUrl(request.url, true)] : ['remote', 'add', request.remote, remoteUrl(request.url, true)], write); return
      case 'fetch': case 'pull': case 'push': {
        const remote = state.remotes.find(item => item.remote === request.remote)
        if (!remote?.url) throw new Error('WORKBENCH_GIT_URL')
        if (request.action === 'pull' && (state.changes.length || state.merging)) throw new Error('WORKBENCH_GIT_DIRTY')
        if (request.action !== 'fetch' && !state.branch) throw new Error('WORKBENCH_GIT_BRANCH')
        const env: NodeJS.ProcessEnv = {}
        if (request.auth) {
          if (!/^https?:/.test(remote.url)) throw new Error('WORKBENCH_GIT_AUTH_PROTOCOL')
          env.GIT_CONFIG_COUNT = '2'; env.GIT_CONFIG_KEY_0 = `http.${remote.url}.extraHeader`
          env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`${request.auth.username}:${request.auth.password}`).toString('base64')}`
          env.GIT_CONFIG_KEY_1 = 'http.followRedirects'; env.GIT_CONFIG_VALUE_1 = 'false'
        }
        const args = request.action === 'fetch' ? ['fetch', request.remote]
          : request.action === 'pull' ? ['pull', '--ff-only', request.remote, state.branch!]
          : ['push', request.remote, `refs/heads/${state.branch}:refs/heads/${state.branch}`]
        await this.run(args, { ...write, env }); return
      }
      default: throw new Error('WORKBENCH_GIT_REQUEST')
    }
  }

  private author(author: { name: string; email: string }): NodeJS.ProcessEnv {
    return { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email }
  }
}
