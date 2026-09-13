export type TaskState = 'pending' | 'ready' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

export interface TaskRecord {
  readonly taskId: string
  readonly title: string
  readonly owner?: string
  readonly dependencies: readonly string[]
  readonly acceptance: readonly string[]
  readonly state: TaskState
  readonly attempts: number
}

export interface EvidenceRecord {
  readonly evidenceId: string
  readonly taskId: string
  readonly kind: 'source' | 'test' | 'metric' | 'artifact'
  readonly summary: string
  readonly ref?: string
}

export interface MetricSnapshot {
  readonly mode: 'real' | 'mock' | 'replay'
  readonly score: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly toolCalls: number
}

export class ProtocolError extends Error {}

export function createTask(input: Omit<TaskRecord, 'state' | 'attempts'>): TaskRecord {
  if (!input.taskId || !input.title) throw new ProtocolError('taskId and title are required')
  if (input.dependencies.includes(input.taskId)) throw new ProtocolError('task cannot depend on itself')
  return { ...input, state: input.dependencies.length === 0 ? 'ready' : 'pending', attempts: 0 }
}

export function transitionTask(task: TaskRecord, next: TaskState, dependencies: readonly TaskRecord[] = []): TaskRecord {
  const allowed: Record<TaskState, readonly TaskState[]> = {
    pending: ['ready', 'cancelled'], ready: ['running', 'cancelled'], running: ['waiting', 'succeeded', 'failed', 'cancelled'],
    waiting: ['running', 'failed', 'cancelled'], succeeded: [], failed: ['ready', 'cancelled'], cancelled: [],
  }
  if (!allowed[task.state].includes(next)) throw new ProtocolError(`invalid transition ${task.state} -> ${next}`)
  if (next === 'ready' && dependencies.some(dep => dep.state !== 'succeeded')) throw new ProtocolError('dependencies are not complete')
  return { ...task, state: next, attempts: next === 'running' ? task.attempts + 1 : task.attempts }
}

export function compareMetrics(baseline: MetricSnapshot, candidate: MetricSnapshot) {
  if (baseline.mode !== 'real' || candidate.mode !== 'real') throw new ProtocolError('release comparison requires real results')
  return {
    scoreDelta: candidate.score - baseline.score,
    totalTokensDelta: candidate.inputTokens + candidate.outputTokens - baseline.inputTokens - baseline.outputTokens,
    latencyDelta: candidate.latencyMs - baseline.latencyMs,
    accepted: candidate.score >= baseline.score && candidate.inputTokens + candidate.outputTokens < baseline.inputTokens + baseline.outputTokens,
  }
}
