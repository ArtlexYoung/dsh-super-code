import { join } from 'node:path'
import type { PromiseFsClient } from 'isomorphic-git'
import { library } from './library.js'
import type { GitState } from './request.js'

type Options = { fs: PromiseFsClient; dir: string }
const { git } = library

export async function mergeHead(options: Options): Promise<string | null> {
  try {
    const value = String(await options.fs.promises.readFile(join(options.dir, '.git/MERGE_HEAD'), 'utf8')).trim()
    if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('WORKBENCH_GIT_MERGE_UNSUPPORTED')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/** 用上游的只读提交检查识别未合并索引，避免另外实现 Git 索引格式。 */
export async function conflictPaths(options: Options): Promise<string[]> {
  try {
    await git.commit({ ...options, dryRun: true, noUpdateBranch: true, message: 'Check merge', author: { name: 'Git', email: 'git@localhost' } })
    return []
  } catch (error) { if (error instanceof git.Errors.UnmergedPathsError) return error.data.filepaths; throw error }
}

export async function clearMerge(options: Options): Promise<void> {
  for (const name of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE']) {
    await options.fs.promises.unlink(join(options.dir, '.git', name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function mergeBranch(options: Options, state: GitState, branch: string, author: { name: string; email: string }): Promise<void> {
  if (state.changes.length || state.merging) throw new Error('WORKBENCH_GIT_DIRTY')
  if (!state.branch || !state.head || ![...state.branches, ...state.remoteBranches].includes(branch)) throw new Error('WORKBENCH_GIT_BRANCH')
  const theirs = await git.resolveRef({ ...options, ref: state.branches.includes(branch) ? `refs/heads/${branch}` : `refs/remotes/${branch}` })
  const parameters = { ...options, ours: state.head, theirs, author, noUpdateBranch: true }
  // 先确认该合并类型受支持；不支持的树形冲突不能留下半写入的索引。
  try { await git.merge({ ...parameters, dryRun: true }) }
  catch (error) { if (!(error instanceof git.Errors.MergeConflictError)) throw new Error('WORKBENCH_GIT_MERGE_UNSUPPORTED') }
  await options.fs.promises.writeFile(join(options.dir, '.git/ORIG_HEAD'), `${state.head}\n`)
  await options.fs.promises.writeFile(join(options.dir, '.git/MERGE_HEAD'), `${theirs}\n`)
  await options.fs.promises.writeFile(join(options.dir, '.git/MERGE_MSG'), `Merge branch '${branch}' into ${state.branch}\n`)
  try {
    const result = await git.merge({ ...parameters, abortOnConflict: false })
    if (!result.oid) throw new Error('WORKBENCH_GIT_MERGE_UNSUPPORTED')
    await git.checkout({ ...options, ref: result.oid, noUpdateHead: true, force: true })
    await git.writeRef({ ...options, ref: `refs/heads/${state.branch}`, value: result.oid, force: true })
    await clearMerge(options)
  } catch (error) { if (!(error instanceof git.Errors.MergeConflictError)) throw error }
}

export async function abortMerge(options: Options, state: GitState): Promise<void> {
  if (!state.merging || !state.head) throw new Error('WORKBENCH_GIT_NO_MERGE')
  // 合并只允许从干净状态开始；用户确认取消后丢弃合并和解决冲突的改动。
  await git.checkout({ ...options, ref: state.head, noUpdateHead: true, force: true })
  await clearMerge(options)
}
