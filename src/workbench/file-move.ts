import { lstat, link, unlink } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'

export function sameFileContent(before: BigIntStats, after: BigIntStats): boolean {
  const fields: ('dev' | 'ino' | 'size' | 'mtimeNs' | 'mode')[] = ['dev', 'ino', 'size', 'mtimeNs', 'mode']
  return fields.every(field => before[field] === after[field])
}

/** 独占创建目标目录项；普通文件不复制正文，已有目标永远不被覆盖。 */
export async function moveFile(source: string, destination: string, signal: AbortSignal, before: BigIntStats): Promise<void> {
  if (before.isSymbolicLink()) throw new Error('WORKBENCH_FILE_LINK')
  if (!before.isFile()) throw new Error('WORKBENCH_MOVE_FILE')
  signal.throwIfAborted()
  try { await link(source, destination) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EXDEV') throw new Error('WORKBENCH_MOVE_DEVICE', { cause: error })
    throw error
  }
  try {
    const current = await lstat(source, { bigint: true }), target = await lstat(destination, { bigint: true })
    if (![current, target].every(info => sameFileContent(before, info))) throw new Error('WORKBENCH_CONFLICT')
    // 创建目标后完成本次移动，不在两个目录项之间响应取消。
    await unlink(source)
  } catch (error) { throw new Error('WORKBENCH_MOVE_PARTIAL', { cause: error }) }
}
