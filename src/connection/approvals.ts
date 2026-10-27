/** Ephemeral, exact-call decisions. The host approval service owns the durable audit. */
import { randomUUID } from 'node:crypto'
import { ConnectionError } from './types.js'
import type { CallerApproval, CallerApprovalDecision } from './types.js'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export type ApprovalAnswer = ApprovalOutcome | 'host';
interface Pending { view: CallerApproval; settle(answer: ApprovalAnswer): void }
export class CallerApprovals {
  private readonly requests = new Map<string, Pending>()
  private readonly settled = new Map<string, { taskId: string; decision: CallerApprovalDecision }>()
  private readonly presenting = new Set<string>()
  constructor(private readonly now: () => number = Date.now) {}
  async request(input: Omit<CallerApproval, 'id' | 'createdAt' | 'expiresAt'>, signal?: AbortSignal): Promise<ApprovalAnswer> {
    if (signal?.aborted) return 'cancelled'
    if (this.requests.size >= 32 || input.arguments.length > 16000 || input.reason.length > 8000 || input.toolName.length > 256) return 'host'
    const createdAt = this.now(), view: CallerApproval = { ...input, id: randomUUID(), createdAt, expiresAt: createdAt + 5 * 60 * 1000 }
    return new Promise<ApprovalAnswer>(resolve => {
      const timer = setTimeout(() => settle('host'), 5 * 60 * 1000)
      timer.unref()
      const abort = (): void => settle('cancelled')
      const settle = (answer: ApprovalAnswer): void => {
        if (!this.requests.delete(view.id)) return
        this.presenting.delete(view.id)
        clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(answer)
      }
      this.requests.set(view.id, { view, settle })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  private expire(): void {
    for (const row of this.requests.values()) if (row.view.expiresAt <= this.now()) row.settle('host')
  }
  pending(taskId: string): CallerApproval[] {
    this.expire()
    return [...this.requests.values()].filter(row => row.view.taskId === taskId).map(row => ({ ...row.view }))
  }
  present(taskId: string, id: string): boolean {
    this.expire()
    if (this.requests.get(id)?.view.taskId !== taskId || this.presenting.has(id)) return false
    this.presenting.add(id)
    return true
  }
  defer(taskId: string, id: string): void {
    const row = this.requests.get(id)
    if (row?.view.taskId === taskId) row.settle('host')
  }
  decide(taskId: string, id: string, decision: CallerApprovalDecision): { outcome: ApprovalOutcome; repeated: boolean } {
    this.expire()
    const prior = this.settled.get(id)
    if (prior) {
      if (prior.taskId !== taskId) throw new ConnectionError('approval-not-found')
      if (prior.decision !== decision) throw new ConnectionError('approval-conflict')
      return { outcome: decision === 'approve' ? 'allowed-once' : 'rejected', repeated: true }
    }
    const row = this.requests.get(id)
    if (!row || row.view.taskId !== taskId) throw new ConnectionError('approval-not-found')
    this.settled.set(id, { taskId, decision })
    if (this.settled.size > 200) this.settled.delete(this.settled.keys().next().value!)
    const outcome = decision === 'approve' ? 'allowed-once' : 'rejected'
    row.settle(outcome)
    return { outcome, repeated: false }
  }
  withdraw(taskId?: string, answer: ApprovalAnswer = 'host'): void {
    for (const row of this.requests.values()) if (!taskId || row.view.taskId === taskId) row.settle(answer)
  }
}
