import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { SessionStore, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import plugin, { apply } from '../src/dsh/super-code.js'
import { createMemberBrief, validateMemberResult } from '../src/core/delegation.js'
import { taskMemoryProjection } from '../src/task-memory-projection.js'
import { emptyTaskMemory, foldTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemorySchema } from '../src/core/task-memory.js'

const source = { seq: 0, quote: 'Build A in TypeScript; do not publish.' }
const record = (id = 'a') => ({ id, title: `Task ${id}`, team: 'develop', depth: 'complex', workspace: '/workspace', sourceVersion: 'abc123', goal: `Build ${id}`,
  source, requirements: [{ id: 'language', text: 'TypeScript', source }, { id: 'publish', text: 'Do not publish', source }], acceptance: ['Focused tests pass'] })
const task = () => taskMemorySchema.parse({ ...record(), createdAtSeq: 1, revision: 1, requirementsRevision: 1, delegationRevision: 1, status: 'active', decisions: [], evidence: [], next: '' })

async function host(config = {}) {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  const agent = {} as Agent
  const scope = createScope(ctx, agent)
  const fiber = scope.ctx.plugin(plugin, config)
  await fiber.inertia
  const session = ctx.sessions.create(SessionId(`test-${Math.random()}`))
  Object.assign(agent, { id: session.id, session, ctx: scope.ctx })
  const user = (text: string) => session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  user(source.quote)
  const call = (args: object, name = 'super_code_task', signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(`call-${Math.random()}`) })
  return { ctx, scope, session, agent, call, user }
}

test('requirement corrections preserve other constraints and invalidate old evidence', () => {
  const original = { ...task(), evidence: [{ summary: 'passed', ref: 'test.log', sourceVersion: 'abc123', requirementsRevision: 1, kind: 'test' as const }] }
  const revised = reviseTaskMemory(original, { source: { seq: 8, quote: 'Use Rust' }, requirements: [{ id: 'language', text: 'Rust', source: { seq: 8, quote: 'Use Rust' } }] }, 1)
  assert.equal(revised.requirementsRevision, 2)
  assert.equal(revised.requirements[1]?.text, 'Do not publish')
  assert.equal(original.requirements[0]?.text, 'TypeScript')
  assert.equal(revised.evidence.length, 1)
  const context = JSON.parse(taskMemoryContext(foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: revised }), 32768))
  assert.deepEqual(context.current.evidence, [])
  assert.throws(() => reviseTaskMemory(revised, { next: 'finish' }, 1), /Stale/)
  assert.throws(() => reviseTaskMemory(revised, { removeRequirements: ['publish'] }, 2), /source/)
})

test('context refuses overflow without truncating constraints and escapes host interpolation', () => {
  const state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: { ...task(), goal: 'Render {{template}} literally' } })
  assert.throws(() => taskMemoryContext(state, 20), /not truncated/)
  const output = taskMemoryContext(state, 32768)
  assert.equal(output.includes('{{'), false)
  assert.equal(JSON.parse(output).current.goal, 'Render {{template}} literally')
})

test('installed host scopes tools, logs memory, checkpoints and reconstructs A/B focus', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  const saved: unknown[] = []
  h.ctx.on('session/flush', session => { saved.push(session.snapshotEvents()) })
  const methods = await h.call({ team: 'optimize', method: 'algorithm' }, 'super_code_method')
  assert.equal(methods.isError, false, JSON.stringify(methods))
  const result = await h.call({ action: 'create', record: record() })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(saved.length, 1)
  assert.equal((await h.call({ action: 'create', record: record('b') })).isError, false)
  assert.equal((await h.call({ action: 'focus', taskId: 'b' })).isError, false)
  const correction = h.user('Use Rust for A; keep the no-publish requirement.')
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { source: { seq: correction.seq, quote: 'Use Rust for A' }, requirements: [{ id: 'language', text: 'Rust', source: { seq: correction.seq, quote: 'Use Rust for A' } }] } })).isError, false)
  await h.call({ action: 'focus', taskId: 'a' })
  const assembly = await h.ctx.systemPrompt.assemble({ agent: h.agent, scope: (await import('@deepseek-ai/dsh-scope')).scopeOf(h.scope.ctx) })
  const context = renderContextSnapshot(assembly)
  assert.match(context, /Rust/)
  assert.match(context, /Do not publish/)
  assert.ok(assembly.tools.some(tool => tool.name === 'super_code_task'))
  const global = await h.ctx.systemPrompt.assemble()
  assert.ok(!global.tools.some(tool => tool.name === 'super_code_task'))
  const replay = Session.create(SessionId('restored'), JSON.parse(JSON.stringify(h.session.snapshotEvents())))
  const state = h.ctx.sessionProjections.stateOf(replay, 'superCodeTasks')!
  assert.equal(state.tasks.a?.requirementsRevision, 2)
  assert.equal(state.tasks.b?.requirementsRevision, 1)
  assert.deepEqual(state.focus, { kind: 'task', id: 'a' })
  const checkpoint = h.ctx.sessionProjections.checkpoint(h.session)
  const restored = h.ctx.sessionProjections.restore(checkpoint, [], h.session.seq, h.session.header, h.session.inheritedEventCount)
  assert.deepEqual(restored.snapshot.values.superCodeTasks, state)
})

test('host rejects invented sources, stale writes, active archives and cancellation', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  h.ctx.on('session/flush', () => {})
  assert.equal((await h.call({ action: 'create', record: { ...record(), source: { seq: 0, quote: 'invented' } } })).isError, true)
  assert.equal(h.session.seq, 1)
  await h.call({ action: 'create', record: record() })
  const results = await Promise.all([h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { next: 'first' } }), h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { next: 'second' } })])
  assert.equal(results.filter(r => r.isError).length, 1)
  assert.equal((await h.call({ action: 'archive', taskId: 'a', expectedRevision: 2 })).isError, true)
  const controller = new AbortController(); controller.abort()
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 2, record: { status: 'completed' } }, 'super_code_task', controller.signal)).isError, true)
})

test('failed persistence is visible, retry does not append twice', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  let fail = true
  h.ctx.on('session/flush', () => { if (fail) throw new Error('disk unavailable') })
  assert.equal((await h.call({ action: 'create', record: record() })).isError, true)
  const count = h.session.seq
  fail = false
  const read = await h.call({ action: 'read', taskId: 'a' })
  assert.equal(read.isError, false, JSON.stringify(read))
  assert.equal(h.session.seq, count)
})

test('unrelated events keep the task projection unchanged', () => {
  const state = emptyTaskMemory()
  const next = taskMemoryProjection.apply(state, { type: 'assistant/chunk', seq: 0, time: 0, data: {} } as never)
  assert.equal(next, state)
})

test('global mounting is rejected before changing the default persona', () => {
  assert.throws(() => apply(new Context()), /not globally/)
})

test('working-set and context limits reject before appending records', async t => {
  const h = await host({ maxTasks: 1 })
  const small = await host({ maxContextBytes: 1024 })
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose(); await small.scope.dispose(); await small.ctx.fiber.dispose() })
  h.ctx.on('session/flush', () => {})
  small.ctx.on('session/flush', () => {})
  assert.equal((await h.call({ action: 'create', record: record() })).isError, false)
  const before = h.session.seq
  assert.equal((await h.call({ action: 'create', record: record('b') })).isError, true)
  assert.equal(h.session.seq, before)
  assert.equal((await small.call({ action: 'create', record: { ...record(), goal: 'x'.repeat(1200) } })).isError, true)
  assert.equal(small.session.seq, 1)
})

test('archives page through unrelated history and restore a new incarnation with original constraints', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  h.ctx.on('session/flush', () => {})
  await h.call({ action: 'create', record: record() })
  const original = h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks')!.tasks.a!
  const assignment = { owner: 'worker', attemptId: 'old', objective: 'Implement', ownedPaths: ['a.ts'], acceptance: ['pass'], maxTokens: 100 }
  const brief = createMemberBrief(original, h.session.id, assignment)
  await h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { status: 'completed' } })
  const archivedAt = h.session.seq
  assert.equal((await h.call({ action: 'archive', taskId: 'a', expectedRevision: 2 })).isError, false)
  for (let i = 0; i < 260; i++) h.user(`Other task ${i}`)
  const page1 = await h.call({ action: 'archives' })
  assert.equal(page1.isError, false)
  const first = JSON.parse(page1.value as string)
  assert.deepEqual(first.records, [])
  assert.equal(first.done, false)
  const page2 = await h.call({ action: 'archives', eventSeq: first.nextBeforeSeq })
  assert.equal(page2.isError, false)
  assert.equal(JSON.parse(page2.value as string).records[0].eventSeq, archivedAt)
  const correction = h.user('Resume A, keeping its constraints.')
  assert.equal((await h.call({ action: 'restore', eventSeq: archivedAt, record: { source, sourceVersion: 'new-code' } })).isError, true)
  const restored = await h.call({ action: 'restore', eventSeq: archivedAt, record: { source: { seq: correction.seq, quote: 'Resume A' }, sourceVersion: 'new-code' } })
  assert.equal(restored.isError, false, JSON.stringify(restored))
  const current = h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks')!.tasks.a!
  assert.deepEqual(current.requirements, original.requirements)
  assert.ok(current.createdAtSeq > original.createdAtSeq)
  assert.equal(current.requirementsRevision, 2)
  assert.equal(validateMemberResult(current, h.session.id, assignment, { binding: brief.binding, owner: 'worker', attemptId: 'old', outcome: 'completed', summary: 'old', artifacts: [], checks: [], unknowns: [], cost: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, toolCalls: 0, complete: true } }).reviewable, false)
  assert.equal((await h.call({ action: 'restore', eventSeq: archivedAt, record: { source: { seq: correction.seq, quote: 'Resume A' }, sourceVersion: 'new-code' } })).isError, true)
})
