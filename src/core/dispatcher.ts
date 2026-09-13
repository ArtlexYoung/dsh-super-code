import { ProtocolError } from './protocol.js'
import type { TaskRecord } from './protocol.js'
import { TaskGraph } from './task-graph.js'

/** Result of one bounded dispatch pass. */
export interface DispatchResult {
  readonly started: readonly string[]
  readonly completed: readonly string[]
  readonly failed: readonly string[]
  readonly timedOut: readonly string[]
  readonly cancelled: readonly string[]
  readonly stopUnknown: readonly string[]
}

/** Executor receives a fresh attempt and must observe the abort signal. */
export type TaskExecutor = (task: TaskRecord, signal: AbortSignal) => Promise<TaskExecutionResult | void>

/** Optional result/artifact payload returned by an executor. */
export interface TaskExecutionResult {
  readonly result?: unknown
  readonly artifacts?: readonly import('./protocol.js').ArtifactRef[]
}

/** Dispatcher limits. No implicit retries are performed. */
export interface DispatcherOptions {
  readonly maxConcurrent?: number
  readonly timeoutMs?: number
  /**
   * Bounded window in which an executor can confirm a cancellation after its
   * AbortSignal fires. An executor that remains unresolved is classified as
   * `stop_unknown` when this window closes.
   */
  readonly stopGraceMs?: number
}

type ExecutionOutcome =
  | { readonly kind: 'result'; readonly value: TaskExecutionResult | void }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancel-requested' }

type TaskOutcome = { readonly taskId: string; readonly kind: 'completed' | 'failed' | 'timeout' | 'cancelled' | 'stop_unknown' }
type CancellationObservation = 'requested' | 'confirmed' | 'unknown' | 'ended' | 'aborted'

const MAX_TIMER_MS = 2_147_000_000
const DEFAULT_STOP_GRACE_MS = 100

/**
 * Event-driven finite dispatcher over {@link TaskGraph}. It assigns and starts
 * a bounded batch atomically, waits on executor promises, and records each
 * outcome. A failed or timed-out attempt remains terminal until the caller
 * explicitly invokes `returnForRework`.
 */
export class Dispatcher {
  private readonly options: Required<Pick<DispatcherOptions, 'maxConcurrent' | 'timeoutMs' | 'stopGraceMs'>>

  /**
   * @param graph - task graph owning all lifecycle mutations.
   * @param options - concurrency, timeout, and stop-confirmation limits.
   */
  constructor(private readonly graph: TaskGraph, options: DispatcherOptions = {}) {
    this.options = {
      maxConcurrent: options.maxConcurrent ?? Number.MAX_SAFE_INTEGER,
      timeoutMs: options.timeoutMs ?? 0,
      stopGraceMs: options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS,
    }
    if (!Number.isSafeInteger(this.options.maxConcurrent) || this.options.maxConcurrent < 1) {
      throw new ProtocolError('maxConcurrent must be a positive safe integer', 'INVALID_CONFIG')
    }
    if (!Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 0 || this.options.timeoutMs > MAX_TIMER_MS) {
      throw new ProtocolError(`timeoutMs must be a non-negative safe integer no greater than ${MAX_TIMER_MS}`, 'INVALID_CONFIG')
    }
    if (!Number.isSafeInteger(this.options.stopGraceMs) || this.options.stopGraceMs < 0 || this.options.stopGraceMs > MAX_TIMER_MS) {
      throw new ProtocolError(`stopGraceMs must be a non-negative safe integer no greater than ${MAX_TIMER_MS}`, 'INVALID_CONFIG')
    }
  }

  /**
   * Start as many ready tasks as capacity allows. Assignment is evaluated for
   * every selected task before any task is started, so a missing owner leaves
   * the graph unchanged.
   */
  async runReady(assign: (task: TaskRecord) => string | undefined, execute: TaskExecutor): Promise<DispatchResult> {
    if (typeof assign !== 'function' || typeof execute !== 'function') throw new ProtocolError('assign and execute must be functions', 'INVALID_ARGUMENT')
    const active = this.graph.all().filter(task => task.status === 'running' || task.status === 'queued').length
    const capacity = Math.max(0, this.options.maxConcurrent - active)
    if (capacity === 0) return emptyDispatchResult()
    const candidates = this.graph.ready().slice(0, capacity)
    const assignments = candidates.map(task => ({ task, owner: assign(task) }))
    if (assignments.some(item => typeof item.owner !== 'string' || item.owner.trim() === '')) return emptyDispatchResult()
    const started = this.graph.startBatch(assignments.map(item => ({ taskId: item.task.taskId, owner: item.owner as string, expectedRevision: item.task.revision })))
    const outcomes = await Promise.all(started.map(task => this.executeOne(task, execute)))
    const completed: string[] = []
    const failed: string[] = []
    const timedOut: string[] = []
    const cancelled: string[] = []
    const stopUnknown: string[] = []
    for (const outcome of outcomes) {
      if (outcome.kind === 'completed') completed.push(outcome.taskId)
      else if (outcome.kind === 'timeout') timedOut.push(outcome.taskId)
      else if (outcome.kind === 'cancelled') cancelled.push(outcome.taskId)
      else if (outcome.kind === 'stop_unknown') stopUnknown.push(outcome.taskId)
      else failed.push(outcome.taskId)
    }
    return { started: started.map(task => task.taskId), completed, failed, timedOut, cancelled, stopUnknown }
  }

  /** Cancel tasks that have not acquired an attempt. */
  cancelPending(reason = 'cancelled before dispatch'): readonly TaskRecord[] {
    return this.graph.cancelUnstarted(reason)
  }

  private async executeOne(task: TaskRecord, execute: TaskExecutor): Promise<TaskOutcome> {
    const attemptId = task.attemptId
    if (attemptId === undefined) throw new ProtocolError(`started task ${task.taskId} has no attempt`, 'INVALID_SNAPSHOT')
    const controller = new AbortController()
    const watcherController = new AbortController()
    const execution: Promise<ExecutionOutcome> = Promise.resolve()
      .then(() => execute(task, controller.signal))
      .then(value => ({ kind: 'result', value } as ExecutionOutcome), error => ({ kind: 'error', error } as ExecutionOutcome))
    const cancellation: Promise<CancellationObservation> = this.watchCancellation(task, watcherController.signal)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutOutcome = this.options.timeoutMs > 0
      ? new Promise<ExecutionOutcome>(resolve => {
        timeout = setTimeout(() => {
          controller.abort(new ProtocolError(`task ${task.taskId} timed out`, 'TASK_TIMEOUT'))
          resolve({ kind: 'timeout' })
        }, this.options.timeoutMs)
      })
      : undefined
    try {
      const winner = await Promise.race([
        execution.then(outcome => ({ source: 'execution' as const, outcome })),
        cancellation.then(observation => ({ source: 'cancellation' as const, observation })),
        ...(timeoutOutcome === undefined ? [] : [timeoutOutcome.then(outcome => ({ source: 'timeout' as const, outcome }))]),
      ])
      if (winner.source === 'cancellation') {
        if (winner.observation === 'requested') return this.handleCancellation(task, execution, controller)
        if (winner.observation === 'confirmed') return { taskId: task.taskId, kind: 'cancelled' }
        if (winner.observation === 'unknown') return { taskId: task.taskId, kind: 'stop_unknown' }
        return this.classifyCurrent(task.taskId, 'failed')
      }
      if (winner.source === 'timeout') return this.handleTimeout(task, execution)
      if (winner.outcome.kind === 'error') return this.handleExecutionError(task, attemptId, winner.outcome.error)
      if (winner.outcome.kind === 'timeout') return this.handleTimeout(task, execution)
      if (winner.outcome.kind === 'cancel-requested') return this.handleCancellation(task, execution, controller)
      return this.handleExecutionResult(task, attemptId, winner.outcome.value)
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      watcherController.abort()
      void cancellation.catch(() => undefined)
    }
  }

  private async handleCancellation(task: TaskRecord, execution: Promise<ExecutionOutcome>, controller: AbortController): Promise<TaskOutcome> {
    controller.abort(new ProtocolError(`task ${task.taskId} cancellation requested`, 'TASK_CANCELLED'))
    const settled = await this.waitForExecution(execution, this.options.stopGraceMs)
    const observed = this.currentStopOutcome(task.taskId)
    if (observed !== undefined) return observed
    if (settled !== undefined) {
      // A settled executor has stopped owning the attempt. Its return value is
      // deliberately discarded, but the settlement itself is stop evidence.
      try {
        this.graph.confirmCancellation(task.taskId, { reason: 'executor settled after cancellation request' })
      } catch {
        const after = this.currentStopOutcome(task.taskId)
        if (after !== undefined) return after
      }
      return this.classifyCurrent(task.taskId, 'cancelled')
    }
    try {
      this.graph.markStopUnknown(task.taskId, 'executor did not confirm stop after cancellation request')
    } catch {
      const after = this.currentStopOutcome(task.taskId)
      if (after !== undefined) return after
    }
    return this.classifyCurrent(task.taskId, 'stop_unknown')
  }

  private handleTimeout(task: TaskRecord, execution: Promise<ExecutionOutcome>): TaskOutcome {
    const before = this.currentStopOutcome(task.taskId)
    if (before !== undefined) return before
    try {
      this.graph.markStopUnknown(task.taskId, 'executor did not finish before timeout')
    } catch {
      const after = this.currentStopOutcome(task.taskId)
      if (after !== undefined) return after
    }
    // Keep the timeout category even though the durable task is stop_unknown;
    // callers can distinguish deadline breaches from user cancellation.
    void execution.catch(() => undefined)
    return { taskId: task.taskId, kind: 'timeout' }
  }

  private handleExecutionResult(task: TaskRecord, attemptId: string, value: TaskExecutionResult | void): TaskOutcome {
    const current = this.graph.get(task.taskId)
    if (current.cancellation?.outcome === 'requested') return this.handleCancellationAfterSettlement(task.taskId)
    const terminal = this.currentStopOutcome(task.taskId)
    if (terminal !== undefined) return terminal
    const payload = value === undefined ? {} : value
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return this.failExecution(task, attemptId, new ProtocolError('executor result must be an object', 'INVALID_RESULT'))
    }
    try {
      const completed = this.graph.completeTask(task.taskId, attemptId, payload.result, payload.artifacts ?? [])
      if (completed.stage === 'stop_unknown') return { taskId: task.taskId, kind: 'stop_unknown' }
      if (completed.stage === 'stopped') return { taskId: task.taskId, kind: 'cancelled' }
      return { taskId: task.taskId, kind: 'completed' }
    } catch (error) {
      return this.failExecution(task, attemptId, error)
    }
  }

  private handleExecutionError(task: TaskRecord, attemptId: string, error: unknown): TaskOutcome {
    const current = this.graph.get(task.taskId)
    if (current.cancellation?.outcome === 'requested') return this.handleCancellationAfterSettlement(task.taskId)
    const terminal = this.currentStopOutcome(task.taskId)
    if (terminal !== undefined) return terminal
    return this.failExecution(task, attemptId, error)
  }

  private failExecution(task: TaskRecord, attemptId: string, error: unknown): TaskOutcome {
    try {
      this.graph.failTask(task.taskId, attemptId, error)
      return { taskId: task.taskId, kind: 'failed' }
    } catch {
      return this.classifyCurrent(task.taskId, 'failed')
    }
  }

  private handleCancellationAfterSettlement(taskId: string): TaskOutcome {
    const current = this.graph.get(taskId)
    if (current.cancellation?.outcome === 'requested') {
      try {
        this.graph.confirmCancellation(taskId, { reason: 'executor settled after cancellation request' })
      } catch {
        // A concurrent confirmer may have won the race. Classification below
        // reads the durable state and keeps this path idempotent.
      }
    }
    return this.classifyCurrent(taskId, 'cancelled')
  }

  private currentStopOutcome(taskId: string): TaskOutcome | undefined {
    const current = this.graph.get(taskId)
    if (current.stage === 'stop_unknown') return { taskId, kind: 'stop_unknown' }
    if (current.status === 'cancelled' || current.stage === 'stopped' || current.deleted) return { taskId, kind: 'cancelled' }
    if (current.status === 'completed') return { taskId, kind: 'completed' }
    if (current.status === 'failed') return { taskId, kind: 'failed' }
    return undefined
  }

  private classifyCurrent(taskId: string, fallback: TaskOutcome['kind']): TaskOutcome {
    return this.currentStopOutcome(taskId) ?? { taskId, kind: fallback }
  }

  private async waitForExecution(execution: Promise<ExecutionOutcome>, timeoutMs: number): Promise<ExecutionOutcome | undefined> {
    if (timeoutMs === 0) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<{ readonly source: 'grace' }>(resolve => {
      timer = setTimeout(() => resolve({ source: 'grace' }), timeoutMs)
    })
    try {
      const result = await Promise.race([
        execution.then(outcome => ({ source: 'execution' as const, outcome })),
        grace,
      ])
      return result.source === 'execution' ? result.outcome : undefined
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private async watchCancellation(task: TaskRecord, signal: AbortSignal): Promise<CancellationObservation> {
    let sequence = this.graph.version
    while (!signal.aborted) {
      try {
        const current = this.graph.get(task.taskId)
        if (current.cancellation?.outcome === 'requested') return 'requested'
        if (current.cancellation?.outcome === 'confirmed' || current.stage === 'stopped') return 'confirmed'
        if (current.stage === 'stop_unknown') return 'unknown'
        if (current.status !== 'running') return 'ended'
        const change = await this.graph.waitForChange(sequence, MAX_TIMER_MS, signal)
        if (change.timedOut) continue
        sequence = change.sequence
      } catch {
        return signal.aborted ? 'aborted' : 'ended'
      }
    }
    return 'aborted'
  }
}

function emptyDispatchResult(): DispatchResult {
  return { started: [], completed: [], failed: [], timedOut: [], cancelled: [], stopUnknown: [] }
}

export default Dispatcher
