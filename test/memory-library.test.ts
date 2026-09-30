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
