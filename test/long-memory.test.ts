import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import harnessPlugin from '../src/index.js'
import agentPlugin from '../src/dsh/super-code.js'
import { LongMemoryStore, longMemoryContext, memoryWorkspace, memoryGlobalNamespace, GLOBAL_PREFERENCES_TOPIC } from '../src/long-memory.js'
import type { LongMemoryTopic } from '../src/long-memory.js'

async function fixture(existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'super-code-memory-'))
  const workA = join(root, 'project-a'), workB = join(root, 'project-b')
  await mkdir(workA, { recursive: true }); await mkdir(workB, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  assert.ok(ctx.get('storageDomain'), 'storage domain must be ready before the host plugin')
  new SessionStore(ctx); new SessionProjectionRegistry(ctx); new SystemPrompt(ctx, {}); new ToolRuntime(ctx)
  await ctx.plugin(harnessPlugin)
  await ctx.inject(['superCodeLongMemory'], () => {})
  const store = ctx.get('superCodeLongMemory') as LongMemoryStore | undefined
  assert.ok(store, 'host plugin must publish the long-memory service')
  const close = async () => { await ctx.fiber.dispose() }
  return { ctx, store, root, workA, workB, close }
}

test('topic records are shared across sessions in one project and isolated from another', async t => {
  const f = await fixture(); t.after(async () => { await f.close(); await rm(f.root, { recursive: true, force: true }) })
  const first = f.ctx.sessions.create(SessionId('first'), { meta: { cwd: f.workA } })
  const same = f.ctx.sessions.create(SessionId('same'), { meta: { cwd: f.workA } })
  const other = f.ctx.sessions.create(SessionId('other'), { meta: { cwd: f.workB } })
  const a = memoryWorkspace(first), b = memoryWorkspace(other)
  assert.equal(memoryWorkspace(same), a)
  assert.notEqual(a, b)
  const entry = { id: 'preserve-edits', kind: 'constraint' as const, summary: 'Preserve user edits',
    detail: 'Preserve fields changed by the user during preset upgrades.',
    source: { sessionId: first.id, eventSeq: 0, kind: 'user' as const, quote: 'Preserve user edits' } }
  const saved = await f.store.remember(a, 'preset-install', 0, [entry])
  assert.equal(saved.revision, 1)
  assert.equal(f.store.read(memoryWorkspace(same), 'preset-install').kind, 'found')
  assert.deepEqual(f.store.read(b, 'preset-install'), { kind: 'missing' })
  assert.deepEqual(f.store.topics(b), [])
  assert.match(longMemoryContext(saved), /historical/)
  await assert.rejects(f.store.remember(a, 'preset-install', 0, [entry]), /Stale/)
  assert.throws(() => f.store.remember(a, 'preset-install', 1, [{ ...entry, summary: 'x'.repeat(31) }]), /Summary exceeds/)
  assert.deepEqual(f.store.read(a, 'preset-install'), { kind: 'found', value: saved })
  assert.equal((await f.store.forget(a, 'preset-install', 1, entry.id)).entries.length, 0)
  await f.close()
  const reopened = await fixture(f.root)
  assert.deepEqual(reopened.store.read(a, 'preset-install'), { kind: 'found', value: { ...saved, revision: 2, entries: [] } })
  await reopened.close()
})

test('agent tool validates sources and injects only a bound topic into another session', async t => {
  const f = await fixture(); t.after(async () => { await f.close(); await rm(f.root, { recursive: true, force: true }) })
  const stopFlush = f.ctx.on('session/flush', () => {})
  const makeAgent = async (id: string, cwd: string) => {
    const agent = {} as Agent
    const scope = createScope(f.ctx, agent)
    const fiber = scope.ctx.plugin(agentPlugin)
    await fiber.inertia
    const session = f.ctx.sessions.prepare(SessionId(id), { meta: { cwd } })
    const detach = f.ctx.sessions.enter(session)
    f.ctx.sessions.announce(session)
    Object.assign(agent, { id: session.id, session, ctx: scope.ctx })
    const user = (message: string) => session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: message }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const call = (name: string, args: object) => f.ctx.tools.execute({ name, arguments: args, agent,
      signal: new AbortController().signal, callId: ToolCallId(`${id}-${Math.random()}`) })
    return { agent, session, scope, detach, user, call }
  }
  const one = await makeAgent('one', f.workA)
  t.after(() => one.scope.dispose())
  assert.ok(!(await f.ctx.systemPrompt.assemble()).tools.some(tool => tool.name === 'super_code_memory'))
  const source = one.user('Preserve user edits during upgrades.')
  const created = await one.call('super_code_task', { action: 'create', record: {
    id: 'install', title: 'Install', team: 'develop', depth: 'complex', workspace: f.workA,
    sourceVersion: 'code-a', goal: 'Upgrade preset', source: { seq: source.seq, quote: 'Preserve user edits' },
    requirements: [], acceptance: ['Upgrade succeeds'], topic: 'preset-install',
    keyPoints: [{ kind: 'decision', summary: 'Keep edited fields' }],
  } })
  assert.equal(created.isError, false, JSON.stringify(created))
  const remember = (quote: string) => one.call('super_code_memory', { action: 'remember', record: { expectedRevision: 0,
    entries: [{ id: 'edits', kind: 'constraint', summary: 'Preserve user edits', detail: 'During preset upgrades.',
      source: { kind: 'user', eventSeq: source.seq, quote } }],
  } })
  assert.equal((await remember('invented')).isError, true)
  assert.equal((await remember('Preserve user edits')).isError, false)
  const liveSource = await one.call('super_code_memory', { action: 'read', id: 'edits' })
  assert.equal(JSON.parse(liveSource.value as string).sourceAvailability, 'available')
  const callId = ToolCallId('checked-upgrade')
  const toolCall = one.session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"npm test"}' })
  const toolResult = one.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
    callId, isError: false, content: [{ type: 'text', text: 'Tests passed' }],
  }) }, { surfaceOp: 'append' })
  const fact = await one.call('super_code_memory', { action: 'remember', record: { expectedRevision: 1, entries: [{
    id: 'current-fact', kind: 'fact', summary: 'Upgrade path checked', detail: 'The recorded npm test call returned Tests passed.',
    source: { kind: 'tool', callSeq: toolCall.seq, eventSeq: toolResult.seq }, sourceVersion: 'code-a',
  }] } })
  assert.equal(fact.isError, false, JSON.stringify(fact))
  assert.equal((await one.call('super_code_memory', { action: 'remember', record: { expectedRevision: 2, entries: [{
    id: 'stale-fact', kind: 'fact', summary: 'Old path works', detail: 'Stale source.',
    source: { kind: 'tool', callSeq: toolCall.seq, eventSeq: toolResult.seq }, sourceVersion: 'code-b',
  }] } })).isError, true)
  const liveToolSource = await one.call('super_code_memory', { action: 'read', id: 'current-fact' })
  assert.equal(JSON.parse(liveToolSource.value as string).sourceAvailability, 'available')
  stopFlush()
  const rejectedWithoutCheckpoint = await one.call('super_code_memory', { action: 'remember', record: { expectedRevision: 2,
    entries: [{ id: 'blocked', kind: 'constraint', summary: 'Blocked by flush', detail: 'Should not be stored.',
      source: { kind: 'user', eventSeq: source.seq, quote: 'Preserve user edits' } }] } })
  assert.equal(rejectedWithoutCheckpoint.isError, true)
  assert.equal((f.store.read(memoryWorkspace(one.session), 'preset-install') as { kind: 'found'; value: LongMemoryTopic }).value.revision, 2)
  const stopFailedFlush = f.ctx.on('session/flush', () => { throw new Error('disk unavailable') })
  const rejectedOnFailure = await one.call('super_code_memory', { action: 'forget', id: 'edits',
    record: { expectedRevision: 2, source: { seq: source.seq, quote: 'Preserve user edits' } } })
  assert.equal(rejectedOnFailure.isError, true)
  const afterFailure = f.store.read(memoryWorkspace(one.session), 'preset-install')
  assert.equal(afterFailure.kind, 'found')
  if (afterFailure.kind === 'found') assert.deepEqual(afterFailure.value.entries.map(entry => entry.id), ['edits', 'current-fact'])
  stopFailedFlush()
  f.ctx.on('session/flush', () => {})
  const two = await makeAgent('two', f.workA)
  t.after(() => two.scope.dispose())
  const otherSource = two.user('Continue preset install.')
  const createdTwo = await two.call('super_code_task', { action: 'create', record: {
    id: 'install-next', title: 'Install next', team: 'develop', depth: 'complex', workspace: f.workA,
    sourceVersion: 'code-b', goal: 'Continue upgrade', source: { seq: otherSource.seq, quote: 'Continue preset install' },
    requirements: [], acceptance: ['Continues'], topic: 'preset-install',
  } })
  assert.equal(createdTwo.isError, false, JSON.stringify(createdTwo))
  const context = renderContextSnapshot(await f.ctx.systemPrompt.assemble({ agent: two.agent, scope: scopeOf(two.scope.ctx) }))
  assert.match(context, /Preserve user edits/)
  assert.doesNotMatch(context, /Upgrade path checked/)
  assert.match(context, /staleFacts/)
  assert.doesNotMatch(context, /During preset upgrades/)
  const detail = await two.call('super_code_memory', { action: 'read', id: 'edits' })
  assert.equal(detail.isError, false, JSON.stringify(detail))
  assert.match(detail.value as string, /During preset upgrades/)
  assert.equal(JSON.parse(detail.value as string).sourceAvailability, 'available')
  const workspace = memoryWorkspace(one.session)
  const extra = Array.from({ length: 18 }, (_, index) => ({ id: `extra-${String(index).padStart(2, '0')}`,
    kind: 'constraint' as const, summary: `Extra ${index}`, detail: 'A stored detail.',
    source: { sessionId: one.session.id, eventSeq: source.seq, kind: 'user' as const, quote: 'Preserve user edits' } }))
  for (let offset = 0, revision = 2; offset < extra.length; offset += 8, revision++) {
    await f.store.remember(workspace, 'preset-install', revision, extra.slice(offset, offset + 8))
  }
  const overview = await two.call('super_code_memory', { action: 'read' })
  assert.equal(overview.isError, false, JSON.stringify(overview))
  const overviewValue = JSON.parse(overview.value as string) as { ids: string[]; entries: { id: string }[] }
  assert.equal(overviewValue.ids.length, 20)
  assert.equal(new Set(overviewValue.ids).size, 20)
  assert.equal(overviewValue.entries.length, 4)
  assert.ok(Buffer.byteLength(overview.value as string, 'utf8') <= 8192)
  const sample = extra[0]!
  for (let index = 0; index < 20; index++) {
    await f.store.remember(workspace, `other-${String(index).padStart(2, '0')}`, 0, [{ ...sample, id: `other-entry-${index}` }])
  }
  const firstTopics = await two.call('super_code_memory', { action: 'topics' })
  assert.equal(firstTopics.isError, false, JSON.stringify(firstTopics))
  const firstPage = JSON.parse(firstTopics.value as string) as { topics: { topic: string }[]; total: number; nextOffset: number }
  assert.equal(firstPage.topics.length, 20)
  assert.equal(firstPage.total, 21)
  assert.equal(firstPage.nextOffset, 20)
  const secondTopics = await two.call('super_code_memory', { action: 'topics', record: { offset: firstPage.nextOffset } })
  assert.equal(secondTopics.isError, false, JSON.stringify(secondTopics))
  const secondPage = JSON.parse(secondTopics.value as string) as { topics: { topic: string }[]; nextOffset?: number }
  assert.equal(secondPage.topics.length, 1)
  assert.equal(secondPage.nextOffset, undefined)
  assert.equal(new Set([...firstPage.topics, ...secondPage.topics].map(item => item.topic)).size, 21)
  assert.equal((await two.call('super_code_memory', { action: 'topics', record: { offset: -1 } })).isError, true)
  one.detach()
  const detached = await two.call('super_code_memory', { action: 'read', id: 'edits' })
  assert.equal(JSON.parse(detached.value as string).sourceAvailability, 'session-not-live')
  let failTaskFlush = false
  f.ctx.on('session/flush', () => { if (failTaskFlush) throw new Error('task checkpoint failed') })
  failTaskFlush = true
  const failedTaskUpdate = await two.call('super_code_task', { action: 'update', taskId: 'install-next', expectedRevision: 1,
    record: { next: 'Checkpoint pending' } })
  assert.equal(failedTaskUpdate.isError, true)
  const pendingContext = renderContextSnapshot(await f.ctx.systemPrompt.assemble({ agent: two.agent, scope: scopeOf(two.scope.ctx) }))
  assert.match(pendingContext, /checkpoint is unconfirmed/)
  assert.doesNotMatch(pendingContext, /Preserve user edits/)
  failTaskFlush = false
  assert.equal((await two.call('super_code_task', { action: 'read', taskId: 'install-next' })).isError, false)
})

test('concurrent topic creation checks the latest revision and a failed write remains absent', async () => {
  const records = new Map<string, LongMemoryTopic>()
  let fail = true
  const table = { get: (key: string) => records.get(key), entries: () => records.entries(),
    put: async (key: string, value: LongMemoryTopic) => { if (fail) throw new Error('disk unavailable'); records.set(key, value) },
  } as KvTable<string, LongMemoryTopic>
  const store = new LongMemoryStore(table)
  const entry = { id: 'rule', kind: 'constraint' as const, summary: 'Keep edits', detail: 'Keep user edits.',
    source: { sessionId: 's', eventSeq: 0, kind: 'user' as const, quote: 'Keep edits' } }
  await assert.rejects(store.remember('a'.repeat(64), 'install', 0, [entry]), /disk unavailable/)
  assert.deepEqual(store.read('a'.repeat(64), 'install'), { kind: 'missing' })
  fail = false
  const results = await Promise.allSettled([
    store.remember('a'.repeat(64), 'install', 0, [entry]),
    store.remember('a'.repeat(64), 'install', 0, [{ ...entry, id: 'other' }]),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.equal(store.read('a'.repeat(64), 'install').kind, 'found')
})

test('global preferences cross projects, reject unsourced promotion and persist under host storage', async t => {
  const f = await fixture()
  t.after(async () => { await f.close(); await rm(f.root, { recursive: true, force: true }) })
  f.ctx.on('session/flush', () => {})
  const makeAgent = async (id: string, cwd: string) => {
    const agent = {} as Agent
    const scope = createScope(f.ctx, agent)
    await scope.ctx.plugin(agentPlugin)
    const session = f.ctx.sessions.create(SessionId(id), { meta: { cwd } })
    Object.assign(agent, { id: session.id, session, ctx: scope.ctx })
    const call = (args: object) => f.ctx.tools.execute({ name: 'super_code_memory', arguments: args, agent,
      signal: new AbortController().signal, callId: ToolCallId(`${id}-${Math.random()}`) })
    t.after(() => scope.dispose())
    return { agent, session, scope, call }
  }
  const first = await makeAgent('global-first', f.workA)
  const source = first.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Across all projects, use concise Chinese replies.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const request = { action: 'remember', scope: 'global', record: { expectedRevision: 0, globalConfirmed: true,
    entries: [{ id: 'language', kind: 'constraint', summary: 'Use concise Chinese', detail: 'Use concise Chinese replies across all projects.',
      source: { kind: 'user', eventSeq: source.seq, quote: 'Across all projects, use concise Chinese replies.' } }],
  } }
  assert.equal((await first.call({ ...request, record: { ...request.record, globalConfirmed: false } })).isError, true)
  assert.equal((await first.call({ ...request, record: { ...request.record,
    entries: [{ ...request.record.entries[0], source: { kind: 'user', eventSeq: source.seq, quote: 'invented' } }] } })).isError, true)
  assert.equal((await first.call(request)).isError, false)
  const global = f.store.read(memoryGlobalNamespace(), GLOBAL_PREFERENCES_TOPIC)
  assert.equal(global.kind, 'found')
  assert.deepEqual(f.store.topics(memoryWorkspace(first.session)), [])
  const second = await makeAgent('global-second', f.workB)
  const view = renderContextSnapshot(await f.ctx.systemPrompt.assemble({ agent: second.agent, scope: scopeOf(second.scope.ctx) }))
  assert.match(view, /Use concise Chinese/)
  assert.match(view, /Lower priority than the current user request/)
  assert.equal((await second.call({ action: 'read', scope: 'global', id: 'language' })).isError, false)
  assert.equal((await second.call({ action: 'read', id: 'language' })).isError, true)
  const directory = await readdir(join(f.root, 'storage'))
  assert.ok(directory.some(name => name.startsWith('super_code_memory')), 'memory belongs to host storage, not the plugin package')
  await f.close()
  const reopened = await fixture(f.root)
  assert.equal(reopened.store.read(memoryGlobalNamespace(), GLOBAL_PREFERENCES_TOPIC).kind, 'found')
  await reopened.close()
})
