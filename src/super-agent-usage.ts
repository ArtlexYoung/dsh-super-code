/**
 * Host-side durable token accounting for super-code conversations.
 *
 * Harness's generic `tokenUsage` projection intentionally exposes only an
 * aggregate. This projection keeps the same disjoint buckets while retaining
 * the provider/model route, so the browser can explain which model consumed
 * the current session's tokens without scanning or replaying the log.
 */
import { z } from 'zod'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection/types'

export interface SuperAgentUsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface SuperAgentUsageModel extends SuperAgentUsageBuckets {
  readonly provider: string
  readonly model: string
}

export interface SuperAgentUsageProjection {
  readonly totals: SuperAgentUsageBuckets
  readonly models: Readonly<Record<string, SuperAgentUsageModel>>
}

interface LastSample {
  readonly turn: number
  readonly step: number
  readonly key: string
  readonly buckets: SuperAgentUsageBuckets
}

export interface SuperAgentUsageState {
  readonly totals: Readonly<Record<string, SuperAgentUsageModel>>
  readonly last: LastSample | null
  /** Most recent request route, used by attempt-only events with no message source. */
  readonly route?: { readonly provider: string; readonly model: string }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    superAgentUsage: SuperAgentUsageState
  }
  interface SessionProjectionMap {
    superAgentUsage: SuperAgentUsageProjection
  }
}

const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const modelSchema = bucketsSchema.extend({ provider: z.string(), model: z.string() }).strict()
const projectionSchema = z.object({
  totals: bucketsSchema,
  models: z.record(z.string(), modelSchema),
}).strict()
const stateSchema = z.object({
  totals: z.record(z.string(), modelSchema),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    key: z.string(),
    buckets: bucketsSchema,
  }).nullable(),
  route: z.object({ provider: z.string(), model: z.string() }).strict().optional(),
}).strict()

const zero = (): SuperAgentUsageBuckets => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const fromUsage = (usage: TokenUsage): SuperAgentUsageBuckets => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const sameBuckets = (left: SuperAgentUsageBuckets, right: SuperAgentUsageBuckets): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

function addModel(
  totals: Readonly<Record<string, SuperAgentUsageModel>>,
  key: string,
  provider: string,
  model: string,
  delta: SuperAgentUsageBuckets,
): Readonly<Record<string, SuperAgentUsageModel>> {
  const previous = totals[key]
  const next: SuperAgentUsageModel = {
    provider,
    model,
    uncachedInputTokens: (previous?.uncachedInputTokens ?? 0) + delta.uncachedInputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + delta.outputTokens,
    cacheReadTokens: (previous?.cacheReadTokens ?? 0) + delta.cacheReadTokens,
    cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + delta.cacheWriteTokens,
  }
  // A replacement can only subtract a sample that was previously added. The
  // guard keeps malformed/foreign events from creating negative durable data.
  if (next.uncachedInputTokens < 0 || next.outputTokens < 0 || next.cacheReadTokens < 0 || next.cacheWriteTokens < 0) {
    return totals
  }
  return { ...totals, [key]: next }
}

function delta(left: SuperAgentUsageBuckets, right: SuperAgentUsageBuckets): SuperAgentUsageBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens - right.uncachedInputTokens,
    outputTokens: left.outputTokens - right.outputTokens,
    cacheReadTokens: left.cacheReadTokens - right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens - right.cacheWriteTokens,
  }
}

function sourceOf(event: SessionEvent<'assistant/message'>): { provider: string; model: string } {
  const source = event.data.message.source
  // Old or third-party adapters may omit one route field. Preserve their
  // billed usage under an explicit bucket instead of silently dropping it.
  const provider = source.kind === 'model' && source.provider.trim() !== '' ? source.provider.trim() : 'unknown'
  const model = source.kind === 'model' && source.model.trim() !== '' ? source.model.trim() : 'unknown'
  return { provider, model }
}

function routeOf(value: unknown): { provider: string; model: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { provider?: unknown; model?: unknown }
  if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string') return undefined
  const provider = candidate.provider.trim()
  const model = candidate.model.trim()
  return provider !== '' && model !== '' ? { provider, model } : undefined
}

/** Read the final usage chunk without importing the optional newer stream helper. */
function streamUsageOf(stream: unknown): TokenUsage | undefined {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = stream[index]
    if (typeof chunk !== 'object' || chunk === null) continue
    const candidate = chunk as { chunk?: unknown; type?: unknown; usage?: unknown }
    const payload = candidate.chunk ?? candidate
    if (typeof payload !== 'object' || payload === null) continue
    const usage = (payload as { type?: unknown; usage?: unknown }).type === 'usage'
      ? (payload as { usage?: unknown }).usage
      : candidate.type === 'usage' ? candidate.usage : undefined
    if (typeof usage !== 'object' || usage === null) continue
    const value = usage as Partial<TokenUsage>
    if (typeof value.inputTokens === 'number' && typeof value.outputTokens === 'number') return value as TokenUsage
  }
  return undefined
}

type AttemptLikeEvent = {
  readonly type: 'assistant/attempt'
  readonly data: { readonly turn: number; readonly step: number; readonly stream?: readonly unknown[] }
}

function isAttemptEvent(event: SessionEvent): boolean {
  return (event as { type?: unknown }).type === 'assistant/attempt'
}

function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message') {
    return event.data.usage ?? streamUsageOf((event.data as unknown as { stream?: unknown }).stream)
  }
  if (isAttemptEvent(event)) return streamUsageOf((event as unknown as AttemptLikeEvent).data.stream)
  return undefined
}

function eventRoute(event: SessionEvent, fallback: SuperAgentUsageState['route']): SuperAgentUsageState['route'] {
  if (event.type === 'assistant/message') return sourceOf(event)
  if (event.type === 'request/context') return routeOf(event.data)
  if (event.type === 'request/header') return routeOf((event.data as { header?: { config?: unknown } }).header?.config)
  return fallback
}

function totalsOf(models: Readonly<Record<string, SuperAgentUsageModel>>): SuperAgentUsageBuckets {
  const result = zero()
  for (const model of Object.values(models)) {
    result.uncachedInputTokens += model.uncachedInputTokens
    result.outputTokens += model.outputTokens
    result.cacheReadTokens += model.cacheReadTokens
    result.cacheWriteTokens += model.cacheWriteTokens
  }
  return result
}

/** Durable per-model projection; retries replace the same step's sample. */
export const superAgentUsageProjectionDefinition: ProjectionDefinition<'superAgentUsage', SuperAgentUsageState> & {
  wire: NonNullable<ProjectionDefinition<'superAgentUsage', SuperAgentUsageState>['wire']>
} = {
  key: 'superAgentUsage',
  stateVersion: 1,
  stateSchema,
  init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset) => ({ totals: {}, last: null }),
  apply: (state, event) => {
    // Retry boundaries end the replacement slot. The event is supplied by the
    // optional retry package, so use a string guard to keep this plugin usable
    // with Harness profiles that do not compose that package's type merge.
    if ((event as { type: string }).type === 'llm/retry-started') {
      const data = (event as { data?: { turn?: unknown; step?: unknown } }).data
      return state.last !== null
        && state.last.turn === data?.turn
        && state.last.step === data?.step
        ? { ...state, last: null }
        : state
    }
    const route = eventRoute(event, state.route)
    if (event.type === 'request/context' || event.type === 'request/header') {
      if (route === undefined) return state
      if (state.route?.provider === route.provider && state.route.model === route.model) return state
      return { ...state, route }
    }
    if (event.type !== 'assistant/message' && !isAttemptEvent(event)) return state
    const usage = usageOf(event)
    if (usage === undefined) return state
    const source = event.type === 'assistant/message'
      ? sourceOf(event)
      : route ?? { provider: 'unknown', model: 'unknown' }
    const buckets = fromUsage(usage)
    const key = modelKey(source.provider, source.model)
    const coordinates = event.type === 'assistant/message'
      ? event.data
      : (event as unknown as AttemptLikeEvent).data
    if (state.last !== null && state.last.turn === coordinates.turn && state.last.step === coordinates.step
      && state.last.key === key && sameBuckets(state.last.buckets, buckets)) return state

    let totals = state.totals
    if (state.last !== null && state.last.turn === coordinates.turn && state.last.step === coordinates.step) {
      const previous = totals[state.last.key]
      if (previous !== undefined) {
        totals = addModel(totals, state.last.key, previous.provider, previous.model, delta(zero(), state.last.buckets))
      }
    }
    totals = addModel(totals, key, source.provider, source.model, buckets)
    return { ...state, totals, last: { turn: coordinates.turn, step: coordinates.step, key, buckets } }
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({ totals: totalsOf(state.totals), models: state.totals }),
  },
}
