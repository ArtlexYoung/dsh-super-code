import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt, renderContextSnapshot, PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { SessionStore, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents, installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { GUIDED_INSTRUCTIONS } from '../src/core/guidance.js'
import { readTeamMethod } from '../src/core/teams.js'
import plugin, { apply } from '../src/dsh/super-code.js'
import { createMemberBrief, validateMemberResult } from '../src/core/delegation.js'
import { taskMemoryProjection, taskMemoryView } from '../src/task-memory-projection.js'
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

test('guidance follows the assembled model snapshot across switches without leaking scopes', async t => {
  const h = await host({ guidedRoutes: [{ provider: 'fixture', model: 'guided' }] })
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  const selection: ModelSelectionRef = { current: { provider: 'fixture', model: 'guided' }, assembled: undefined }
  installModelSelection(h.scope.ctx, selection)
  const { scopeOf } = await import('@deepseek-ai/dsh-scope')
  const assemble = () => h.ctx.systemPrompt.assemble({ agent: h.agent, scope: scopeOf(h.scope.ctx) })
  const persona = (assembly: Awaited<ReturnType<typeof assemble>>) => assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)!.text
  const first = await assemble()
  assert.ok(persona(first).endsWith(GUIDED_INSTRUCTIONS))
  selection.current = { provider: 'fixture', model: 'standard' }
  // A mid-step UI change must not alter the model associated with this prompt.
  const request = await agentEvents(h.ctx, h.agent).waterfall('agent/request', { turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ provider: 'old', model: 'old' }))
  assert.equal(request.model, 'guided')
  assert.ok(!persona(await assemble()).includes(GUIDED_INSTRUCTIONS))
  assert.ok(!(await h.ctx.systemPrompt.assemble()).sections.some(section => section.text.includes(GUIDED_INSTRUCTIONS)))
  selection.current = { provider: 'unconfigured', model: 'guided' }
  assert.ok(!persona(await assemble()).includes(GUIDED_INSTRUCTIONS))
})

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

test('evidence action reads the installed host result format without writes or checkpoints', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  const callId = ToolCallId('evidence-call')
  const call = h.session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"npm test"}' })
  const result = h.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: '0 tests' }] }) }, { surfaceOp: 'append' })
  const before = h.session.seq
  const observed = await h.call({ action: 'evidence', record: { callSeq: call.seq, resultSeq: result.seq } })
  assert.equal(observed.isError, false, JSON.stringify(observed))
  const value = JSON.parse(observed.value as string)
  assert.equal(value.kind, 'recorded')
  assert.equal(value.acceptance, 'not-established')
  assert.equal(value.currentCode, 'not-verified')
  const replay = await h.call({ action: 'evidence', record: { ref: value.ref } })
  assert.deepEqual(JSON.parse(replay.value as string), value)
  assert.equal(h.session.seq, before)
  assert.equal((await h.call({ action: 'evidence', record: { callSeq: call.seq, resultSeq: result.seq, passed: true } })).isError, true)
  const paged = await h.call({ action: 'evidence', record: { ref: value.ref, offset: 0 } })
  assert.equal(paged.isError, false)
  assert.equal(JSON.parse(paged.value as string).outputView, 'page')
  assert.equal(JSON.parse(paged.value as string).output, '0 tests')
  assert.equal((await h.call({ action: 'evidence', record: { ref: value.ref, offset: -1 } })).isError, true)
  assert.equal(h.session.seq, before)
})

test('method recipes remain optional, read-only and scoped to the selected example', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  const before = h.session.seq
  const ordinary = await h.call({ team: 'develop', method: 'bugfix' }, 'super_code_method')
  assert.equal(ordinary.value, readTeamMethod('develop', 'bugfix'))
  const recipe = await h.call({ team: 'develop', method: 'bugfix', recipe: 'reduce' }, 'super_code_method')
  assert.equal(recipe.isError, false)
  assert.match(recipe.value as string, /Module: file:.*experiments\.js/)
  assert.match(recipe.value as string, /reduceFailure/)
  assert.doesNotMatch(recipe.value as string, /async function observe/)
  assert.equal(h.session.seq, before)
  assert.equal((await h.call({ team: 'develop', recipe: 'invented' }, 'super_code_method')).isError, true)
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
  assert.equal(assembly.sections.filter(section => section.name === PERSONA_PREFIX_SECTION).length, 1)
  assert.match(assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)!.text, /super-code/i)
  const global = await h.ctx.systemPrompt.assemble()
  assert.ok(!global.tools.some(tool => tool.name === 'super_code_task'))
  const replay = Session.create(SessionId('restored'), JSON.parse(JSON.stringify(h.session.snapshotEvents())))
  const state = h.ctx.sessionProjections.stateOf(replay, 'superCodeTasks')!
  assert.equal(state.tasks.a?.requirementsRevision, 2)
  assert.equal(state.tasks.b?.requirementsRevision, 1)
  assert.deepEqual(state.focus, { kind: 'task', id: 'a' })
  const checkpoint = h.ctx.sessionProjections.checkpoint(h.session)
  const restored = h.ctx.sessionProjections.restore(checkpoint, [], h.session.seq, h.session.header, h.session.inheritedEventCount)
  assert.deepEqual(restored.snapshot.values.superCodeTasks, taskMemoryView(state))
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

test('action contracts reject ignored fields and missing inputs before persistence', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  let checkpoints = 0
  h.ctx.on('session/flush', () => { checkpoints++ })
  await h.call({ action: 'create', record: record() })
  const seq = h.session.seq, before = checkpoints
  for (const args of [
    { action: 'create', taskId: 'ignored', record: record('b') },
    { action: 'focus', taskId: 'a', record: { next: 'silently lost' } },
    { action: 'archive', taskId: 'a' },
    { action: 'update', taskId: 'a', expectedRevision: 1 },
    { action: 'read', taskId: 'a', expectedRevision: 1 },
    { action: 'list', taskId: 'a' },
    { action: 'evidence', eventSeq: 1, record: { callSeq: 0, resultSeq: 1 } },
  ]) assert.equal((await h.call(args)).isError, true, JSON.stringify(args))
  assert.equal(h.session.seq, seq)
  assert.equal(checkpoints, before)
  assert.equal((await h.call({ action: 'read', taskId: 'a', view: 'full' })).isError, false)
})

test('unrelated events keep the task projection unchanged', () => {
  const state = emptyTaskMemory()
  const next = taskMemoryProjection.apply(state, { type: 'assistant/chunk', seq: 0, time: 0, data: {} } as never)
  assert.equal(next, state)
})

test('read defaults to recovery, full preserves sources, and neither changes focus or logs', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  h.ctx.on('session/flush', () => {})
  await h.call({ action: 'create', record: record() })
  await h.call({ action: 'create', record: record('b') })
  const before = h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks')!
  const seq = h.session.seq
  const read = await h.call({ action: 'read', taskId: 'b' })
  assert.equal(read.isError, false)
  const { current } = JSON.parse(read.value as string)
  assert.equal(current.id, 'b')
  assert.equal(current.revision, 1)
  assert.deepEqual(current.requirements.map((r: { text: string }) => r.text), ['TypeScript', 'Do not publish'])
  assert.deepEqual(current.acceptance, record('b').acceptance)
  assert.equal((read.value as string).includes(source.quote), false)
  const explicit = await h.call({ action: 'read', taskId: 'b', view: 'resume' })
  assert.deepEqual(explicit.value, read.value)
  const full = await h.call(current.details)
  assert.equal(full.isError, false)
  assert.deepEqual(JSON.parse(full.value as string), before.tasks.b)
  assert.equal((await h.call({ action: 'read', taskId: 'b', view: 'invented' })).isError, true)
  assert.equal((await h.call({ action: 'focus', taskId: 'b', view: 'full' })).isError, true)
  assert.equal((await h.call({ action: 'read', taskId: 'missing' })).isError, true)
  const controller = new AbortController(); controller.abort()
  assert.equal((await h.call({ action: 'read', taskId: 'b' }, 'super_code_task', controller.signal)).isError, true)
  assert.equal(h.session.seq, seq)
  assert.deepEqual(h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks'), before)
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
  assert.equal(first.records[0].eventSeq, archivedAt)
  assert.equal(first.done, true)
  const page2 = await h.call({ action: 'archives', eventSeq: first.nextBeforeSeq })
  assert.equal(page2.isError, false)
  assert.deepEqual(JSON.parse(page2.value as string).records, [])
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

test('unchanged updates preserve revisions and still validate sources, concurrency and durability', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  let flushes = 0, fail = false
  h.ctx.on('session/flush', () => { flushes++; if (fail) throw new Error('disk unavailable') })
  await h.call({ action: 'create', record: record() })
  const before = h.session.seq, flushed = flushes
  for (const args of [
    { action: 'focus', taskId: 'a' },
    { action: 'update', taskId: 'a', expectedRevision: 1, record: { next: '', status: 'active' } },
    { action: 'update', taskId: 'a', expectedRevision: 1, record: { goal: 'Build a', requirements: record().requirements, source } },
  ]) {
    const result = await h.call(args)
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(JSON.parse(result.value as string).unchanged, true)
  }
  assert.equal(h.session.seq, before)
  assert.equal(flushes, flushed)
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 0, record: {} })).isError, true)
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { goal: 'Build a' } })).isError, true)
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { source: { seq: 0, quote: 'invented' } } })).isError, true)
  const correction = h.user(source.quote)
  await h.call({ action: 'update', taskId: 'a', expectedRevision: 1, record: { goal: 'Build a', source: { ...source, seq: correction.seq } } })
  assert.equal(h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks')!.tasks.a!.requirementsRevision, 2)
  fail = true
  assert.equal((await h.call({ action: 'update', taskId: 'a', expectedRevision: 2, record: { next: 'Check' } })).isError, true)
  const pendingSeq = h.session.seq
  assert.equal((await h.call({ action: 'focus', taskId: 'a' })).isError, true)
  fail = false
  const retried = await h.call({ action: 'update', taskId: 'a', expectedRevision: 3, record: { next: 'Check' } })
  assert.equal(JSON.parse(retried.value as string).unchanged, true)
  assert.equal(h.session.seq, pendingSeq)
})

test('invalid task input returns bounded field diagnostics and never applies a correction', async t => {
  const h = await host()
  t.after(async () => { await h.scope.dispose(); await h.ctx.fiber.dispose() })
  h.ctx.on('session/flush', () => {})
  const invalid = await h.call({ action: 'create', record: { ...record(), acceptance: 123 } })
  assert.equal(invalid.isError, true)
  const errorText = JSON.stringify(invalid)
  assert.match(errorText, /acceptance.*invalid_type; expected array/)
  const small = await h.call({ action: 'create', record: { ...record(), acceptance: [] } })
  assert.match(JSON.stringify(small), /acceptance.*array min 1/)
  const large = await h.call({ action: 'create', record: { ...record(), title: 'PRIVATE_INPUT'.repeat(30) } })
  assert.match(JSON.stringify(large), /title.*string max 200/)
  assert.doesNotMatch(JSON.stringify(large), /PRIVATE_INPUT/)
  const many = await h.call({ action: 'create', record: {} })
  assert.match(JSON.stringify(many), /additional invalid fields omitted/)
  assert.ok(JSON.stringify(many).length < 1500)
  assert.equal(h.session.seq, 1)
  await h.call({ action: 'create', record: record() })
  const missing = await h.call({ action: 'update', taskId: 'a', record: { next: 'should not apply' } })
  assert.match(JSON.stringify(missing), /requires expectedRevision/)
  assert.equal(h.ctx.sessionProjections.stateOf(h.session, 'superCodeTasks')!.tasks.a!.next, '')
})
