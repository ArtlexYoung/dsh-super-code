import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TASK_MEMORY_SOURCE } from './task-memory-projection.js'
import { foldTaskMemory, taskMemoryContext } from './core/task-memory.js'
import type { TaskMemoryEvent, TaskMemoryState } from './core/task-memory.js'

type MemoryChange = TaskMemoryEvent | { kind: 'unchanged'; id: string; revision: number }
export interface MemoryReceipt { id: string; revision?: number; eventSeq?: number; unchanged?: true }
export interface MemorySnapshot { state: TaskMemoryState; end: number }

/** One session write barrier, including recovery of an unconfirmed checkpoint. */
export class TaskMemoryStore {
  private readonly pending = new WeakSet<Session>()
  private readonly locks = new WeakMap<Session, Promise<unknown>>()

  constructor(private readonly ctx: Context, private readonly maxContextBytes: number) {}

  isPending(session: Session): boolean { return this.pending.has(session) }

  current(session: Session): TaskMemoryState {
    const state = this.ctx.sessionProjections.stateOf(session, 'superCodeTasks')
    if (state === undefined) throw new Error('super-code task projection is unavailable')
    return state
  }

  private async checkpoint(session: Session): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) throw new Error('No host persistence checkpoint is configured; task memory is not durable')
    this.pending.delete(session)
  }

  private async access<T>(session: Session, signal: AbortSignal, run: () => T | Promise<T>): Promise<T> {
    const previous = this.locks.get(session) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      signal.throwIfAborted()
      if (this.pending.has(session)) await this.checkpoint(session)
      signal.throwIfAborted()
      return run()
    })
    this.locks.set(session, operation)
    try { return await operation }
    finally { if (this.locks.get(session) === operation) this.locks.delete(session) }
  }

  /** Capture a confirmed immutable view; callers perform scans outside the barrier. */
  read(session: Session, signal: AbortSignal): Promise<MemorySnapshot> {
    return this.access(session, signal, () => ({ state: this.current(session), end: session.seq }))
  }

  write(session: Session, signal: AbortSignal, decide: (state: TaskMemoryState) => MemoryChange): Promise<MemoryReceipt> {
    return this.access(session, signal, async () => {
      const state = this.current(session)
      const change = decide(state)
      if (change.kind === 'unchanged') return { id: change.id, revision: change.revision, unchanged: true }
      const next = foldTaskMemory(state, change)
      // Every possible focus must fit, including room for future source identities.
      const preview = { ...next, recentSources: Array<number>(8).fill(Number.MAX_SAFE_INTEGER) }
      taskMemoryContext(preview, this.maxContextBytes)
      for (const id of Object.keys(next.tasks)) taskMemoryContext({ ...preview, focus: { kind: 'task', id } }, this.maxContextBytes)
      signal.throwIfAborted()
      const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: JSON.stringify(change) }],
        source: { kind: 'plugin', plugin: TASK_MEMORY_SOURCE } }), { surfaceOp: 'append' })
      this.pending.add(session)
      await this.checkpoint(session)
      return { eventSeq: event.seq, ...(change.kind === 'focus' ? { id: change.id } : { id: change.task.id, revision: change.task.revision }) }
    })
  }
}
