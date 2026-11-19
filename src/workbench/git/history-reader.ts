import type { PromiseFsClient } from 'isomorphic-git'
import { library } from './library.js'
import { MAX_FILE_BYTES } from '../files.js'

export interface HistoryCommit { oid: string; parent: string[]; message: string; author: string; timestamp: number }
export interface HistoryBlob { oid: string; mode: number; content(): Promise<Uint8Array> }
export interface HistoryReader {
  commit(oid: string): Promise<HistoryCommit | null>
  file(oid: string, path: string): Promise<HistoryBlob | null>
  deleted(parent: string, oid: string): Promise<string[]>
}

export function builtinHistory(options: { fs: PromiseFsClient; dir: string; cache: object }): HistoryReader {
  const { git } = library
  return {
    async commit(oid) {
      try {
        const { commit } = await git.readCommit({ ...options, oid })
        return { oid, parent: commit.parent, message: commit.message, author: commit.author.name, timestamp: commit.author.timestamp }
      } catch (error) { if (error instanceof git.Errors.NotFoundError) return null; throw error }
    },
    async file(oid, file) {
      const rows = await git.walk({ ...options, trees: [git.TREE({ ref: oid })], map: async (path, [entry]) => {
        if (path !== file) return path === '.' || file.startsWith(path + '/') ? undefined : null
        if (!entry || await entry.type() !== 'blob') return null
        const id = await entry.oid(), mode = await entry.mode()
        return { oid: id, mode, async content() {
          const { blob } = await git.readBlob({ ...options, oid: id })
          if (blob.byteLength > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
          return blob
        } }
      } })
      return rows[0] || null
    },
    async deleted(parent, oid) {
      return git.walk({ ...options, trees: [git.TREE({ ref: parent }), git.TREE({ ref: oid })], map: async (path, [before, after]) => {
        if (path === '.' || await before?.type() === 'tree' || await after?.type() === 'tree') return undefined
        return before && !after ? path : undefined
      } })
    },
  }
}

export async function historyText(blob: HistoryBlob): Promise<string> {
  if ((blob.mode & 0o170000) !== 0o100000) throw new Error('WORKBENCH_GIT_HISTORY_FILE')
  const bytes = await blob.content()
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('WORKBENCH_FILE_SIZE')
  let text: string
  try { text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('WORKBENCH_GIT_HISTORY_FILE') }
  if (text.includes('\0')) throw new Error('WORKBENCH_GIT_HISTORY_FILE')
  return text
}
