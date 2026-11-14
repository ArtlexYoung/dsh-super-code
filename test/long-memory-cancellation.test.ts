import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import plugin from '../src/dsh/super-code.js'
import { LongMemoryStore, memoryWorkspace } from '../src/long-memory.js'
import type { LongMemoryTopic } from '../src/long-memory.js'
import { installTaskMemory } from './task-memory-fixture.js'

test('unavailable task storage does not block global memory or explicit project reads', async t => {
  const records = new Map<string, LongMemoryTopic>()
  const store = new LongMemoryStore({ get: (key: string) => records.get(key), entries: () => records.entries(),
    put: async (key: string, value: LongMemoryTopic) => { records.set(key, value) },
  } as unknown as KvTable<string, LongMemoryTopic>)
  const ctx = new Context(); new SystemPrompt(ctx, {}); new ToolRuntime(ctx); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
  ctx.provide('superCodeLongMemory', store)
  const agent = {} as Agent, scope = createScope(ctx, agent)
  t.after(async () => { await scope.dispose(); await ctx.fiber.dispose() })
  await scope.ctx.plugin(plugin)
  const session = ctx.sessions.create(SessionId('task-storage-unavailable'), { meta: { cwd: tmpdir() } })
  Object.assign(agent, { id: session.id, session, ctx: scope.ctx })
  ctx.on('session/flush', () => {})
  const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use concise answers' }] }), { surfaceOp: 'append' })
  const call = (args: object) => ctx.tools.execute({ name: 'super_code_memory', arguments: args, agent,
    signal: new AbortController().signal, callId: ToolCallId(`memory-${Math.random()}`) })
  const saved = await call({ action: 'remember', scope: 'global', record: { expectedRevision: 0, globalConfirmed: true,
    entries: [{ id: 'concise', kind: 'constraint', summary: 'Concise answers', detail: 'Use concise answers',
      source: { kind: 'user', eventSeq: user.seq, quote: 'Use concise answers' } }],
  } })
  assert.equal(saved.isError, false, JSON.stringify(saved))
  const read = await call({ action: 'read', scope: 'global', id: 'concise' })
  assert.equal(read.isError, false, JSON.stringify(read))
  assert.equal(JSON.parse(read.value as string).entry.id, 'concise')
  for (const args of [{ action: 'topics' }, { action: 'read', topic: 'explicit' }]) {
    const result = await call(args)
    assert.equal(result.isError, false, JSON.stringify(result))
  }
  assert.equal((await call({ action: 'read' })).isError, true, 'Implicit project reads still require task focus')
})

for (const action of ['remember', 'forget'] as const) {
  test(`cancelling ${action} while another memory write is pending preserves the original entry`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'super-code-memory-cancel-'))
    const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
    const records = new Map<string, LongMemoryTopic>()
    const store = new LongMemoryStore({ get: (key: string) => records.get(key), entries: () => records.entries(),
      put: async (key: string, value: LongMemoryTopic) => {
        if (value.topic === 'blocker') { entered.resolve(); await released.promise }
        records.set(key, value)
      },
    } as unknown as KvTable<string, LongMemoryTopic>)
    const ctx = new Context(); new SystemPrompt(ctx, {}); new ToolRuntime(ctx); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
    await installTaskMemory(ctx)
    ctx.provide('superCodeLongMemory', store)
    const agent = {} as Agent, scope = createScope(ctx, agent)
    t.after(async () => { released.resolve(); await scope.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
    await scope.ctx.plugin(plugin)
    const session = ctx.sessions.create(SessionId(`cancel-${action}`), { meta: { cwd: root } })
    Object.assign(agent, { id: session.id, session, ctx: scope.ctx })
    ctx.on('session/flush', () => {})
    const user = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preserve this constraint' }] }), { surfaceOp: 'append' })
    const source = { seq: user.seq, quote: 'Preserve this constraint' }
    const call = (name: string, args: object, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(`${action}-${Math.random()}`) })
    const created = await call('super_code_task', { action: 'create', record: { id: 'task', title: 'Task', team: 'develop', depth: 'complex', workspace: root,
      sourceVersion: 'v1', goal: 'Preserve this constraint', source, requirements: [], acceptance: ['Preserved'], topic: 'target' } })
    assert.equal(created.isError, false, JSON.stringify(created))
    const entry = { id: 'kept', kind: 'constraint' as const, summary: 'Original', detail: 'Original detail', source: { kind: 'user' as const, sessionId: session.id, eventSeq: user.seq, quote: source.quote } }
    const workspace = memoryWorkspace(session)
    const before = await store.remember(workspace, 'target', 0, [entry])
    const blocking = store.remember(workspace, 'blocker', 0, [entry])
    await entered.promise
    const controller = new AbortController()
    const pending = call('super_code_memory', action === 'remember'
      ? { action, record: { expectedRevision: 1, entries: [{ ...entry, summary: 'Changed', source: { kind: 'user', eventSeq: user.seq, quote: source.quote } }] } }
      : { action, id: entry.id, record: { expectedRevision: 1, source } }, controller.signal)
    // Let the real tool complete its source checkpoint and queue at the store.
    await setImmediate()
    controller.abort(); released.resolve(); await blocking
    assert.equal((await pending).isError, true)
    // A subsequent accepted write also proves the cancelled queue item settled.
    await store.remember(workspace, 'another', 0, [entry])
    assert.deepEqual(store.read(workspace, 'target'), { kind: 'found', value: before })
    assert.equal(store.read(workspace, 'another').kind, 'found')
  })
}
