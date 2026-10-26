import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ConnectionError } from './types.js'
import { withinDirectory } from './tasks.js'

export interface DirectoryApplication { requestId: string; path: string; reason: string }
export interface DirectoryRequest {
  id: string; requestId: string; path: string; reason: string; client: string; createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}
/** Pending consent is deliberately ephemeral; only an approved allowlist is persisted. */
export class DirectoryRequests {
  private readonly requests = new Map<string, DirectoryRequest>()
  private readonly sources = new Map<string, string>()
  constructor(private readonly allowed: () => string[], private readonly now: () => number = Date.now) {}
  private expire(): void {
    for (const row of this.requests.values()) {
      if (row.status === 'pending' && this.now() - row.createdAt >= 5 * 60 * 1000) row.status = 'expired'
    }
  }
  async request(input: DirectoryApplication, client: string): Promise<DirectoryRequest> {
    this.expire()
    const existing = this.requests.get(input.requestId)
    if (existing) {
      if (this.sources.get(input.requestId) !== input.path || existing.reason !== input.reason) throw new ConnectionError('request-conflict')
      return { ...existing }
    }
    if (!isAbsolute(input.path)) throw new ConnectionError('absolute-directory-required')
    let path: string
    try { path = await realpath(input.path); if (!(await stat(path)).isDirectory()) throw new Error() }
    catch { throw new ConnectionError('directory-unavailable') }
    if (this.pending().length >= 8) throw new ConnectionError('directory-request-limit')
    if (this.requests.size >= 100) {
      const oldest = [...this.requests.entries()].find(([, row]) => row.status !== 'pending')
      if (oldest) { this.requests.delete(oldest[0]); this.sources.delete(oldest[0]) }
    }
    const row: DirectoryRequest = { id: randomUUID(), ...input, path, client: client.slice(0, 80), createdAt: this.now(),
      status: this.allowed().some(parent => withinDirectory(parent, path)) ? 'approved' : 'pending' }
    this.requests.set(input.requestId, row)
    this.sources.set(input.requestId, input.path)
    return { ...row }
  }
  pending(): DirectoryRequest[] { this.expire(); return [...this.requests.values()].filter(row => row.status === 'pending').map(row => ({ ...row })) }
  async resolve(id: string, decision: 'approved' | 'rejected', grant: (path: string) => Promise<void>): Promise<{ status: DirectoryRequest['status'] }> {
    this.expire()
    const row = [...this.requests.values()].find(row => row.id === id)
    if (!row) throw new ConnectionError('directory-request-not-found')
    if (row.status !== 'pending') return { status: row.status }
    if (decision === 'approved') {
      try { if (await realpath(row.path) !== row.path || !(await stat(row.path)).isDirectory()) throw new Error() }
      catch { row.status = 'rejected'; throw new ConnectionError('directory-changed') }
      await grant(row.path)
    }
    row.status = decision
    return { status: row.status }
  }
  rejectPending(): void { for (const row of this.requests.values()) if (row.status === 'pending') row.status = 'rejected' }
}
