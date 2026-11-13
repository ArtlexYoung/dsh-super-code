import { join } from 'node:path'
import type { Hash } from 'node:crypto'
import type { Stats } from 'node:fs'
import type { GitChange } from './request.js'

const STAT_BATCH_SIZE = 32

/** 有界并发读取文件版本，保持哈希顺序，不缓存可能已变化的磁盘事实。 */
export async function updateFileVersions(hash: Hash, root: string, changes: GitChange[], read: (path: string) => Promise<Stats>, signal: AbortSignal): Promise<void> {
  for (let start = 0; start < changes.length; start += STAT_BATCH_SIZE) {
    signal.throwIfAborted()
    const versions = await Promise.all(changes.slice(start, start + STAT_BATCH_SIZE).map(async file => {
      const info = await read(join(root, file.path)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      return JSON.stringify([file, info && [info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs]])
    }))
    for (const version of versions) hash.update(version)
  }
}
