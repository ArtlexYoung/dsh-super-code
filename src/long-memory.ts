/** Small, host-home memory shared by sessions in one project or globally. */
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainTableSpec, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/)
const summary = z.string().trim().min(1).refine(value => Array.from(value).length <= 30, 'Summary exceeds 30 characters')
export interface LongMemoryEntry {
  id: string; kind: 'constraint' | 'fact' | 'experience'; summary: string; detail: string
  source: { sessionId: string; eventSeq: number; kind: 'user'; quote: string }
    | { sessionId: string; eventSeq: number; kind: 'tool'; callSeq: number }
  sourceVersion?: string
}
export const longMemoryEntrySchema: z.ZodType<LongMemoryEntry> = z.object({
  id, kind: z.enum(['constraint', 'fact', 'experience']), summary,
  detail: z.string().trim().min(1).max(1000),
  source: z.discriminatedUnion('kind', [
    z.object({ sessionId: z.string().min(1), eventSeq: z.number().int().nonnegative(), kind: z.literal('user'), quote: z.string().min(1).max(4000) }).strict(),
    z.object({ sessionId: z.string().min(1), eventSeq: z.number().int().nonnegative(), kind: z.literal('tool'), callSeq: z.number().int().nonnegative() }).strict(),
  ]),
  sourceVersion: z.string().min(1).max(4000).optional(),
}).strict().superRefine((entry, ctx) => {
  if (entry.kind === 'constraint' && entry.source.kind !== 'user') ctx.addIssue({ code: 'custom', message: 'A constraint requires a user source' })
  if (entry.kind !== 'constraint' && (entry.source.kind !== 'tool' || !entry.sourceVersion)) {
    ctx.addIssue({ code: 'custom', message: 'A fact or experience requires a tool source and version' })
  }
})

export interface LongMemoryTopic { workspace: string; topic: string; revision: number; entries: LongMemoryEntry[] }
export type LongMemoryRead = { kind: 'found'; value: LongMemoryTopic } | { kind: 'missing' }
export const longMemoryTopicSchema: z.ZodType<LongMemoryTopic> = z.object({
  workspace: z.string().length(64), topic: id, revision: z.number().int().positive(),
  entries: z.array(longMemoryEntrySchema).max(20),
}).strict()

/** One atomic record per topic; workspaces and profiles remain separate. */
export const longMemoryDomainSpec: { readonly name: string; readonly version: number; readonly layout: 'per-record';
  readonly tables: { readonly topics: DomainTableSpec<string, LongMemoryTopic> } } = defineDomain({
  name: 'super_code_memory', version: 1, layout: 'per-record',
  tables: { topics: domainTable<string, LongMemoryTopic>(longMemoryTopicSchema) },
})

/** Canonical identity of the session's current workspace, never a tool-supplied path. */
export function memoryWorkspace(session: { readonly header: { readonly cwd?: string } }): string {
  if (session.header.cwd === undefined) throw new Error('Long memory requires a session workspace')
  return createHash('sha256').update(realpathSync.native(session.header.cwd)).digest('hex')
}

/**
 * Global memory is isolated by the host's configured storage root. The
 * standard Harness bundle puts that root under DSH_HOME/storages; a constant
 * namespace here shares preferences across projects and profiles using it.
 */
export const GLOBAL_MEMORY_NAMESPACE: string = createHash('sha256').update('dsh-super-code/global/v1').digest('hex')
export const GLOBAL_PREFERENCES_TOPIC = 'preferences'

export function memoryGlobalNamespace(): string { return GLOBAL_MEMORY_NAMESPACE }

function recordKey(workspace: string, topic: string): string {
  return createHash('sha256').update(`${workspace}\0${topic}`).digest('hex')
}

/** A single host-owned writer serializes topic creation and revision checks. */
export class LongMemoryStore {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly table: KvTable<string, LongMemoryTopic>) {}

  topics(workspace: string): { topic: string; revision: number; count: number }[] {
    return [...this.table.entries()].filter(([, value]) => value.workspace === workspace)
      .map(([, value]) => ({ topic: value.topic, revision: value.revision, count: value.entries.length }))
      .sort((a, b) => a.topic.localeCompare(b.topic))
  }

  read(workspace: string, topic: string): LongMemoryRead {
    id.parse(topic)
    const record = this.table.get(recordKey(workspace, topic))
    return record?.workspace === workspace && record.topic === topic ? { kind: 'found', value: record } : { kind: 'missing' }
  }

  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.tail.catch(() => {}).then(run)
    this.tail = operation
    return operation
  }

  remember(workspace: string, topic: string, expectedRevision: number, entries: LongMemoryEntry[]): Promise<LongMemoryTopic> {
    id.parse(topic)
    const additions = z.array(longMemoryEntrySchema).min(1).max(8).parse(entries)
    if (new Set(additions.map(entry => entry.id)).size !== additions.length) throw new Error('Duplicate memory ids in one update')
    return this.mutate(async () => {
      const found = this.read(workspace, topic)
      const current = found.kind === 'found' ? found.value : undefined
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error(`Stale topic ${topic}; read revision ${current?.revision ?? 0}`)
      if (!current && this.topics(workspace).length >= 200) throw new Error('Workspace memory is full')
      const updated = new Map(current?.entries.map(entry => [entry.id, entry]) ?? [])
      for (const entry of additions) updated.set(entry.id, entry)
      const value = longMemoryTopicSchema.parse({ workspace, topic, revision: expectedRevision + 1, entries: [...updated.values()] })
      await this.table.put(recordKey(workspace, topic), value)
      return value
    })
  }

  forget(workspace: string, topic: string, expectedRevision: number, entryId: string): Promise<LongMemoryTopic> {
    id.parse(entryId)
    return this.mutate(async () => {
      const found = this.read(workspace, topic)
      if (found.kind === 'missing' || found.value.revision !== expectedRevision) throw new Error(`Stale or missing topic ${topic}`)
      const current = found.value
      if (!current.entries.some(entry => entry.id === entryId)) throw new Error(`Unknown memory ${entryId}`)
      const value = longMemoryTopicSchema.parse({ ...current, revision: current.revision + 1,
        entries: current.entries.filter(entry => entry.id !== entryId) })
      await this.table.put(recordKey(workspace, topic), value)
      return value
    })
  }
}

/** Bound context keeps the entry identity and historical status within 2 KiB. */
export function longMemoryContext(topic: LongMemoryTopic | undefined, maxBytes = 2048, currentVersion?: string): string {
  if (!topic) return ''
  const relevant = topic.entries.filter(entry => entry.source.kind === 'user' || currentVersion === undefined || entry.sourceVersion === currentVersion)
  const entries = relevant.slice(-4).map(({ id, kind, summary, sourceVersion }) => ({ id, kind, summary,
    ...(sourceVersion ? { sourceVersion } : {}) }))
  for (;;) {
    const value = JSON.stringify({ topic: topic.topic, revision: topic.revision, entries,
      omitted: relevant.length - entries.length, staleFacts: topic.entries.length - relevant.length,
      basis: 'historical; tool source pairs checked at write time, summaries not semantically verified; verify mutable facts; no permission granted',
      details: { tool: 'super_code_memory', action: 'read' } }).replace(/\{\{/g, '\\u007b\\u007b')
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
    if (entries.length === 0) throw new Error('Long-memory context exceeds its budget')
    entries.shift()
  }
}
