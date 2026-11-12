import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { LongMemoryStore, memoryGlobalNamespace, memoryEntryToken } from '../src/long-memory.js'
import type { LongMemoryEntry, LongMemoryTopic } from '../src/long-memory.js'
import { MemoryLibraryReader } from '../src/dsh/memory-library.js'
import { assertActionInput, prepareMemoryRecord } from '../src/dsh/tool-contracts.js'

const workspace = memoryGlobalNamespace()
const entry = (summary = 'Keep current changes'): LongMemoryEntry => ({
  id: 'keep', kind: 'constraint', summary, detail: 'Do not overwrite unrelated work',
  source: { kind: 'user', sessionId: 'validation', eventSeq: 1, quote: 'Keep current changes' },
})
const content = (expected = '', summary = 'Manual preference'): string => JSON.stringify({
  expected, kind: 'constraint', summary, detail: 'A preference saved by the user',
})

function memoryTable(put?: (key: string, value: LongMemoryTopic) => Promise<void>) {
  const records = new Map<string, LongMemoryTopic>()
  const store = new LongMemoryStore({ get: (key: string) => records.get(key), entries: () => records.entries(),
    put: put ?? (async (key: string, value: LongMemoryTopic) => { records.set(key, value) }) } as unknown as KvTable<string, LongMemoryTopic>)
  return { records, store }
}

test('tool cursors and topics reject invalid boundaries without contaminating later requests', () => {
  for (const eventSeq of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '0']) {
    assert.throws(() => assertActionInput('super_code_task', { action: 'source', eventSeq }))
  }
  for (const eventSeq of [0, Number.MAX_SAFE_INTEGER]) {
    const input = Object.freeze({ action: 'source', eventSeq })
    assert.doesNotThrow(() => assertActionInput('super_code_task', input))
    assert.equal(input.eventSeq, eventSeq)
  }
  for (const topic of ['', '../escape', '中文', 'a'.repeat(97), null]) {
    assert.throws(() => assertActionInput('super_code_memory', { action: 'read', topic }))
  }
  for (const topic of ['a', 'a'.repeat(96), 'build.v1-test_2']) {
    assert.doesNotThrow(() => assertActionInput('super_code_memory', { action: 'read', topic }))
  }
  assert.throws(() => assertActionInput('super_code_memory', { action: 'read', scope: 'global', topic: 'preferences' }), /does not accept topic/)
  assert.doesNotThrow(() => assertActionInput('super_code_memory', { action: 'read', scope: 'global' }))
})

test('prepared memory records retain independent normalized copies after failed validation', () => {
  const input = { action: 'remember', record: { expectedRevision: 0, entries: [{
    ...entry('  Keep current changes  '), source: { kind: 'user', eventSeq: 1, quote: 'Keep current changes' },
  }] } }
  const original = structuredClone(input)
  const first = prepareMemoryRecord(input, 'one').remember!
  assert.throws(() => prepareMemoryRecord({ ...input, record: { ...input.record, entries: [] } }, 'invalid'))
  const second = prepareMemoryRecord(input, 'two').remember!
  assert.deepEqual(input, original)
  assert.equal(first.entries[0]!.summary, 'Keep current changes')
  assert.equal(first.entries[0]!.source.sessionId, 'one')
  assert.equal(second.entries[0]!.source.sessionId, 'two')
  second.entries[0]!.summary = 'Changed copy'
  assert.equal(first.entries[0]!.summary, 'Keep current changes')
})

test('queued remember validates and snapshots caller-owned entries before awaiting the writer', async () => {
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  const { records, store } = memoryTable(async (key, value) => {
    if (value.topic === 'blocker') { entered.resolve(); await released.promise }
    records.set(key, value)
  })
  const blocking = store.remember(workspace, 'blocker', 0, [entry()])
  await entered.promise
  try {
    const input = [entry('Snapshot summary')]
    const pending = store.remember(workspace, 'preferences', 0, input)
    input[0]!.summary = 'Caller changed after enqueue'
    input[0]!.source.sessionId = 'other'
    released.resolve(); await blocking
    const saved = await pending
    assert.equal(saved.entries[0]!.summary, 'Snapshot summary')
    assert.equal(saved.entries[0]!.source.sessionId, 'validation')
    assert.notEqual(saved.entries, input)
  } finally { released.resolve(); await blocking }
})

test('UI edits cannot overwrite an Agent update queued ahead of them', async t => {
  const ctx = new Context(); new SessionStore(ctx)
  t.after(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('mixed-edit'))
  const { store } = memoryTable()
  const original = await store.remember(workspace, 'preferences', 0, [entry()])
  const token = memoryEntryToken(original.entries[0]!)
  const api = new MemoryLibraryReader(ctx, store)
  const toolWrite = store.remember(workspace, 'preferences', 1, [entry('Agent updated preference')])
  const uiWrite = api.save(session.id, 'global', 'preferences', 'keep', content(token))
  await toolWrite
  assert.deepEqual(await uiWrite, { kind: 'conflict' })
  const found = await api.read(session.id, 'global', 'preferences', 'keep')
  assert.equal(found.kind, 'found')
  if (found.kind !== 'found') throw new Error('missing updated preference')
  assert.equal(found.entry.summary, 'Agent updated preference')
  assert.equal(found.entry.revision, 2)
})

test('UI deletion after an Agent deletion reports missing without adding a revision', async t => {
  const ctx = new Context(); new SessionStore(ctx)
  t.after(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('mixed-delete'))
  const { records, store } = memoryTable()
  const original = await store.remember(workspace, 'preferences', 0, [entry()])
  const api = new MemoryLibraryReader(ctx, store)
  const toolDelete = store.forget(workspace, 'preferences', 1, 'keep')
  const uiDelete = api.remove(session.id, 'global', 'preferences', 'keep', memoryEntryToken(original.entries[0]!))
  await toolDelete
  assert.deepEqual(await uiDelete, { kind: 'missing' })
  assert.deepEqual([...records.values()].map(value => [value.revision, value.entries.length]), [[2, 0]])
})

test('failed writes release the shared queue for valid UI and Agent writes', async t => {
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  const ctx = new Context(); new SessionStore(ctx)
  t.after(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('failure-isolation'))
  const { records, store } = memoryTable(async (key, value) => {
    if (value.topic === 'failed') { entered.resolve(); await released.promise; throw new Error('disk full') }
    records.set(key, value)
  })
  const api = new MemoryLibraryReader(ctx, store)
  const failed = assert.rejects(store.remember(workspace, 'failed', 0, [entry()]), /disk full/)
  await entered.promise
  try {
    const manual = api.save(session.id, 'global', 'preferences', 'manual', content())
    const tool = store.remember(workspace, 'tool', 0, [entry()])
    released.resolve(); await failed
    assert.equal((await manual).kind, 'saved')
    assert.equal((await tool).revision, 1)
    assert.deepEqual(store.read(workspace, 'failed'), { kind: 'missing' })
    assert.equal(records.size, 2)
  } finally { released.resolve(); await failed }
})

test('invalid library payloads leave persisted content and tokens intact, then valid saving recovers', async t => {
  const ctx = new Context(); new SessionStore(ctx)
  t.after(() => ctx.fiber.dispose())
  const session = ctx.sessions.create(SessionId('invalid-payload'))
  const { records, store } = memoryTable(), api = new MemoryLibraryReader(ctx, store)
  await api.save(session.id, 'global', 'preferences', 'manual', content())
  const first = await api.read(session.id, 'global', 'preferences', 'manual')
  if (first.kind !== 'found') throw new Error('missing original preference')
  const before = JSON.stringify([...records])
  for (const payload of ['{', 'null', '[]', ' '.repeat(16001),
    JSON.stringify({ expected: first.entry.token, kind: 'constraint', summary: 'Too much', detail: 'x', extra: true }),
    JSON.stringify({ expected: null, kind: 'constraint', summary: 'Invalid', detail: 'x' }),
    content('bad-token'), content(first.entry.token, 'x'.repeat(31))]) {
    await assert.rejects(api.save(session.id, 'global', 'preferences', 'manual', payload))
    assert.equal(JSON.stringify([...records]), before)
  }
  assert.equal((await api.save(session.id, 'global', 'preferences', 'manual', content(first.entry.token, 'Valid replacement'))).kind, 'saved')
  const saved = await api.read(session.id, 'global', 'preferences', 'manual')
  if (saved.kind !== 'found') throw new Error('missing saved preference')
  assert.equal(saved.entry.summary, 'Valid replacement')
  assert.notEqual(saved.entry.token, first.entry.token)
  assert.equal(saved.entry.revision, 2)
})
