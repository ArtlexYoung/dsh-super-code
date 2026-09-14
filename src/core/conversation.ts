import { ProtocolError } from './protocol.js'
import type { WorkflowGeneration, WorkflowMessage, WorkflowUsage } from './programming.js'

export interface ConversationContext {
  readonly turn: number
  readonly user: string
  readonly messages: readonly WorkflowMessage[]
  readonly signal: AbortSignal
}

export interface ConversationCallbacks {
  readonly generate: (context: ConversationContext) => Promise<WorkflowGeneration>
}

export interface ConversationOptions {
  readonly maxHistoryChars?: number
}

export interface ConversationResult {
  readonly messages: readonly WorkflowMessage[]
  readonly generations: readonly WorkflowGeneration[]
  readonly usage: Required<Pick<WorkflowUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedTokens' | 'toolCalls' | 'latencyMs'>>
}

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, toolCalls: 0, latencyMs: 0 })

function usage(value: number | undefined, field: string): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value) || value < 0) throw new ProtocolError(`${field} must be a non-negative finite number`, 'INVALID_USAGE')
  return value
}

function add(left: ReturnType<typeof emptyUsage>, right: WorkflowUsage | undefined) {
  const inputTokens = usage(right?.inputTokens, 'usage.inputTokens')
  const outputTokens = usage(right?.outputTokens, 'usage.outputTokens')
  const totalTokens = usage(right?.totalTokens, 'usage.totalTokens')
  if (right?.totalTokens !== undefined && totalTokens < inputTokens + outputTokens) throw new ProtocolError('usage.totalTokens must cover inputTokens + outputTokens', 'INVALID_USAGE')
  return { inputTokens: left.inputTokens + inputTokens, outputTokens: left.outputTokens + outputTokens, totalTokens: left.totalTokens + (right?.totalTokens === undefined ? inputTokens + outputTokens : totalTokens), cachedTokens: left.cachedTokens + usage(right?.cachedTokens, 'usage.cachedTokens'), toolCalls: left.toolCalls + usage(right?.toolCalls, 'usage.toolCalls'), latencyMs: left.latencyMs + usage(right?.latencyMs, 'usage.latencyMs') }
}

function compact(messages: readonly WorkflowMessage[], maxChars: number): readonly WorkflowMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total <= maxChars) return messages
  const marker: WorkflowMessage = { role: 'tool', content: '[earlier conversation omitted]' }
  const first = messages[0]
  const last = messages.at(-1)
  if (first === undefined || last === undefined) return []
  const available = Math.max(0, maxChars - marker.content.length - first.content.length - last.content.length)
  const tail = messages.slice(1, -1).reduceRight<WorkflowMessage[]>((acc, message) => {
    if (acc.reduce((sum, item) => sum + item.content.length, 0) + message.content.length <= available) acc.unshift(message)
    return acc
  }, [])
  return [first, marker, ...tail, ...(last === first ? [] : [last])]
}

/** Run a multi-turn conversation while bounding the history sent to the host. */
export async function runConversationWorkflow(turns: readonly string[], callbacks: ConversationCallbacks, options: ConversationOptions = {}, signal: AbortSignal = new AbortController().signal): Promise<ConversationResult> {
  if (!Array.isArray(turns) || turns.length === 0 || turns.some(turn => typeof turn !== 'string' || turn.trim() === '')) throw new ProtocolError('turns must contain non-empty strings', 'INVALID_ARGUMENT')
  if (!callbacks || typeof callbacks.generate !== 'function') throw new ProtocolError('generate callback is required', 'INVALID_ARGUMENT')
  const maxHistoryChars = options.maxHistoryChars ?? 12_000
  if (!Number.isSafeInteger(maxHistoryChars) || maxHistoryChars < 128) throw new ProtocolError('maxHistoryChars must be at least 128', 'INVALID_ARGUMENT')
  const messages: WorkflowMessage[] = []
  const generations: WorkflowGeneration[] = []
  let aggregate = emptyUsage()
  for (let index = 0; index < turns.length; index += 1) {
    if (signal.aborted) throw signal.reason ?? new Error('conversation aborted')
    const user = turns[index].trim()
    const context = compact([...messages, { role: 'user' as const, content: user }], maxHistoryChars)
    const generation = await callbacks.generate({ turn: index + 1, user, messages: context, signal })
    if (!generation || typeof generation.text !== 'string' || generation.text.trim() === '') throw new ProtocolError(`turn ${index + 1} generation must contain text`, 'INVALID_RESULT')
    generations.push(generation)
    aggregate = add(aggregate, generation.usage)
    messages.push({ role: 'user', content: user }, { role: 'assistant', content: generation.text.trim() })
  }
  return { messages: compact(messages, maxHistoryChars), generations, usage: aggregate }
}

export default runConversationWorkflow
