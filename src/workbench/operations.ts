import * as native from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { z } from 'zod'
import { pathSchema } from './files.js'
import type { WorkbenchRoot } from './files.js'
import { containsPath } from './git/filesystem.js'
import { moveToTrash } from './trash.js'

const entryPath = pathSchema.min(1).refine(path => !path.endsWith('/') && !path.includes('//'), 'WORKBENCH_PATH')
export type FileOperation = { action: 'createFile' | 'createDirectory' | 'trash'; path: string } | { action: 'copy'; path: string; destination: string } | { action: 'absolutePath'; path: string }
export const operationSchema: z.ZodType<FileOperation> = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['createFile', 'createDirectory', 'trash']), path: entryPath }).strict(),
  z.object({ action: z.literal('copy'), path: entryPath, destination: entryPath }).strict(),
  z.object({ action: z.literal('absolutePath'), path: pathSchema }).strict(),
])

async function copy(source: string, destination: string, signal: AbortSignal): Promise<void> {
  const info = await native.lstat(source)
  if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('WORKBENCH_FILE_LINK')
  if (info.isFile()) { await native.copyFile(source, destination, constants.COPYFILE_EXCL); return }
  if (containsPath(source, destination)) throw new Error('WORKBENCH_COPY_SELF')
  await native.mkdir(destination)
  try {
    for (const name of await native.readdir(source)) await native.cp(join(source, name), join(destination, name), {
      recursive: true, force: false, errorOnExist: true, filter: async path => {
        signal.throwIfAborted()
        const item = await native.lstat(path)
        if (item.isSymbolicLink() || !item.isFile() && !item.isDirectory()) throw new Error('WORKBENCH_FILE_LINK')
        return true
      },
    })
  } catch (error) { throw new Error('WORKBENCH_COPY_PARTIAL', { cause: error }) }
}

export async function operateFile(fs: FileSystem, root: WorkbenchRoot, value: unknown, signal: AbortSignal): Promise<{ path: string }> {
  const input = operationSchema.parse(value)
  signal.throwIfAborted()
  const base = await fs.resolve(root.cwd, { signal })
  const resolve = async (path: string): Promise<FsTarget> => {
    const target = path ? await fs.resolve(path, { cwd: fs.processPath(base), signal }) : base
    if (!fs.contains(base, target)) throw new Error('WORKBENCH_PATH')
    return target
  }
  const target = await resolve(input.path)
  if (input.action === 'absolutePath') return { path: fs.processPath(target) }
  const local = await native.realpath(fs.processPath(base))
  if (fs.processPathFromHostPath && fs.processPathFromHostPath(local) !== local) throw new Error('WORKBENCH_FILES_LOCAL')
  if ((input.action === 'copy' || input.action === 'trash') && (await native.lstat(join(local, input.path))).isSymbolicLink()) throw new Error('WORKBENCH_FILE_LINK')
  const writable = async (target: FsTarget): Promise<void> => {
    if (root.policy?.mode === 'read-only') throw new Error('WORKBENCH_FILES_READONLY')
    if (root.policy?.mode === 'workspace-write' && !fs.contains(await fs.resolve(root.policy.workspaceRoot, { signal }), target)) throw new Error('WORKBENCH_FILES_READONLY')
  }
  const destination = input.action === 'copy' ? await resolve(input.destination) : target
  await writable(destination)
  signal.throwIfAborted()
  try {
    const path = fs.processPath(target)
    if (input.action === 'createFile') await fs.writeText(target, '', { kind: 'createIfAbsent' }, signal, root.policy)
    else if (input.action === 'createDirectory') await native.mkdir(path)
    else if (input.action === 'copy') {
      const to = fs.processPath(destination)
      if (!containsPath(local, await native.realpath(dirname(to)))) throw new Error('WORKBENCH_PATH')
      await copy(path, to, signal)
    } else {
      const info = await native.lstat(path)
      if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('WORKBENCH_FILE_LINK')
      await moveToTrash(path, info.isDirectory(), signal)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY', 'FS_NOT_OBSERVED'].includes(String(error.code))) throw new Error('WORKBENCH_FILE_EXISTS', { cause: error })
    throw error
  }
  return { path: input.action === 'copy' ? input.destination : input.path }
}
