import * as fs from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { PromiseFsClient } from 'isomorphic-git'

export function containsPath(root: string, target: string): boolean {
  const part = relative(root, target)
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** Git 需要二进制写入；所有文件操作集中在这里限制路径、取消与只读策略。 */
export function gitFileSystem(root: string, policy: SandboxExecutionPolicy | undefined, signal: AbortSignal): PromiseFsClient {
  async function check(value: string, write = false, link = false): Promise<string> {
    signal.throwIfAborted()
    const target = resolve(value)
    if (!containsPath(root, target)) throw new Error('WORKBENCH_GIT_PATH')
    if (write && policy?.mode === 'read-only') throw new Error('WORKBENCH_GIT_READONLY')
    let existing = link && target !== root ? dirname(target) : target
    while (true) {
      try { existing = await fs.realpath(existing); break }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
        const parent = dirname(existing)
        if (parent === existing) throw error
        existing = parent
      }
    }
    if (!containsPath(root, existing)) throw new Error('WORKBENCH_GIT_PATH')
    if (write && policy?.mode === 'workspace-write' && !containsPath(policy.workspaceRoot, existing)) throw new Error('WORKBENCH_GIT_READONLY')
    return target
  }
  return { promises: {
    readFile: async (file: string, options: Parameters<typeof fs.readFile>[1]) => fs.readFile(await check(file), options),
    writeFile: async (file: string, data: string | Uint8Array, options: Parameters<typeof fs.writeFile>[2]) => fs.writeFile(await check(file, true), data, options),
    unlink: async (file: string) => fs.unlink(await check(file, true, true)),
    readdir: async (file: string) => fs.readdir(await check(file)),
    mkdir: async (file: string) => fs.mkdir(await check(file, true)),
    rmdir: async (file: string) => fs.rmdir(await check(file, true)),
    stat: async (file: string) => fs.stat(await check(file)),
    lstat: async (file: string) => fs.lstat(await check(file, false, true)),
    readlink: async (file: string) => fs.readlink(await check(file, false, true)),
    symlink: async (target: string, file: string) => {
      const destination = await check(file, true, true)
      await check(resolve(dirname(destination), target))
      return fs.symlink(target, destination)
    },
    chmod: async (file: string, mode: number) => fs.chmod(await check(file, true), mode),
  } }
}
