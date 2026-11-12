import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { LongMemoryStore } from '../src/long-memory.js'
import type { LongMemoryTopic } from '../src/long-memory.js'
import { prepareMemoryRecord } from '../src/dsh/tool-contracts.js'
import { foldMemoryUsage as fold, memoryUsageProjection as projection } from '../src/memory-usage-projection.js'

const initial = () => projection.init({} as never, SessionLogOffset(0))
const event = (seq: number, type: string, data: object): SessionEvent => ({ seq, time: seq, type, data }) as SessionEvent
const call = (seq: number, turn: number, args: object) => event(seq, 'tool/call', {
  turn, step: 1, callId: 'reused', name: 'super_code_memory', arguments: JSON.stringify(args),
})
function returned(seq: number, turn: number, value: object, modern = true, isError = false): SessionEvent {
  const content = [{ type: 'text', text: JSON.stringify(value) }]
  return event(seq, 'tool/result', { turn, step: 1, message: modern
    ? { role: 'tool', toolCallId: 'reused', content, isError }
    : { content: [{ type: 'tool-result', toolCallId: 'reused', content, isError }] } })
}

for (const layout of ['legacy', 'modern', 'ptc']) test(`${layout} memory usage shows the summary actually saved by the memory writer`, async () => {
  const records = new Map<string, LongMemoryTopic>()
  const store = new LongMemoryStore({ get: (key: string) => records.get(key), entries: () => records.entries(),
    put: async (key: string, value: LongMemoryTopic) => { records.set(key, value) },
  } as unknown as KvTable<string, LongMemoryTopic>)
  for (const padding of [' \t', ' \t'.repeat(80)]) {
    const summary = '保留用户修改😀', args = { action: 'remember', scope: 'global', record: { expectedRevision: 0,
      globalConfirmed: true, entries: [{ id: 'keep', kind: 'constraint', summary: padding + summary + '\n ', detail: 'Keep user edits.',
        source: { kind: 'user', eventSeq: 0, quote: 'Keep user edits.' } }] } }
    const input = prepareMemoryRecord(args, 'session').remember!
    assert.equal(input.entries[0]?.summary, summary, 'use the actual tool input contract')
    const saved = await store.remember('0'.repeat(64), 'preferences', store.read('0'.repeat(64), 'preferences').kind === 'missing' ? 0 : 1, input.entries)
    const output = { scope: 'global', topic: saved.topic, revision: saved.revision, count: saved.entries.length }
    const state = layout === 'ptc' ? fold(initial(), event(2, 'tool/ptc-dispatch', {
      rootCallId: 'outer', parentCallId: 'outer', subCallId: 'nested', name: 'super_code_memory', arguments: args,
      isError: false, content: [{ type: 'text', text: JSON.stringify(output) }],
    })) : fold(fold(initial(), call(1, 1, args)), returned(2, 1, output, layout === 'modern'))
    assert.deepEqual(state.rows.map(row => ({ id: row.id, summary: row.summary })),
      saved.entries.map(({ id, summary }) => ({ id, summary })))
    assert.equal(state.pending.length, 0)
  }
})

test('old summary checkpoints rebuild from the journal, then continue from a current partial checkpoint', async t => {
  const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  t.after(() => ctx.fiber.dispose())
  ctx.sessionProjections.register(projection)
  const session = ctx.sessions.create(SessionId('memory-summary-replay'))
  const args = { action: 'remember', record: { entries: [{ id: 'keep', summary: '  Keep edits  ' }] } }
  const output = { scope: 'project', topic: 'build', revision: 1 }
  const events = [call(0, 1, args), returned(1, 1, output), call(2, 2, { action: 'read', id: 'keep' })]
  const old = { superCodeMemoryUsage: { ver: 3, seq: 2, val: { ...initial(), rows: [{ id: 'keep', summary: '  Keep edits  ',
    scope: 'project', topic: 'build', revision: 1, action: 'remember', seq: 1, time: 1 }] } } }
  assert.equal(ctx.sessionProjections.restoreFloor(old), 0, 'old display data must be replayed')
  const replay = ctx.sessionProjections.restore(old, events, SessionLogOffset(0), session.header, SessionLogOffset(0))
  assert.equal(replay.snapshot.values.superCodeMemoryUsage?.rows[0]?.summary, 'Keep edits')
  const cold = ctx.sessionProjections.restore(JSON.parse(JSON.stringify(replay.checkpoint)),
    [returned(3, 2, { ...output, entry: { id: 'keep', summary: 'Keep edits' } })], SessionLogOffset(3), session.header, SessionLogOffset(0))
  assert.deepEqual(cold.snapshot.values.superCodeMemoryUsage?.rows.map(row => row.action), ['remember', 'read'])
  assert.equal(cold.checkpoint.superCodeMemoryUsage?.val.pending.length, 0)
})

test('reused IDs in later turns reject stale and failed results without losing successful history', () => {
  for (const modern of [false, true]) {
    let state = initial(), seq = 0
    for (let turn = 1; turn <= 4; turn++) {
      state = fold(state, call(seq++, turn, { action: 'read', id: `item-${turn}` }))
      const before = state
      state = fold(state, returned(seq++, turn - 1, {} , modern))
      assert.equal(state, before)
      state = fold(state, returned(seq++, turn, { scope: 'project', topic: 'build', revision: turn,
        entry: { id: `item-${turn}`, summary: `Item ${turn}` } }, modern, turn === 3))
    }
    assert.deepEqual(state.rows.map(row => row.id), ['item-1', 'item-2', 'item-4'])
    assert.equal(state.pending.length, 0)
  }
})

test('pending eviction, duplicate calls and invalid PTC data keep the bounded state contract', () => {
  let state = initial()
  for (let n = 0; n < 66; n++) state = fold(state, event(n, 'tool/call', {
    turn: 1, step: 1, callId: `call-${n}`, name: 'super_code_memory', arguments: '{"action":"read"}',
  }))
  assert.equal(state.pending.length, 64)
  assert.equal(state.pending[0]?.callId, 'call-2')
  state = fold(state, event(66, 'tool/call', { turn: 1, step: 1, callId: 'call-2', name: 'super_code_memory', arguments: '{"action":"forget","id":"gone"}' }))
  assert.equal(state.pending.length, 64)
  assert.equal(state.pending.at(-1)?.action, 'forget')
  for (const data of [{ name: 'other', arguments: {}, isError: false, content: [] },
    { name: 'super_code_memory', arguments: { action: 'read' }, content: [] },
    { name: 'super_code_memory', arguments: { action: 'read' }, isError: false, content: 'invalid' }]) {
    assert.equal(fold(state, event(67, 'tool/ptc-dispatch', data)), state)
  }
  assert.doesNotThrow(() => projection.stateSchema.parse(state))
})
