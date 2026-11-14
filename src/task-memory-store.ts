import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainTableSpec, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { taskMemoryEventOf, taskMemoryToolResultOf } from './task-memory-projection.js'
import { emptyTaskMemory, foldTaskMemory, taskMemoryContext, taskMemoryEventSchema } from './core/task-memory.js'
import type { TaskMemoryEvent, TaskMemoryState } from './core/task-memory.js'
import { recordedToolResult } from './core/host-messages.js'

type MemoryChange = TaskMemoryEvent | { kind: 'unchanged'; id: string; revision: number }
export interface MemoryReceipt { id: string; revision?: number; recordId?: string; unchanged?: true }
export interface MemorySnapshot { state: TaskMemoryState; end: number; recordCount: number }
export interface TaskRecord { recordId: string; sourceEnd: number; change: TaskMemoryEvent }
export interface StoredTaskRecord extends TaskRecord { sessionId: string; callId: string; index: number }
const storedRecordSchema: z.ZodType<StoredTaskRecord> = z.object({
  recordId: z.uuid(), sessionId: z.string().min(1), callId: z.string().min(1), index: z.number().int().nonnegative(),
  sourceEnd: z.number().int().nonnegative(), change: taskMemoryEventSchema,
}).strict()
export const taskMemoryDomainSpec: { readonly name: string; readonly version: number; readonly layout: 'per-record';
  readonly tables: { readonly records: DomainTableSpec<string, StoredTaskRecord> } } = defineDomain({
  name: 'super_code_tasks', version: 1, layout: 'per-record',
  tables: { records: domainTable<string, StoredTaskRecord>(storedRecordSchema) },
})
interface SessionMemory {
  state: TaskMemoryState; cursor: number; ownCursor: number; records: TaskRecord[]; indices: Map<string, number>; calls: Set<string>
}

/** 独立任务日志是唯一写入来源；会话工具回执只引用记录。 */
export class TaskMemoryStore {
  private readonly pending = new Map<string, StoredTaskRecord>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly own = new Map<string, StoredTaskRecord[]>()
  private readonly cache = new WeakMap<Session, SessionMemory>()

  constructor(private readonly ctx: Context, private readonly table: KvTable<string, StoredTaskRecord>) {
    for (const [key, record] of table.entries()) {
      if (key !== record.recordId) throw new Error('Task record identity does not match its storage key')
      const rows = this.own.get(record.sessionId) ?? []
      rows.push(record); this.own.set(record.sessionId, rows)
    }
    for (const rows of this.own.values()) {
      rows.sort((a, b) => a.index - b.index)
      if (rows.some((row, index) => row.index !== index)) throw new Error('Task record sequence is incomplete')
    }
  }

  isPending(session: Session): boolean { return this.pending.has(session.id) }

  private sessionMemory(session: Session): SessionMemory {
    let value = this.cache.get(session)
    if (!value) {
      value = { state: emptyTaskMemory(), cursor: 0, ownCursor: 0, records: [], indices: new Map(), calls: new Set() }
      this.cache.set(session, value)
    }
    const add = (record: TaskRecord) => {
      if (value.indices.has(record.recordId)) return
      value.state = foldTaskMemory(value.state, record.change)
      value.indices.set(record.recordId, value.records.length); value.records.push(record)
    }
    const own = this.own.get(session.id) ?? []
    const addOwn = () => {
      // 已确认的写入即使没有成功回执，也按保存时的会话位置恢复，不能在后续更新之后回放。
      while (value.ownCursor < own.length && own[value.ownCursor]!.sourceEnd <= value.cursor) add(own[value.ownCursor++]!)
    }
    while (value.cursor < session.seq) {
      addOwn()
      const event = session.eventAt(SessionSeq(value.cursor))!
      const legacy = taskMemoryEventOf(event)
      if (legacy.kind === 'record') add({ recordId: `event:${event.seq}`, sourceEnd: event.seq + 1, change: legacy.record })
      if (event.type === 'tool/call' && event.data.name === 'super_code_task') value.calls.add(event.data.callId)
      const receipt = taskMemoryToolResultOf(event, value.calls)
      const result = event.type === 'tool/result' ? recordedToolResult(event.data.message) : undefined
      if (result?.kind === 'record') value.calls.delete(result.callId)
      if (receipt?.recordId) {
        const record = this.table.get(receipt.recordId)
        const inherited = event.seq < session.inheritedEventCount && session.header.isSeeded
        if (record && record.callId === receipt.callId && (record.sessionId === session.id || inherited)) add(record)
        else throw new Error(`Task record ${receipt.recordId} is missing or does not match its tool result`)
      }
      if (event.type === 'user/message' && event.data.source.kind === 'user') {
        value.state = { ...value.state, recentSources: [...value.state.recentSources.slice(-7), event.seq] }
      }
      value.cursor++
    }
    addOwn()
    return value
  }

  current(session: Session): TaskMemoryState { return this.sessionMemory(session).state }

  private async checkpoint(session: Session): Promise<void> {
    const record = this.pending.get(session.id)!
    await this.table.put(record.recordId, record)
    const rows = this.own.get(session.id) ?? []
    rows.push(record); this.own.set(session.id, rows)
    this.pending.delete(session.id)
  }

  private async access<T>(session: Session, signal: AbortSignal, run: () => T | Promise<T>): Promise<T> {
    const previous = this.locks.get(session.id) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      signal.throwIfAborted()
      if (this.pending.has(session.id)) await this.checkpoint(session)
      signal.throwIfAborted()
      return run()
    })
    this.locks.set(session.id, operation)
    try { return await operation }
    finally { if (this.locks.get(session.id) === operation) this.locks.delete(session.id) }
  }

  read(session: Session, signal: AbortSignal): Promise<MemorySnapshot> {
    return this.access(session, signal, () => {
      const value = this.sessionMemory(session)
      return { state: value.state, end: session.seq, recordCount: value.records.length }
    })
  }

  history(session: Session, recordId: string): TaskRecord {
    const value = this.sessionMemory(session), index = value.indices.get(recordId)
    if (index === undefined) throw new Error('Unknown task record in this session')
    return value.records[index]!
  }

  async archives(session: Session, signal: AbortSignal, taskId?: string, before?: string): Promise<{
    records: { recordId: string; id: string; title: string; status: string }[]; nextBeforeRecordId?: string; done: boolean; scanned: number
  }> {
    const { recordCount } = await this.read(session, signal), value = this.sessionMemory(session)
    let cursor = before === undefined ? recordCount : value.indices.get(before)
    if (cursor === undefined || cursor > recordCount) throw new Error('Invalid task archive cursor')
    const records: { recordId: string; id: string; title: string; status: string }[] = []
    let scanned = 0
    while (cursor > 0 && scanned < 4096 && records.length < 10) {
      if (scanned > 0 && scanned % 256 === 0) await new Promise<void>(resolve => setImmediate(resolve))
      signal.throwIfAborted()
      const row = value.records[--cursor]!; scanned++
      if (row.change.kind !== 'archive' || taskId !== undefined && row.change.task.id !== taskId) continue
      const { id, title, status } = row.change.task
      records.push({ recordId: row.recordId, id, title, status })
    }
    signal.throwIfAborted()
    return { records, ...(cursor > 0 ? { nextBeforeRecordId: value.records[cursor]!.recordId } : {}), done: cursor === 0, scanned }
  }

  write(session: Session, signal: AbortSignal, decide: (state: TaskMemoryState) => MemoryChange,
    options: { maxContextBytes: number; callId: string }): Promise<MemoryReceipt> {
    return this.access(session, signal, async () => {
      const change = decide(this.current(session))
      if (change.kind === 'unchanged') return { id: change.id, revision: change.revision, unchanged: true }
      const next = foldTaskMemory(this.current(session), change)
      const preview = { ...next, recentSources: Array<number>(8).fill(Number.MAX_SAFE_INTEGER) }
      taskMemoryContext(preview, options.maxContextBytes)
      for (const id of Object.keys(next.tasks)) taskMemoryContext({ ...preview, focus: { kind: 'task', id } }, options.maxContextBytes)
      signal.throwIfAborted()
      // 先确认需求来源已保存，崩溃恢复时任务不能引用不存在的用户消息。
      if (!await this.ctx.sessions.flush(session)) throw new Error('No host persistence checkpoint is configured; task sources are not durable')
      signal.throwIfAborted()
      const record: StoredTaskRecord = { recordId: randomUUID(), sessionId: session.id, callId: options.callId,
        index: this.own.get(session.id)?.length ?? 0, sourceEnd: session.seq, change }
      this.pending.set(session.id, record)
      try { await this.checkpoint(session) }
      catch (cause) {
        throw new Error(`Task record ${record.recordId} persistence is unconfirmed. Use super_code_task list or read to confirm persistence; do not repeat the write.`, { cause })
      }
      return { recordId: record.recordId, ...(change.kind === 'focus' ? { id: change.id } : { id: change.task.id, revision: change.task.revision }) }
    })
  }
}
