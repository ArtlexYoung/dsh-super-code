import { ProtocolError } from './protocol.js'
import type { WorkflowGeneration, WorkflowMessage, WorkflowUsage } from './programming.js'
import { extractConversationContract } from './conversation-contract.js'
import type { ConversationContract } from './conversation-contract.js'

export { extractConversationContract } from './conversation-contract.js'
export type { ConversationContract } from './conversation-contract.js'

export interface ConversationContext {
  readonly turn: number
  readonly user: string
  readonly messages: readonly WorkflowMessage[]
  readonly contract: ConversationContract
  readonly signal: AbortSignal
}

export interface ConversationCallbacks {
  readonly generate: (context: ConversationContext) => Promise<WorkflowGeneration>
}

export interface ConversationOptions {
  readonly maxHistoryChars?: number
  readonly retainGenerations?: boolean
  /** Keep a compact, deterministic ledger of constraints found in user turns. */
  readonly preserveContract?: boolean
  readonly maxContractChars?: number
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

function lastMatching(messages: readonly WorkflowMessage[], predicate: (message: WorkflowMessage) => boolean): WorkflowMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message !== undefined && predicate(message)) return message
  }
  return undefined
}

function compact(messages: readonly WorkflowMessage[], maxChars: number): readonly WorkflowMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total <= maxChars) return messages
  const markerText = '[earlier conversation omitted]'
  // A previous compaction may already have inserted a marker. Rebuild from
  // the substantive messages so markers never accumulate across turns.
  const hadMarker = messages.some(message => message.content === markerText)
  const source = messages.filter(message => message.content !== markerText)
  const firstUser = source.find(message => message.role === 'user')
  const lastUser = lastMatching(source, message => message.role === 'user')
  const fallback = source.at(-1)
  const users: WorkflowMessage[] = [firstUser, ...(lastUser !== undefined && lastUser !== firstUser ? [lastUser] : [])].filter((message): message is WorkflowMessage => message !== undefined)
  const required: WorkflowMessage[] = users.length > 0 ? users : (fallback === undefined ? [] : [fallback])
  if (required.length === 0) return []

  const truncate = (message: WorkflowMessage, limit: number): WorkflowMessage | undefined => {
    if (limit <= 0) return undefined
    if (message.content.length <= limit) return message
    if (limit === 1) return { ...message, content: '…' }
    return { ...message, content: `${message.content.slice(0, limit - 1)}…` }
  }

  // User turns are the durable task specification. Fit them first, keeping
  // the first task and the current task even when both are long.
  const keptUsers: WorkflowMessage[] = []
  let remaining = maxChars
  for (const message of required) {
    const reserve = required.length > 1 && message === required[0] ? 1 : 0
    const limit = Math.min(message.content.length, Math.max(0, remaining - reserve))
    const value = truncate(message, limit)
    if (value !== undefined) {
      keptUsers.push(value)
      remaining -= value.content.length
    }
  }
  if (keptUsers.length === 0) return []

  // Add a compact omission marker and the latest assistant answer only when
  // there is room after the required user turns. Never create empty messages.
  const marker: WorkflowMessage = { role: 'tool', content: markerText }
  const omitted = hadMarker || source.length > required.length
  const result = [...keptUsers]
  if (omitted && remaining >= marker.content.length) {
    const insertion = result.length > 1 ? result.length - 1 : result.length
    result.splice(insertion, 0, marker)
    remaining -= marker.content.length
    const assistant = lastMatching(source, message => message.role === 'assistant')
    const value = assistant === undefined ? undefined : truncate(assistant, remaining)
    if (value !== undefined) result.splice(insertion + 1, 0, value)
  }

  return result
}

/** Run a multi-turn conversation while bounding the history sent to the host. */
export async function runConversationWorkflow(turns: readonly string[], callbacks: ConversationCallbacks, options: ConversationOptions = {}, signal: AbortSignal = new AbortController().signal): Promise<ConversationResult> {
  if (!Array.isArray(turns) || turns.length === 0 || turns.some(turn => typeof turn !== 'string' || turn.trim() === '')) throw new ProtocolError('turns must contain non-empty strings', 'INVALID_ARGUMENT')
  if (!callbacks || typeof callbacks.generate !== 'function') throw new ProtocolError('generate callback is required', 'INVALID_ARGUMENT')
  const maxHistoryChars = options.maxHistoryChars ?? 12_000
  const retainGenerations = options.retainGenerations ?? true
  const preserveContract = options.preserveContract ?? true
  const maxContractChars = options.maxContractChars ?? 1_200
  if (!Number.isSafeInteger(maxHistoryChars) || maxHistoryChars < 128) throw new ProtocolError('maxHistoryChars must be at least 128', 'INVALID_ARGUMENT')
  const messages: WorkflowMessage[] = []
  const generations: WorkflowGeneration[] = []
  const contractTurns: string[] = []
  let aggregate = emptyUsage()
  for (let index = 0; index < turns.length; index += 1) {
    if (signal.aborted) throw signal.reason ?? new Error('conversation aborted')
    const user = turns[index].trim()
    contractTurns.push(user)
    const context = compact([...messages, { role: 'user' as const, content: user }], maxHistoryChars)
    const contract = preserveContract ? extractConversationContract(contractTurns, maxContractChars) : { requirements: [], text: '' }
    const generation = await callbacks.generate({ turn: index + 1, user, messages: context, contract, signal })
    if (!generation || typeof generation.text !== 'string' || generation.text.trim() === '') throw new ProtocolError(`turn ${index + 1} generation must contain text`, 'INVALID_RESULT')
    if (retainGenerations) generations.push(generation)
    aggregate = add(aggregate, generation.usage)
    messages.push({ role: 'user', content: user }, { role: 'assistant', content: generation.text.trim() })
    const bounded = compact(messages, maxHistoryChars)
    messages.splice(0, messages.length, ...bounded)
  }
  return { messages: compact(messages, maxHistoryChars), generations, usage: aggregate }
}

export default runConversationWorkflow
