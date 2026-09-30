/** User-facing, read-only memory API. Workspace identity comes from the host. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LongMemoryStore, memoryWorkspace, memoryGlobalNamespace, GLOBAL_PREFERENCES_TOPIC } from '../long-memory.js'
import type { LongMemoryEntry } from '../long-memory.js'
import { z } from 'zod'

export interface MemoryLibraryItem {
  topic: string; revision: number; id: string; summary: string; kind: LongMemoryEntry['kind']
}
export type MemoryLibraryDetail = { kind: 'missing' } | { kind: 'found'; entry: MemoryLibraryItem & {
  detail: string; source: { kind: 'user' | 'tool'; sessionId: string; eventSeq: number }; sourceVersion?: string
} }

export class MemoryLibraryReader {
  constructor(private readonly ctx: Context, private readonly store: LongMemoryStore) {}

  private async workspace(sessionId: string, scope: string): Promise<string> {
    z.enum(['project', 'global']).parse(scope)
    const id = SessionId(z.string().min(1).max(256).parse(sessionId))
    const session = this.ctx.sessions.get(id)
    // Archived conversations need only trusted metadata, not replay or an Agent.
    const persistence = this.ctx.get('sessionPersistence') as { stat(id: string): Promise<{ header: { cwd?: string } } | undefined> } | undefined
    const header = session?.header ?? (await persistence?.stat(id))?.header
    if (!header) throw new Error('Select an existing conversation to view its memory')
    return scope === 'global' ? memoryGlobalNamespace() : memoryWorkspace({ header })
  }

  async list(sessionId: string, scope: string): Promise<{ items: MemoryLibraryItem[] }> {
    const workspace = await this.workspace(sessionId, scope)
    const topics = this.store.topics(workspace).filter(row => scope !== 'global' || row.topic === GLOBAL_PREFERENCES_TOPIC)
    return { items: topics.flatMap(({ topic }) => {
      const found = this.store.read(workspace, topic)
      if (found.kind === 'missing') return []
      return found.value.entries.map(({ id, summary, kind }) => ({ topic, revision: found.value.revision, id, summary, kind }))
    }) }
  }

  async read(sessionId: string, scope: string, topic: string, id: string): Promise<MemoryLibraryDetail> {
    const workspace = await this.workspace(sessionId, scope)
    if (scope === 'global' && topic !== GLOBAL_PREFERENCES_TOPIC) throw new Error('Invalid global topic')
    const found = this.store.read(workspace, topic)
    if (found.kind === 'missing') return { kind: 'missing' }
    const entry = found.value.entries.find(item => item.id === id)
    if (!entry) return { kind: 'missing' }
    return { kind: 'found', entry: { topic, revision: found.value.revision, id, kind: entry.kind, summary: entry.summary,
      detail: entry.detail, ...(entry.sourceVersion ? { sourceVersion: entry.sourceVersion } : {}),
      source: { kind: entry.source.kind, sessionId: entry.source.sessionId, eventSeq: entry.source.eventSeq } } }
  }
}

export class SuperCodeMemory extends TypertRemoteService {
  private readonly reader: MemoryLibraryReader
  constructor(ctx: Context, store: LongMemoryStore) {
    super(ctx, 'superCodeMemory')
    this.reader = new MemoryLibraryReader(ctx, store)
  }
  @Remote
  list(sessionId: string, scope: string): Promise<{ items: MemoryLibraryItem[] }> { return this.reader.list(sessionId, scope) }
  @Remote
  read(sessionId: string, scope: string, topic: string, id: string): Promise<MemoryLibraryDetail> { return this.reader.read(sessionId, scope, topic, id) }
}
