import { join } from 'node:path'
import type { PromiseFsClient } from 'isomorphic-git'
import { library } from './library.js'
import { MAX_FILE_BYTES } from '../files.js'
import { builtinHistory } from './history-reader.js'
import { mergeHead } from './merge.js'
import type { GitConflict, GitState } from './request.js'

type Options = { fs: PromiseFsClient; dir: string; cache: object }

export function fileText(bytes: Uint8Array, mode = 0o100644): string {
  if ((mode & 0o170000) !== 0o100000) throw new Error('WORKBENCH_GIT_TEXT_FILE')
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
  let text: string
  try { text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('WORKBENCH_GIT_TEXT_FILE') }
  if (text.includes('\0')) throw new Error('WORKBENCH_GIT_TEXT_FILE')
  return text
}

export async function workingText(options: Options, path: string): Promise<{ text: string | null; mode: number }> {
  const full = join(options.dir, path)
  const info = await options.fs.promises.lstat(full).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  if (!info) return { text: null, mode: 0o100644 }
  if (!info.isFile()) throw new Error('WORKBENCH_GIT_TEXT_FILE')
  if (info.size > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
  return { text: fileText(await options.fs.promises.readFile(full)), mode: info.mode }
}

export async function repositoryMode(options: Options, path: string, head: string | null): Promise<number> {
  const trees = [library.git.STAGE(), ...(head ? [library.git.TREE({ ref: head })] : [])]
  const modes: number[] = await library.git.walk({ ...options, trees, map: async (file, entries) => {
    if (file !== path) return file === '.' || path.startsWith(file + '/') ? undefined : null
    const values = await Promise.all(entries.map(async entry => entry ? entry.mode() : null))
    if (values.some(mode => mode !== null && (mode & 0o170000) !== 0o100000)) throw new Error('WORKBENCH_GIT_TEXT_FILE')
    return values.find(mode => mode !== null) ?? 0o100644
  } })
  return modes[0] ?? 0o100644
}

export async function builtinConflict(options: Options, state: GitState, path: string): Promise<GitConflict> {
  if (!state.changes.some(file => file.path === path && file.conflict)) throw new Error('WORKBENCH_GIT_STALE')
  const theirs = await mergeHead(options)
  if (!state.head || !theirs) throw new Error('WORKBENCH_GIT_MERGE_UNSUPPORTED')
  const reader = builtinHistory(options)
  const read = async (oid: string) => {
    const entry = await reader.file(oid, path)
    return entry ? fileText(await entry.content(), entry.mode) : null
  }
  const [ours, incoming, result] = await Promise.all([read(state.head), read(theirs), workingText(options, path)])
  return { path, ours, theirs: incoming, result: result.text, version: state.version }
}

export async function writeWorkingText(options: Options, path: string, text: string | null, mode: number): Promise<void> {
  const previous = await workingText(options, path), full = join(options.dir, path)
  if (text === null) { if (previous.text !== null) await options.fs.promises.unlink(full); return }
  const folders = path.split('/').slice(0, -1)
  for (let i = 1; i <= folders.length; i++) await options.fs.promises.mkdir(join(options.dir, ...folders.slice(0, i))).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  await options.fs.promises.writeFile(full, text, { encoding: 'utf8', mode: mode & 0o777 })
}

export async function stageText(options: Options, path: string, text: string | null, mode: number): Promise<void> {
  if (text === null) { await library.git.updateIndex({ ...options, filepath: path, force: true, remove: true }); return }
  const oid = await library.git.writeBlob({ ...options, blob: Buffer.from(text) })
  await library.git.updateIndex({ ...options, filepath: path, oid, mode, add: true })
}

/** 固定路径的完整文本补丁，由 Git 自身检查旧内容并在沙箱内落盘。 */
export function filePatch(path: string, before: string | null, after: string | null, mode: number): string {
  if (before === after) return ''
  const quote = (value: string) => '"' + [...Buffer.from(value)].map(byte => byte === 34 || byte === 92 ? '\\' + String.fromCharCode(byte) : byte < 32 || byte >= 127 ? '\\' + byte.toString(8).padStart(3, '0') : String.fromCharCode(byte)).join('') + '"'
  const left = quote('a/' + path), right = quote('b/' + path)
  const lines = (text: string | null) => text?.match(/[^\n]*\n|[^\n]+$/g) || []
  const oldLines = lines(before), newLines = lines(after)
  let patch = `diff --git ${left} ${right}\n`
  if (before === null) patch += `new file mode ${(mode & 0o111 ? 0o100755 : 0o100644).toString(8)}\n`
  if (after === null) patch += `deleted file mode ${(mode & 0o111 ? 0o100755 : 0o100644).toString(8)}\n`
  if (!oldLines.length && !newLines.length) return patch
  patch += `--- ${before === null ? '/dev/null' : left}\n+++ ${after === null ? '/dev/null' : right}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n`
  for (const [prefix, values] of [['-', oldLines], ['+', newLines]] as const) for (const line of values) patch += prefix + line + (line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n')
  return patch
}
