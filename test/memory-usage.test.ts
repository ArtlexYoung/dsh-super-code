import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { foldMemoryUsage, memoryUsageProjection } from '../src/memory-usage-projection.js'
import type { MemoryUsageState } from '../src/memory-usage-projection.js'
import { recordedToolResult } from '../src/core/host-messages.js'
import { readToolEvidence, toolEvidenceRef, listToolEvidence } from '../src/core/tool-evidence.js'

const initial = (inherited = 0) => memoryUsageProjection.init({} as SessionHeader, inherited as SessionLogOffset)
const record = (seq: number, type: string, data: object) => ({ seq, time: seq * 1000, type, data }) as SessionEvent
const overview = { topic: 'build', revision: 2, entries: [{ id: 'test', summary: 'Run focused tests' }], details: { tool: 'super_code_memory' } }
const result = (seq: number, callId: string, value: object, isError = false, step = 1) => record(seq, 'tool/result', { turn: 1, step, message: {
  content: [{ type: 'tool-result', toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(value) }] }],
} })
const call = (seq: number, callId: string, args: object) => record(seq, 'tool/call', { turn: 1, step: 1, callId, name: 'super_code_memory', arguments: JSON.stringify(args) })

test('memory activity attributes named and legacy snapshots, not ordinary user text', () => {
  const data = { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [{ name: 'super-code:project-memory', text: JSON.stringify(overview) }] }, content: [] }
  const state = foldMemoryUsage(initial(), record(1, 'user/message', data))
  assert.equal(state.rows[0]?.action, 'context')
  assert.equal(state.rows[0]?.id, 'test')
  const legacy = foldMemoryUsage(initial(), record(2, 'user/message', { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    content: [{ type: 'text', text: `Runtime context\n\nLower priority than the current user request, conversation and project memory: ${JSON.stringify({ ...overview, topic: 'preferences' })}` }] }))
  assert.equal(legacy.rows[0]?.scope, 'global')
  assert.deepEqual(foldMemoryUsage(initial(), record(3, 'user/message', { ...data, source: { kind: 'user' } })).rows, [])
  assert.deepEqual(foldMemoryUsage(initial(4), record(3, 'user/message', data)).rows, [], 'forks do not inherit attribution')
})

test('memory activity pairs calls, ignores failed reads and only counts returned summaries', () => {
  const pending = foldMemoryUsage(initial(), call(1, 'read-1', { action: 'read' }))
  assert.deepEqual(pending.rows, [])
  assert.equal(memoryUsageProjection.wire.view(pending), memoryUsageProjection.wire.view({ ...pending, pending: [] }), 'pending changes do not republish UI')
  assert.equal(foldMemoryUsage(pending, result(2, 'read-1', { scope: 'project', ...overview }, true)).rows.length, 0)
  assert.equal(foldMemoryUsage(pending, result(2, 'read-1', { scope: 'project', ...overview }, false, 2)).rows.length, 0)
  const state = foldMemoryUsage(pending, result(2, 'read-1', { scope: 'project', ...overview, ids: ['test', 'not-returned'] }))
  assert.equal(state.rows.length, 1)
  assert.equal(state.rows[0]?.action, 'summary')
  const detail = foldMemoryUsage(foldMemoryUsage(state, call(3, 'detail', { action: 'read', id: 'test' })), result(4, 'detail', { scope: 'project', topic: 'build', revision: 2, entry: overview.entries[0] }))
  assert.deepEqual(detail.rows.map(row => row.action), ['summary', 'read'])
  assert.equal(detail.pending.length, 0)
  assert.deepEqual(foldMemoryUsage(detail, result(5, 'detail', { scope: 'project', ...overview })).rows, detail.rows, 'duplicate results are not counted twice')
})

test('writes and deletes remain distinct from reading memory', () => {
  let state = foldMemoryUsage(initial(), call(1, 'save', { action: 'remember', scope: 'global', record: { entries: overview.entries } }))
  state = foldMemoryUsage(state, result(2, 'save', { scope: 'global', topic: 'preferences', revision: 1, count: 1 }))
  state = foldMemoryUsage(state, call(3, 'remove', { action: 'forget', scope: 'global', id: 'test' }))
  state = foldMemoryUsage(state, result(4, 'remove', { scope: 'global', topic: 'preferences', revision: 2, count: 0 }))
  assert.deepEqual(state.rows.map(row => row.action), ['remember', 'forget'])
  assert.equal(JSON.stringify(memoryUsageProjection.wire.view(state)).includes('quote'), false)
})

const dispatch = (seq: number, args: object, value: object, isError = false) => record(seq, 'tool/ptc-dispatch', {
  rootCallId: 'program', parentCallId: 'program', subCallId: `program:ptc:${seq}`, name: 'super_code_memory',
  arguments: args, isError, content: [{ type: 'text', text: JSON.stringify(value) }],
})

test('PTC memory activity preserves direct-call summary, read, save and delete semantics', () => {
  const cases = [
    [{ action: 'read' }, { scope: 'project', ...overview }],
    [{ action: 'read', id: 'test' }, { scope: 'project', topic: 'build', revision: 2, entry: overview.entries[0] }],
    [{ action: 'remember', scope: 'global', record: { entries: overview.entries } }, { scope: 'global', topic: 'preferences', revision: 1 }],
    [{ action: 'forget', scope: 'global', id: 'test' }, { scope: 'global', topic: 'preferences', revision: 2 }],
  ] as const
  let nested = initial(), direct = initial()
  for (const [index, [args, value]] of cases.entries()) {
    const seq = index * 2 + 1
    direct = foldMemoryUsage(foldMemoryUsage(direct, call(seq, `native-${index}`, args)), result(seq + 1, `native-${index}`, value))
    nested = foldMemoryUsage(nested, dispatch(seq + 1, args, value))
  }
  assert.deepEqual(nested.rows, direct.rows)
  assert.deepEqual(nested.rows.map(row => row.action), ['summary', 'read', 'remember', 'forget'])
  assert.equal(nested.pending.length, 0)
  assert.doesNotThrow(() => memoryUsageProjection.stateSchema.parse(nested))
})

test('PTC failed, mismatched, malformed and inherited memory operations are not attributed', () => {
  const args = { action: 'read', scope: 'global', id: 'test' }
  const value = { scope: 'global', topic: 'preferences', revision: 1, entry: overview.entries[0] }
  for (const event of [dispatch(2, args, value, true), dispatch(2, args, { ...value, scope: 'project' }),
    dispatch(2, { action: 'topics' }, value), record(2, 'tool/ptc-dispatch', { name: 'super_code_memory' }),
    record(2, 'tool/ptc-dispatch-start', { name: 'super_code_memory', arguments: args })]) {
    assert.deepEqual(foldMemoryUsage(initial(), event).rows, [])
  }
  assert.deepEqual(foldMemoryUsage(initial(3), dispatch(2, args, value)).rows, [])
  const own = foldMemoryUsage(initial(3), dispatch(3, args, value))
  assert.equal(own.rows[0]?.action, 'read')
})

test('parallel PTC reads stay distinct and outer results do not duplicate memory activity', () => {
  const value = { scope: 'project', topic: 'build', revision: 2 }
  let state = foldMemoryUsage(initial(), dispatch(3, { action: 'read', id: 'a' }, { ...value, entry: { id: 'a', summary: 'A' } }))
  state = foldMemoryUsage(state, dispatch(4, { action: 'read', id: 'b' }, { ...value, entry: { id: 'b', summary: 'B' } }))
  state = foldMemoryUsage(state, result(5, 'program', value))
  assert.deepEqual(state.rows.map(row => row.id), ['a', 'b'])
  assert.deepEqual(foldMemoryUsage(state, dispatch(4, { action: 'read', id: 'b' }, { ...value, entry: { id: 'b', summary: 'B' } })).rows, state.rows)
})

test('long conversations keep a bounded attributable window and reject malformed payloads', () => {
  let state: MemoryUsageState = initial()
  for (let n = 0; n < 120; n++) {
    state = foldMemoryUsage(state, call(n * 2, `read-${n}`, { action: 'read', id: `m${n}` }))
    state = foldMemoryUsage(state, result(n * 2 + 1, `read-${n}`, { scope: 'project', topic: 'build', revision: 1, entry: { id: `m${n}`, summary: 'Summary' } }))
  }
  assert.equal(state.rows.length, 100); assert.equal(state.omitted, 20)
  for (let n = 0; n < 100; n++) state = foldMemoryUsage(state, call(250 + n, `pending-${n}`, { action: 'read' }))
  assert.equal(state.pending.length, 64)
  const unchanged = foldMemoryUsage(state, record(400, 'tool/call', { name: 'super_code_memory', arguments: '{invalid' }))
  assert.equal(unchanged, state)
  assert.doesNotThrow(() => memoryUsageProjection.stateSchema.parse(state))
})

test('new Harness tool-role results preserve evidence, errors and memory attribution', async () => {
  const invoked = call(1, 'new-host', { action: 'read', id: 'test' })
  const message = { role: 'tool', toolCallId: 'new-host', content: [{ type: 'text', text: JSON.stringify({ scope: 'project', topic: 'build', revision: 2, entry: overview.entries[0] }) }] }
  const returned = record(2, 'tool/result', { turn: 1, step: 1, message })
  const state = foldMemoryUsage(foldMemoryUsage(initial(), invoked), returned)
  assert.equal(state.rows[0]?.action, 'read')
  const events = [undefined, invoked, returned]
  const reference = toolEvidenceRef({ sessionId: 'session', callSeq: 1, resultSeq: 2 })
  const evidence = readToolEvidence('session', reference, seq => events[seq])
  assert.equal(evidence.kind, 'recorded')
  if (evidence.kind === 'recorded') { assert.equal(evidence.outcome, 'tool-returned'); assert.match(evidence.output, /Run focused tests/) }
  const directory = await listToolEvidence(3, 3, seq => events[seq], new AbortController().signal)
  assert.equal(directory.records.find(item => item.type === 'result')?.callId, 'new-host')
  assert.deepEqual(recordedToolResult({ ...message, isError: true }), { kind: 'record', callId: 'new-host', isError: true, texts: [message.content[0]!.text] })
  assert.deepEqual(recordedToolResult({ role: 'user', content: message.content }), { kind: 'unavailable' })
  const context = record(3, 'user/message', { source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'super-code:project-memory', text: JSON.stringify(overview) }] }, content: [] })
  assert.equal(foldMemoryUsage(state, context).rows.at(-1)?.action, 'context')
})
