import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import {
  superAgentUsageProjectionDefinition,
  type SuperAgentUsageState,
} from '../src/super-agent-usage.js'

const header = {} as SessionHeader

function message(
  turn: number,
  step: number,
  provider: string,
  model: string,
  usage: TokenUsage,
): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: 0 as never,
    time: 0,
    data: {
      turn,
      step,
      message: { source: { kind: 'model', provider, model } },
      usage,
    },
  } as unknown as SessionEvent<'assistant/message'>
}

function route(turn: number, step: number, provider: string, model: string): SessionEvent {
  return {
    type: 'request/context',
    seq: 0 as never,
    time: 0,
    data: { provider, model },
  } as unknown as SessionEvent
}

function attempt(turn: number, step: number, usage: TokenUsage): SessionEvent {
  return {
    type: 'assistant/attempt',
    seq: 0 as never,
    time: 0,
    data: { turn, step, stream: [{ time: 1, chunk: { type: 'usage', usage } }] },
  } as unknown as SessionEvent
}

function retryStarted(turn: number, step: number): SessionEvent {
  return {
    type: 'llm/retry-started',
    seq: 0 as never,
    time: 0,
    data: { turn, step, retry: 1, retryId: 'retry-1' },
  } as unknown as SessionEvent
}

function apply(state: SuperAgentUsageState, event: SessionEvent): SuperAgentUsageState {
  return superAgentUsageProjectionDefinition.apply(state, event)
}

test('super-agent usage projection aggregates provider/model buckets', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  state = apply(state, message(1, 1, 'deepseek', 'reasoner', {
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1,
  }))
  state = apply(state, message(1, 2, 'openai', 'gpt', {
    inputTokens: 3, outputTokens: 4,
  }))

  const view = superAgentUsageProjectionDefinition.wire.view(state)
  assert.deepEqual(view.totals, {
    uncachedInputTokens: 13,
    outputTokens: 9,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
  })
  assert.deepEqual(view.models['deepseek/reasoner'], {
    provider: 'deepseek', model: 'reasoner',
    uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1,
  })
  assert.deepEqual(view.models['openai/gpt'], {
    provider: 'openai', model: 'gpt',
    uncachedInputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0,
  })
})

test('super-agent usage projection replaces duplicate step samples and adds after retry boundary', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  state = apply(state, message(1, 1, 'deepseek', 'chat', { inputTokens: 10, outputTokens: 2 }))
  const unchanged = apply(state, message(1, 1, 'deepseek', 'chat', { inputTokens: 10, outputTokens: 2 }))
  assert.equal(unchanged, state)

  state = apply(state, message(1, 1, 'deepseek', 'chat', { inputTokens: 12, outputTokens: 3 }))
  assert.equal(superAgentUsageProjectionDefinition.wire.view(state).totals.uncachedInputTokens, 12)
  assert.equal(superAgentUsageProjectionDefinition.wire.view(state).totals.outputTokens, 3)

  state = apply(state, retryStarted(1, 1))
  state = apply(state, message(1, 1, 'deepseek', 'chat', { inputTokens: 4, outputTokens: 1 }))
  assert.equal(superAgentUsageProjectionDefinition.wire.view(state).totals.uncachedInputTokens, 16)
  assert.equal(superAgentUsageProjectionDefinition.wire.view(state).totals.outputTokens, 4)
})

test('super-agent usage projection reads attempt stream usage and request route', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  state = apply(state, route(1, 1, 'provider-a', 'model-a'))
  state = apply(state, attempt(1, 1, { inputTokens: 7, outputTokens: 2, cacheReadTokens: 3 }))
  const view = superAgentUsageProjectionDefinition.wire.view(state)
  assert.deepEqual(view.models['provider-a/model-a'], {
    provider: 'provider-a', model: 'model-a',
    uncachedInputTokens: 7, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0,
  })
})

test('super-agent usage projection keeps unattributed usage under unknown route', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  state = apply(state, message(1, 1, '', '', { inputTokens: 1, outputTokens: 1 }))
  const view = superAgentUsageProjectionDefinition.wire.view(state)
  assert.equal(view.models['unknown/unknown']?.outputTokens, 1)
})
