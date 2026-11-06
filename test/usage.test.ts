import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
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
  assert.deepEqual(Object.values(view.models).find(model => model.provider === 'deepseek'), {
    provider: 'deepseek', model: 'reasoner',
    uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1,
  })
  assert.deepEqual(Object.values(view.models).find(model => model.provider === 'openai'), {
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
  assert.deepEqual(Object.values(view.models)[0], {
    provider: 'provider-a', model: 'model-a',
    uncachedInputTokens: 7, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0,
  })
})

test('super-agent usage projection keeps unattributed usage under unknown route', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  state = apply(state, message(1, 1, '', '', { inputTokens: 1, outputTokens: 1 }))
  const view = superAgentUsageProjectionDefinition.wire.view(state)
  assert.deepEqual(Object.values(view.models)[0], {
    provider: 'unknown', model: 'unknown', uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
  })
})

test('model routes containing separators retain independent usage and replacement slots', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 0)
  const usage = { inputTokens: 10, outputTokens: 2 }
  state = apply(state, message(1, 1, 'gateway/team', 'model', usage))
  state = apply(state, message(1, 2, 'gateway', 'team/model', usage))
  let models = Object.values(superAgentUsageProjectionDefinition.wire.view(state).models)
  assert.equal(models.length, 2)
  assert.deepEqual(models.map(({ provider, model }) => [provider, model]), [
    ['gateway/team', 'model'], ['gateway', 'team/model'],
  ])
  assert.deepEqual(models.map(model => model.uncachedInputTokens), [10, 10])

  // A same-step correction can change route without changing token counts.
  state = apply(state, message(1, 2, 'gateway/team', 'model', usage))
  models = Object.values(superAgentUsageProjectionDefinition.wire.view(state).models)
  assert.deepEqual(models.map(model => model.uncachedInputTokens), [20, 0])
  assert.equal(superAgentUsageProjectionDefinition.wire.view(state).totals.uncachedInputTokens, 20)
})

test('usage replays old route-key caches and cold-restores distinct model routes', async () => {
  const ctx = new Context()
  try {
    const registry = new SessionProjectionRegistry(ctx)
    registry.register(superAgentUsageProjectionDefinition)
    const events = [
      message(1, 1, 'gateway/team', 'model', { inputTokens: 10, outputTokens: 2 }),
      message(1, 2, 'gateway', 'team/model', { inputTokens: 3, outputTokens: 4 }),
      message(1, 3, 'gateway', 'team%2Fmodel "中文🧪"', { inputTokens: 5, outputTokens: 6 }),
    ].map((event, seq) => ({ ...event, seq: seq as never }))
    const stale = { superAgentUsage: { ver: 1, seq: 2, val: {
      totals: { 'gateway/team/model': { provider: 'gateway', model: 'team/model',
        uncachedInputTokens: 13, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 } }, last: null,
    } } }
    assert.equal(registry.restoreFloor(stale), 0)
    const restored = registry.restore(stale, events, 0, header, 0)
    const view = restored.snapshot.values.superAgentUsage!
    assert.equal(Object.keys(view.models).length, 3)
    assert.equal(view.totals.uncachedInputTokens, 18)
    assert.equal(restored.checkpoint.superAgentUsage?.ver, 3)
    assert.deepEqual(registry.restore(JSON.parse(JSON.stringify(restored.checkpoint)), events.slice(2), 2, header, 0).snapshot, restored.snapshot)
  } finally { await ctx.fiber.dispose() }
})

test('forked sessions count only their own usage, including nested forks and cold replay', async () => {
  const ctx = new Context()
  try {
    const store = new SessionStore(ctx), registry = new SessionProjectionRegistry(ctx)
    registry.register(superAgentUsageProjectionDefinition)
    const parent = store.create(SessionId('usage-parent'))
    const append = (session: typeof parent, turn: number, inputTokens: number) => {
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      session.append('assistant/message', { ...message(turn, 1, 'deepseek', 'chat', { inputTokens, outputTokens: 2 }).data, stream: [],
        message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [{ type: 'text', text: 'done' }] }) } as never,
      { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    const view = (session: typeof parent) => registry.snapshot(session).values.superAgentUsage!
    append(parent, 1, 100)
    const child = store.fork(parent, undefined, SessionId('usage-child'))
    assert.ok(child.inheritedEventCount > 0)
    assert.deepEqual(view(child).totals, { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      'an untouched fork must not bill its copied parent transcript again')
    append(child, 2, 7)
    const grandchild = store.fork(child, undefined, SessionId('usage-grandchild'))
    append(grandchild, 3, 3)
    assert.deepEqual([parent, child, grandchild].map(session => view(session).totals.uncachedInputTokens), [100, 7, 3])
    for (const session of [child, grandchild]) {
      const recovered = registry.restore({}, session.snapshotEvents(), 0, session.header, session.inheritedEventCount)
      assert.deepEqual(recovered.snapshot.values.superAgentUsage, view(session))
      const cold = registry.restore(JSON.parse(JSON.stringify(recovered.checkpoint)), [], session.seq, session.header, session.inheritedEventCount)
      assert.deepEqual(cold.snapshot, recovered.snapshot)
      assert.equal('inheritedEventCount' in view(session), false, 'fork bookkeeping is host-only')
      const { inheritedEventCount: _inherited, ...oldState } = registry.stateOf(session, 'superAgentUsage')!
      const old = { superAgentUsage: { ver: 2, seq: session.seq - 1, val: { ...oldState,
        totals: { ...oldState.totals, '["old-parent","model"]': { provider: 'old-parent', model: 'model',
          uncachedInputTokens: 100, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      } } }
      assert.equal(registry.restoreFloor(old), 0)
      assert.deepEqual(registry.restore(old, session.snapshotEvents(), 0, session.header, session.inheritedEventCount).snapshot, recovered.snapshot)
    }
  } finally { await ctx.fiber.dispose() }
})

test('fork attempts retain the inherited request route without billing inherited messages or retries', () => {
  let state = superAgentUsageProjectionDefinition.init(header, 4)
  const events = [route(1, 1, 'gateway', 'model'), attempt(1, 1, { inputTokens: 100, outputTokens: 20 }),
    retryStarted(1, 1), message(1, 1, 'gateway', 'model', { inputTokens: 200, outputTokens: 40 }),
    attempt(2, 1, { inputTokens: 7, outputTokens: 3 })]
  for (const [seq, event] of events.entries()) state = apply(state, { ...event, seq } as SessionEvent)
  assert.deepEqual(Object.values(superAgentUsageProjectionDefinition.wire.view(state).models), [{
    provider: 'gateway', model: 'model', uncachedInputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
  }])
})
