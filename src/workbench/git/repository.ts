import * as native from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { PromiseFsClient } from 'isomorphic-git'
import { library } from './library.js'
import { containsPath, gitFileSystem } from './filesystem.js'
import { gitRequestSchema, remoteUrl } from './request.js'
import type { GitRequest, GitResult, GitState } from './request.js'
import { repositoryDiff, commitFiles, commitDiff } from './diff.js'
import { mergeHead, conflictPaths, mergeBranch, abortMerge, clearMerge } from './merge.js'
import { detectGit, NativeGit } from './native.js'
import type { ConfineGit } from './native.js'

const MAX_CHANGES = 2000
const { git, http } = library
type Options = { fs: PromiseFsClient; dir: string }

async function optionalFile(options: Options, file: string): Promise<Buffer> {
  try { return await options.fs.promises.readFile(join(options.dir, file)) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return Buffer.alloc(0); throw error }
}

async function snapshot(options: Options, writable: boolean): Promise<GitState> {
  const dotgit = await options.fs.promises.lstat(join(options.dir, '.git')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  if (dotgit && !dotgit.isDirectory()) throw new Error('WORKBENCH_GIT_LAYOUT')
  const state: GitState = { exists: !!dotgit, version: '', branch: null, head: null, writable, changes: [], branches: [], remotes: [], history: [], author: { name: '', email: '' }, backend: 'builtin', merging: false, remoteBranches: [] }
  const hash = createHash('sha256')
  if (dotgit) {
    const rows = await git.statusMatrix({ ...options, refresh: false })
    state.changes = rows.filter(([, head, worktree, stage]) => head !== worktree || head !== stage).map(([path, head, worktree, stage]) => ({ path, head, worktree, stage }))
    if (state.changes.length > MAX_CHANGES) throw new Error('WORKBENCH_GIT_CHANGE_LIMIT')
    state.branch = await git.currentBranch(options) || null
    try { state.head = await git.resolveRef({ ...options, ref: 'HEAD' }) }
    catch (error) { if (!(error instanceof git.Errors.NotFoundError)) throw error }
    state.branches = await git.listBranches(options)
    state.merging = !!await mergeHead(options)
    if (state.merging) {
      const conflicts = await conflictPaths(options)
      for (const path of conflicts) {
        const change = state.changes.find(item => item.path === path)
        if (change) change.conflict = true
        else state.changes.push({ path, head: 1, worktree: 2, stage: 1, conflict: true })
      }
    }
    // 带内嵌凭据的旧地址不返回给浏览器，也不用于远程调用。
    state.remotes = (await git.listRemotes(options)).map(item => {
      try { return { remote: item.remote, url: remoteUrl(item.url) } } catch { return { remote: item.remote, url: '' } }
    })
    for (const remote of state.remotes) state.remoteBranches.push(...(await git.listBranches({ ...options, remote: remote.remote })).filter(branch => branch !== 'HEAD').map(branch => `${remote.remote}/${branch}`))
    for (const ref of [...state.branches.map(branch => `refs/heads/${branch}`), ...state.remoteBranches.map(branch => `refs/remotes/${branch}`)]) {
      hash.update(ref).update(await git.resolveRef({ ...options, ref }))
    }
    if (state.head) state.history = (await git.log({ ...options, depth: 30 })).map(({ oid, commit }) => ({ oid, message: commit.message, author: commit.author.name, timestamp: commit.author.timestamp }))
    state.author = { name: await git.getConfig({ ...options, path: 'user.name' }) || '', email: await git.getConfig({ ...options, path: 'user.email' }) || '' }
    for (const file of ['.git/HEAD', '.git/index', '.git/config', '.git/MERGE_HEAD']) hash.update(await optionalFile(options, file))
    for (const file of state.changes) {
      const info = await options.fs.promises.lstat(join(options.dir, file.path)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      hash.update(JSON.stringify([file, info && [info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs]]))
    }
  }
  hash.update(JSON.stringify([state.head, state.branch, state.branches, state.remoteBranches, state.remotes, state.merging]))
  state.version = hash.digest('hex')
  return state
}

/** 每个仓库只允许一项操作；不同对话共享同一个队列。 */
export class GitRepository {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly nativeAvailable: Promise<boolean>
  constructor(private readonly root: string, private readonly executable: string = 'git', private readonly confine: ConfineGit | undefined = undefined) { this.nativeAvailable = detectGit(executable) }

  async execute(input: unknown, policy: SandboxExecutionPolicy | undefined, signal: AbortSignal): Promise<GitResult> {
    const request = gitRequestSchema.parse(input)
    const task = this.pending.then(() => this.run(request, policy, signal))
    this.pending = task.catch(() => undefined)
    return task
  }

  private async run(request: GitRequest, policy: SandboxExecutionPolicy | undefined, signal: AbortSignal): Promise<GitResult> {
    signal.throwIfAborted()
    const root = await native.realpath(this.root)
    if (policy?.mode === 'workspace-write') policy = { ...policy, workspaceRoot: await native.realpath(policy.workspaceRoot) }
    const options = { fs: gitFileSystem(root, policy, signal), dir: root }
    const writable = !policy || policy.mode === 'danger-full-access' || policy.mode === 'workspace-write' && containsPath(policy.workspaceRoot, root)
    const engine = await this.nativeAvailable ? new NativeGit(root, this.executable, signal, policy, this.confine) : null
    const read = () => engine ? engine.snapshot(writable) : snapshot(options, writable)
    const state = await read()
    if (request.action === 'status') return { kind: 'state', state }
    if (request.action === 'init') {
      if (state.exists) throw new Error('WORKBENCH_GIT_EXISTS')
      if (!writable) throw new Error('WORKBENCH_GIT_READONLY')
      if (engine) await engine.mutate(request, state)
      else await git.init({ ...options, defaultBranch: request.branch })
      return { kind: 'state', state: await read() }
    }
    if (!state.exists) throw new Error('WORKBENCH_GIT_MISSING')
    if (request.version !== state.version) throw new Error('WORKBENCH_GIT_STALE')
    if (request.action === 'diff') {
      const file = state.changes.find(file => file.path === request.path)
      if (!file) throw new Error('WORKBENCH_GIT_STALE')
      return { kind: 'diff', diff: engine ? await engine.diff(request.path, request.side, state) : await repositoryDiff({ ...options, head: state.head }, request.path, request.side, file.conflict) }
    }
    if (request.action === 'commitFiles' || request.action === 'historyDiff') {
      if (!state.history.some(item => item.oid === request.oid)) throw new Error('WORKBENCH_GIT_STALE')
      const files = engine ? await engine.commitFiles(request.oid) : await commitFiles(options, request.oid)
      if (request.action === 'commitFiles') return { kind: 'commitFiles', oid: request.oid, files }
      if (!files.includes(request.path)) throw new Error('WORKBENCH_GIT_PATH')
      return { kind: 'diff', diff: engine ? await engine.commitDiff(request.oid, request.path) : await commitDiff(options, request.oid, request.path) }
    }
    if (!state.writable) throw new Error('WORKBENCH_GIT_READONLY')
    if ('paths' in request && request.paths.some(path => !state.changes.some(file => file.path === path))) throw new Error('WORKBENCH_GIT_STALE')
    if (engine) { await engine.mutate(request, state); return { kind: 'state', state: await read() } }
    // Native Git 同样尊重 index.lock，避免覆盖其他进程正在写入的暂存区。
    const lockPath = join(root, '.git/index.lock')
    const lock = await native.open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => { if (error.code === 'EEXIST') throw new Error('WORKBENCH_GIT_BUSY'); throw error })
    const identity = await lock.stat()
    try {
      if ((await snapshot(options, state.writable)).version !== state.version) throw new Error('WORKBENCH_GIT_STALE')
      await this.mutate(request, options, state, signal)
    } finally {
      await lock.close()
      const current = await native.lstat(lockPath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      if (current?.dev === identity.dev && current.ino === identity.ino) await native.unlink(lockPath)
    }
    return { kind: 'state', state: await snapshot(options, state.writable) }
  }

  private async mutate(request: Exclude<GitRequest, { action: 'status' | 'diff' | 'init' | 'commitFiles' | 'historyDiff' }>, options: Options, state: GitState, signal: AbortSignal): Promise<void> {
    switch (request.action) {
      case 'stage': {
        for (const path of request.paths) {
          const file = state.changes.find(file => file.path === path)!
          if (file.worktree === 0) await git.remove({ ...options, filepath: path })
          else await git.add({ ...options, filepath: path })
        }
        return
      }
      case 'unstage':
        for (const path of request.paths) {
          if (state.head) await git.resetIndex({ ...options, filepath: path })
          else await git.remove({ ...options, filepath: path })
        }
        return
      case 'commit': {
        if (!state.merging && !state.changes.some(file => file.head !== file.stage)) throw new Error('WORKBENCH_GIT_EMPTY_COMMIT')
        if (state.changes.some(file => file.conflict)) throw new Error('WORKBENCH_GIT_CONFLICT')
        const parent = state.merging ? [state.head!, (await mergeHead(options))!] : undefined
        await git.commit({ ...options, message: request.message, author: request.author, parent })
        if (state.merging) await clearMerge(options)
        return
      }
      case 'branch':
        if (!state.head) throw new Error('WORKBENCH_GIT_NO_HEAD')
        await git.branch({ ...options, ref: request.branch }); return
      case 'deleteBranch': {
        if (request.branch === state.branch || !state.head) throw new Error('WORKBENCH_GIT_BRANCH')
        const ancestor = await git.resolveRef({ ...options, ref: `refs/heads/${request.branch}` })
        if (state.head !== ancestor && !await git.isDescendent({ ...options, oid: state.head, ancestor })) throw new Error('WORKBENCH_GIT_BRANCH_UNMERGED')
        await git.deleteBranch({ ...options, ref: request.branch }); return
      }
      case 'merge':
        await mergeBranch(options, state, request.branch, request.author); return
      case 'abortMerge': await abortMerge(options, state); return
      case 'checkout':
        if (state.changes.length || state.merging) throw new Error('WORKBENCH_GIT_DIRTY')
        if (!state.branches.includes(request.branch)) throw new Error('WORKBENCH_GIT_BRANCH')
        await git.checkout({ ...options, ref: request.branch }); return
      case 'remote':
        await git.addRemote({ ...options, remote: request.remote, url: remoteUrl(request.url), force: true }); return
      case 'fetch': case 'pull': case 'push': {
        const item = state.remotes.find(item => item.remote === request.remote)
        if (!item?.url) throw new Error('WORKBENCH_GIT_URL')
        if ((request.action === 'pull' || request.action === 'push') && !state.branch) throw new Error('WORKBENCH_GIT_BRANCH')
        if (request.action === 'pull' && (state.changes.length || state.merging)) throw new Error('WORKBENCH_GIT_DIRTY')
        const network = { ...options, remote: request.remote, url: item.url,
          http: { request: (input: Parameters<typeof http.request>[0]) => http.request({ ...input, signal, fetchOptions: { ...input.fetchOptions, maxRedirects: 0 } }) },
          onAuth: () => request.auth || { cancel: true }, onAuthFailure: () => ({ cancel: true as const }),
        }
        try {
          if (request.action === 'push') await git.push({ ...network, ref: state.branch!, force: false })
          else if (request.action === 'pull') {
            if (state.head) await git.fastForward({ ...network, ref: state.branch! })
            else {
              await git.fetch({ ...network, ref: state.branch! })
              await git.checkout({ ...options, ref: state.branch!, remote: request.remote })
            }
          }
          else await git.fetch(network)
        } catch (error) {
          signal.throwIfAborted()
          // 上游网络错误可能包含地址或认证值；只向前端返回稳定分类。
          if (error instanceof git.Errors.FastForwardError) throw new Error('WORKBENCH_GIT_DIVERGED')
          if (error instanceof git.Errors.UserCanceledError || error instanceof git.Errors.HttpError && [401, 403].includes(error.data.statusCode)) throw new Error('WORKBENCH_GIT_AUTH')
          if (error instanceof git.Errors.PushRejectedError) throw new Error('WORKBENCH_GIT_PUSH_REJECTED')
          throw new Error('WORKBENCH_GIT_NETWORK')
        }
        return
      }
    }
  }
}
