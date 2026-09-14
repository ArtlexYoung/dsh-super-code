import { ProtocolError, validateBudget } from './protocol.js'
import type { Budget, EvidenceRecord } from './protocol.js'

/** Provider-neutral conversation roles used by host adapters. */
export type WorkflowMessageRole = 'user' | 'assistant' | 'tool'

/** A compact message history; the workflow keeps the task prompt once. */
export interface WorkflowMessage {
  readonly role: WorkflowMessageRole
  readonly content: string
}

/** Usage returned by one model or tool invocation. */
export interface WorkflowUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedTokens?: number
  readonly toolCalls?: number
  readonly latencyMs?: number
}

/** Model output returned to the orchestration layer. */
export interface WorkflowGeneration {
  readonly text: string
  readonly usage?: WorkflowUsage
  readonly metadata?: Readonly<Record<string, string>>
}

/** External acceptance result, normally produced by a local test runner. */
export interface VerificationResult {
  readonly passed: boolean
  readonly feedback?: string
  readonly evidence?: readonly EvidenceRecord[]
}

/** Context supplied to each host callback. */
export interface ProgrammingWorkflowContext {
  readonly phase: 'analysis' | 'draft' | 'repair'
  readonly task: string
  readonly messages: readonly WorkflowMessage[]
  readonly analysis?: string
  readonly candidate?: string
  readonly feedback?: string
  readonly attempt: number
  readonly remainingBudget: Budget
  readonly signal: AbortSignal
}

/** Host callbacks adapt this workflow to AgentLoop, HTTP, or a test double. */
export interface ProgrammingWorkflowCallbacks {
  readonly generate: (context: ProgrammingWorkflowContext) => Promise<WorkflowGeneration>
  readonly verify: (input: { readonly task: string; readonly candidate: string; readonly attempt: number; readonly signal: AbortSignal }) => Promise<VerificationResult>
}

/** Bounds for repairs and verifier-feedback compaction. */
export interface ProgrammingWorkflowOptions {
  readonly budget?: Budget
  readonly maxRepairAttempts?: number
  readonly maxFeedbackChars?: number
}

export interface WorkflowPhaseRecord {
  readonly phase: 'analysis' | 'draft' | 'repair'
  readonly attempt: number
  readonly generation: WorkflowGeneration
  readonly acceptance?: VerificationResult
}

export type ProgrammingWorkflowStatus = 'passed' | 'failed' | 'budget_exhausted' | 'aborted'

/** Complete result with evidence suitable for matched evaluation. */
export interface ProgrammingWorkflowResult {
  readonly status: ProgrammingWorkflowStatus
  readonly candidate?: string
  readonly attempts: number
  readonly phases: readonly WorkflowPhaseRecord[]
  readonly messages: readonly WorkflowMessage[]
  readonly usage: Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>
  readonly finalAcceptance?: VerificationResult
}

const DEFAULT_MAX_REPAIR_ATTEMPTS = 2
const DEFAULT_MAX_FEEDBACK_CHARS = 2_000

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new ProtocolError(`${field} must be a positive safe integer`, 'INVALID_ARGUMENT')
  return normalized
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT')
  return value.trim()
}

function usageValue(value: number | undefined, field: string): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value) || value < 0) throw new ProtocolError(`${field} must be a non-negative finite number`, 'INVALID_USAGE')
  return value
}

type NormalizedUsage = Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>

function normalizeUsage(usage: WorkflowUsage | undefined): NormalizedUsage {
  const inputTokens = usageValue(usage?.inputTokens, 'usage.inputTokens')
  const outputTokens = usageValue(usage?.outputTokens, 'usage.outputTokens')
  const totalTokens = usage?.totalTokens === undefined ? inputTokens + outputTokens : usageValue(usage.totalTokens, 'usage.totalTokens')
  if (totalTokens < inputTokens + outputTokens) throw new ProtocolError('usage.totalTokens must cover inputTokens + outputTokens', 'INVALID_USAGE')
  return { inputTokens, outputTokens, totalTokens, cachedTokens: usageValue(usage?.cachedTokens, 'usage.cachedTokens'), toolCalls: usageValue(usage?.toolCalls, 'usage.toolCalls'), latencyMs: usageValue(usage?.latencyMs, 'usage.latencyMs') }
}

function addUsage(left: NormalizedUsage, right: NormalizedUsage): NormalizedUsage {
  return { inputTokens: left.inputTokens + right.inputTokens, outputTokens: left.outputTokens + right.outputTokens, totalTokens: left.totalTokens + right.totalTokens, cachedTokens: left.cachedTokens + right.cachedTokens, toolCalls: left.toolCalls + right.toolCalls, latencyMs: left.latencyMs + right.latencyMs }
}

const emptyUsage = (): NormalizedUsage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, toolCalls: 0, latencyMs: 0 })

function exceeds(usage: NormalizedUsage, budget: Budget): boolean {
  return (budget.maxInputTokens !== undefined && usage.inputTokens > budget.maxInputTokens)
    || (budget.maxOutputTokens !== undefined && usage.outputTokens > budget.maxOutputTokens)
    || (budget.maxTotalTokens !== undefined && usage.totalTokens > budget.maxTotalTokens)
    || (budget.maxToolCalls !== undefined && usage.toolCalls > budget.maxToolCalls)
}

function remaining(usage: NormalizedUsage, budget: Budget, elapsedMs = 0): Budget {
  return {
    ...budget.maxInputTokens === undefined ? {} : { maxInputTokens: Math.max(0, budget.maxInputTokens - usage.inputTokens) },
    ...budget.maxOutputTokens === undefined ? {} : { maxOutputTokens: Math.max(0, budget.maxOutputTokens - usage.outputTokens) },
    ...budget.maxTotalTokens === undefined ? {} : { maxTotalTokens: Math.max(0, budget.maxTotalTokens - usage.totalTokens) },
    ...budget.maxToolCalls === undefined ? {} : { maxToolCalls: Math.max(0, budget.maxToolCalls - usage.toolCalls) },
    ...budget.timeoutMs === undefined ? {} : { timeoutMs: Math.max(0, budget.timeoutMs - elapsedMs) },
  }
}

/** Keep verifier diagnostics useful without replaying an unbounded tool log. */
export function compactFeedback(value: string | undefined, maxChars: number = DEFAULT_MAX_FEEDBACK_CHARS): string {
  const limit = positiveInteger(maxChars, DEFAULT_MAX_FEEDBACK_CHARS, 'maxFeedbackChars')
  const text = (value ?? 'The acceptance check failed without a diagnostic.').trim()
  if (text.length <= limit) return text
  const marker = '…[feedback truncated]…'
  if (limit <= marker.length) return text.slice(0, limit)
  const available = limit - marker.length
  const head = Math.ceil(available * 0.65)
  const tail = available - head
  return `${text.slice(0, head)}${marker}${tail === 0 ? '' : text.slice(-tail)}`
}

/**
 * Run a bounded programming task: one analysis, one draft, then repairs only
 * when the verifier rejects the candidate. The host owns model/tool execution.
 */
export async function runProgrammingWorkflow(task: string, callbacks: ProgrammingWorkflowCallbacks, options: ProgrammingWorkflowOptions = {}, signal: AbortSignal = new AbortController().signal): Promise<ProgrammingWorkflowResult> {
  const normalizedTask = nonEmpty(task, 'task')
  if (!callbacks || typeof callbacks.generate !== 'function' || typeof callbacks.verify !== 'function') throw new ProtocolError('generate and verify callbacks are required', 'INVALID_ARGUMENT')
  const budget = validateBudget(options.budget ?? {})
  const maxRepairAttempts = options.maxRepairAttempts === undefined ? DEFAULT_MAX_REPAIR_ATTEMPTS : positiveInteger(options.maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS, 'maxRepairAttempts')
  const maxFeedbackChars = options.maxFeedbackChars === undefined ? DEFAULT_MAX_FEEDBACK_CHARS : positiveInteger(options.maxFeedbackChars, DEFAULT_MAX_FEEDBACK_CHARS, 'maxFeedbackChars')
  const messages: WorkflowMessage[] = [{ role: 'user', content: normalizedTask }]
  const phases: WorkflowPhaseRecord[] = []
  let usage = emptyUsage()
  let analysis: string | undefined
  let candidate: string | undefined
  let finalAcceptance: VerificationResult | undefined
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt
  const deadlineExceeded = (): boolean => budget.timeoutMs !== undefined && elapsed() >= budget.timeoutMs

  const invoke = async (phase: 'analysis' | 'draft' | 'repair', attempt: number, feedback?: string): Promise<WorkflowGeneration | undefined> => {
    if (signal.aborted || deadlineExceeded() || exceeds(usage, budget)) return undefined
    const generation = await callbacks.generate({ phase, task: normalizedTask, messages: [...messages], ...analysis === undefined ? {} : { analysis }, ...candidate === undefined ? {} : { candidate }, ...feedback === undefined ? {} : { feedback }, attempt, remainingBudget: remaining(usage, budget, elapsed()), signal })
    const text = nonEmpty(generation.text, `${phase}.text`)
    const normalized = { ...generation, text, usage: generation.usage === undefined ? undefined : { ...generation.usage } }
    usage = addUsage(usage, normalizeUsage(generation.usage))
    messages.push({ role: 'assistant', content: text })
    return normalized
  }

  if (signal.aborted) return { status: 'aborted', attempts: 0, phases, messages, usage, finalAcceptance }
  const analysisGeneration = await invoke('analysis', 0)
  if (analysisGeneration === undefined) return { status: signal.aborted ? 'aborted' : 'budget_exhausted', attempts: 0, phases, messages, usage, finalAcceptance }
  analysis = analysisGeneration.text
  phases.push({ phase: 'analysis', attempt: 0, generation: analysisGeneration })
  if (exceeds(usage, budget) || deadlineExceeded() || signal.aborted) return { status: signal.aborted ? 'aborted' : 'budget_exhausted', attempts: 0, phases, messages, usage, finalAcceptance }

  for (let attempt = 1; attempt <= maxRepairAttempts + 1; attempt += 1) {
    const phase = attempt === 1 ? 'draft' : 'repair'
    const feedback = phase === 'repair' ? compactFeedback(finalAcceptance?.feedback, maxFeedbackChars) : undefined
    if (feedback !== undefined) messages.push({ role: 'tool', content: feedback })
    const generation = await invoke(phase, attempt, feedback)
    if (generation === undefined) return { status: signal.aborted ? 'aborted' : 'budget_exhausted', candidate, attempts: attempt - 1, phases, messages, usage, finalAcceptance }
    candidate = generation.text
    const acceptance = await callbacks.verify({ task: normalizedTask, candidate, attempt, signal })
    if (!acceptance || typeof acceptance.passed !== 'boolean') throw new ProtocolError('verify must return a passed boolean', 'INVALID_RESULT')
    finalAcceptance = acceptance
    phases.push({ phase, attempt, generation, acceptance })
    if (acceptance.passed) return { status: 'passed', candidate, attempts: attempt, phases, messages, usage, finalAcceptance }
    if (exceeds(usage, budget) || deadlineExceeded() || signal.aborted) return { status: signal.aborted ? 'aborted' : 'budget_exhausted', candidate, attempts: attempt, phases, messages, usage, finalAcceptance }
  }
  return { status: 'failed', candidate, attempts: maxRepairAttempts + 1, phases, messages, usage, finalAcceptance }
}

export default runProgrammingWorkflow
