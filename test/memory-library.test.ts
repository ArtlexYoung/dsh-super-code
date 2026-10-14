import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { LongMemoryStore, memoryWorkspace, memoryGlobalNamespace } from '../src/long-memory.js'
import type { LongMemoryTopic } from '../src/long-memory.js'
import { MemoryLibraryReader } from '../src/dsh/memory-library.js'

test('library scopes follow host sessions; index omits details and source quotes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-library-'))
  const ctx = new Context(); new SessionStore(ctx)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'other'))
  const a = ctx.sessions.create(SessionId('library-a'), { meta: { cwd: root } })
  const b = ctx.sessions.create(SessionId('library-b'), { meta: { cwd: join(root, 'other') } })
  const data = new Map<string, LongMemoryTopic>()
  const store = new LongMemoryStore({ get: (key: string) => data.get(key), entries: () => data.entries(),
    put: async (key: string, value: LongMemoryTopic) => { data.set(key, value) } } as unknown as KvTable<string, LongMemoryTopic>)
  const saved = { id: 'test', kind: 'constraint' as const, summary: 'Keep user edits', detail: 'Full detail',
    source: { kind: 'user' as const, sessionId: a.id, eventSeq: 1, quote: 'Private source quote' } }
  await store.remember(memoryWorkspace(a), 'coding', 0, [saved])
  await store.remember(memoryGlobalNamespace(), 'preferences', 0, [saved])
  const api = new MemoryLibraryReader(ctx, store)
  assert.equal((await api.list(a.id, 'project')).items.length, 1)
  assert.equal((await api.list(b.id, 'project')).items.length, 0)
  assert.equal((await api.list(b.id, 'global')).items.length, 1)
  assert.equal(JSON.stringify(await api.list(a.id, 'project')).includes('Full detail'), false)
  const detail = await api.read(a.id, 'project', 'coding', 'test')
  assert.equal(detail.kind, 'found')
  assert.equal(JSON.stringify(detail).includes('Private source quote'), false)
  assert.deepEqual(await api.read(b.id, 'project', 'coding', 'test'), { kind: 'missing' })
  await assert.rejects(() => api.list('unknown', 'project'), /existing conversation/)
  await assert.rejects(() => api.list(a.id, root))
  await assert.rejects(() => api.read(a.id, 'global', 'coding', 'test'), /Invalid global/)
  await assert.rejects(() => api.read(a.id, 'project', '../../secret', 'test'))
  const requested: string[] = []
  ctx.provide('sessionPersistence', { stat: async (id: string) => { requested.push(id); return id === 'archived' ? { header: { cwd: root } } : undefined } })
  assert.equal((await api.list('archived', 'project')).items.length, 1)
  assert.equal((await api.read('archived', 'project', 'coding', 'test')).kind, 'found')
  assert.equal(ctx.sessions.get(SessionId('archived')), undefined, 'Browsing must not resume an Agent')
  await assert.rejects(() => api.list('missing-archive', 'global'), /existing conversation/)
  assert.deepEqual(requested, ['archived', 'archived', 'missing-archive'])
})

test('manual library CRUD is scoped, preserves unrelated entries, and never creates history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-crud-'))
  const ctx = new Context(); new SessionStore(ctx)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'other'))
  const a = ctx.sessions.create(SessionId('manual-a'), { meta: { cwd: root } })
  const b = ctx.sessions.create(SessionId('manual-b'), { meta: { cwd: join(root, 'other') } })
  const data = new Map<string, LongMemoryTopic>()
  let failWrite = false
  const store = new LongMemoryStore({ get: (key: string) => data.get(key), entries: () => data.entries(),
    put: async (key: string, value: LongMemoryTopic) => { if (failWrite) throw new Error('disk full'); data.set(key, value) } } as unknown as KvTable<string, LongMemoryTopic>)
  const api = new MemoryLibraryReader(ctx, store)
  const content = (expected = '', summary = 'Manual title', kind = 'constraint') => JSON.stringify({ expected, summary, kind, detail: 'Saved by the user' })
  assert.equal((await api.save(a.id, 'project', 'notes', 'manual', content())).kind, 'saved')
  let read = await api.read(a.id, 'project', 'notes', 'manual')
  assert.equal(read.kind, 'found')
  if (read.kind !== 'found') throw new Error('missing manual entry')
  assert.deepEqual(read.entry.source, { kind: 'manual', sessionId: a.id })
  assert.equal(read.entry.sourceVersion, undefined)
  const token = read.entry.token
  assert.equal((await api.save(a.id, 'project', 'notes', 'manual', content())).kind, 'conflict', 'create never overwrites an occupied id')
  assert.equal((await api.save(a.id, 'project', 'notes', 'other', content('', 'Another entry'))).kind, 'saved')
  assert.equal((await api.save(a.id, 'project', 'notes', 'manual', content(token, 'Edited fact', 'fact'))).kind, 'saved', 'editing permits unrelated entry changes')
  assert.equal((await api.save(a.id, 'project', 'notes', 'manual', content(token, 'Stale change'))).kind, 'conflict')
  assert.equal((await api.remove(a.id, 'project', 'notes', 'manual', token)).kind, 'conflict')
  read = await api.read(a.id, 'project', 'notes', 'manual')
  if (read.kind !== 'found') throw new Error('missing edited entry')
  assert.equal(read.entry.summary, 'Edited fact'); assert.equal(read.entry.kind, 'fact')
  assert.equal((await api.list(b.id, 'project')).items.length, 0)
  assert.equal((await api.remove(b.id, 'project', 'notes', 'manual', read.entry.token)).kind, 'missing')
  failWrite = true
  await assert.rejects(() => api.save(a.id, 'project', 'notes', 'manual', content(read.kind === 'found' ? read.entry.token : '', 'Failed save')), /disk full/)
  failWrite = false
  assert.equal((await api.remove(a.id, 'project', 'notes', 'manual', read.entry.token)).kind, 'removed')
  assert.equal((await api.read(a.id, 'project', 'notes', 'manual')).kind, 'missing')
  assert.equal((await api.remove(a.id, 'project', 'notes', 'manual', read.entry.token)).kind, 'missing')
  assert.deepEqual((await api.list(a.id, 'project')).items.map(item => item.id), ['other'])
  assert.equal(data.size, 1, 'all saves and removals update the one current topic record')
  assert.doesNotMatch(JSON.stringify([...data.values()]), /Edited fact|Manual title|Failed save/)
  await assert.rejects(() => api.save(a.id, 'global', 'notes', 'global', content()), /Invalid global/)
  await assert.rejects(() => api.save(a.id, 'global', 'preferences', 'global', content('', 'Not a preference', 'fact')), /only user preferences/)
  assert.equal((await api.save(a.id, 'global', 'preferences', 'global', content())).kind, 'saved')
  assert.equal((await api.list(b.id, 'global')).items.length, 1)
  await assert.rejects(() => api.save('unknown', 'global', 'preferences', 'x', content()), /existing conversation/)
  await assert.rejects(() => api.save(a.id, 'project', '../../escape', 'x', content()))
  await assert.rejects(() => api.save(a.id, 'project', 'notes', 'x', content('', 'x'.repeat(31))))
  await assert.rejects(() => api.save(a.id, 'project', 'notes', 'x', JSON.stringify({ expected: '', kind: 'fact', summary: 'x', detail: 'x', sourceVersion: 'fake' })))
})

test('manual saves serialize double clicks and enforce the existing topic capacity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-capacity-'))
  const ctx = new Context(); new SessionStore(ctx)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const session = ctx.sessions.create(SessionId('capacity'), { meta: { cwd: root } })
  const data = new Map<string, LongMemoryTopic>()
  const store = new LongMemoryStore({ get: (key: string) => data.get(key), entries: () => data.entries(),
    put: async (key: string, value: LongMemoryTopic) => { await new Promise(resolve => setTimeout(resolve, 1)); data.set(key, value) } } as unknown as KvTable<string, LongMemoryTopic>)
  const api = new MemoryLibraryReader(ctx, store)
  const content = JSON.stringify({ expected: '', kind: 'experience', summary: 'User experience', detail: 'Current content' })
  const concurrent = await Promise.all([api.save(session.id, 'project', 'notes', 'same', content), api.save(session.id, 'project', 'notes', 'same', content)])
  assert.deepEqual(concurrent.map(result => result.kind), ['saved', 'conflict'])
  for (let index = 1; index < 20; index++) assert.equal((await api.save(session.id, 'project', 'notes', `n${index}`, content)).kind, 'saved')
  assert.equal((await api.save(session.id, 'project', 'notes', 'overflow', content)).kind, 'full')
  assert.equal((await api.list(session.id, 'project')).items.length, 20)
  ctx.provide('sessionPersistence', { stat: async () => ({ header: { cwd: root } }) })
  const archived = await api.read('archived', 'project', 'notes', 'same')
  if (archived.kind !== 'found') throw new Error('missing archived entry')
  assert.equal((await api.remove('archived', 'project', 'notes', 'same', archived.entry.token)).kind, 'removed')
  assert.equal(ctx.sessions.get(SessionId('archived')), undefined, 'manual maintenance must not resume an Agent')
})
