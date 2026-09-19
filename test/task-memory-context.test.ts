import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTaskMemory, foldTaskMemory, requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemoryRead, taskMemorySchema } from '../src/core/task-memory.js'
import { createMemberBrief, validateMemberResult } from '../src/core/delegation.js'

const source = { seq: 2, quote: 'Original user wording. '.repeat(100) }
const task = () => taskMemorySchema.parse({
  id: 'a', title: 'Feature A', team: 'develop', depth: 'complex', workspace: '/a', sourceVersion: 'code-1',
  createdAtSeq: 3, source, goal: 'Deliver A', requirements: [
    { id: 'publish', text: 'Do not publish', source },
    { id: 'language', text: 'Use TypeScript', source },
  ], acceptance: ['Regression passes'], decisions: ['Preserve the existing interface'], next: 'Run regression',
  status: 'active', revision: 1, requirementsRevision: 1, delegationRevision: 1,
  evidence: Array.from({ length: 8 }, (_, i) => ({ kind: i === 7 ? 'assumption' : 'test', summary: `Evidence ${i}`, ref: `log:${i}`, sourceVersion: 'code-1', requirementsRevision: 1 })),
})

test('compact view retains constraints, provenance pointers and current decisions without duplicating source quotes', t => {
  const original = task()
  const state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: original })
  const serialized = taskMemoryContext(state, 32768)
  const { current } = JSON.parse(serialized)
  assert.deepEqual(current.requirements, original.requirements.map(({ id, text, source }) => ({ id, text, sourceSeq: source.seq })))
  assert.deepEqual(current.acceptance, original.acceptance)
  assert.deepEqual(current.decisions, original.decisions)
  assert.equal(current.next, original.next)
  assert.equal(current.sourceSeq, source.seq)
  assert.equal(current.revision, original.revision)
  assert.equal(serialized.includes(source.quote), false)
  assert.deepEqual(current.evidence.map((item: { summary: string }) => item.summary), ['Evidence 5', 'Evidence 6', 'Evidence 7'])
  assert.equal(current.evidence[2].kind, 'assumption')
  assert.equal(current.omittedEvidence, 5)
  assert.deepEqual(current.details, { tool: 'super_code_task', action: 'read', taskId: 'a', view: 'full' })
  assert.deepEqual(requireTaskMemory(state, 'a'), original)
  assert.equal(taskMemoryContext(state, 32768), serialized)
  const before = Buffer.byteLength(JSON.stringify({ tasks: [{ id: original.id, title: original.title, status: original.status }], recentUserEventSeqs: [], current: original }))
  const after = Buffer.byteLength(serialized)
  assert.ok(after < before)
  t.diagnostic(`Source-heavy fixture: ${before} -> ${after} context bytes; not model-token or full-history savings`)
})

test('optional evidence yields to a byte budget while hard requirements and retrieval stay intact', () => {
  const original = task()
  const state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: original })
  const full = JSON.parse(taskMemoryContext(state, 32768))
  const withoutEvidence = { ...full, current: { ...full.current, evidence: [], omittedEvidence: original.evidence.length } }
  const minBytes = Buffer.byteLength(JSON.stringify(withoutEvidence))
  const compact = taskMemoryContext(state, minBytes)
  assert.equal(Buffer.byteLength(compact), minBytes)
  assert.deepEqual(JSON.parse(compact), withoutEvidence)
  assert.throws(() => taskMemoryContext(state, minBytes - 1), /Hard requirements were not truncated/)
  assert.equal(requireTaskMemory(state, 'a').evidence.length, 8)
})

test('UTF-8 and escaped interpolation count toward the actual byte limit', () => {
  // Escapes keep the fixture source ASCII while exercising multibyte input.
  const original = taskMemorySchema.parse({ ...task(), goal: '\u4e2d\u6587 {{literal}}', evidence: [] })
  const state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: original })
  const output = taskMemoryContext(state, 32768)
  const bytes = Buffer.byteLength(output)
  assert.ok(bytes > output.length)
  assert.equal(output.includes('{{'), false)
  assert.equal(JSON.parse(output).current.goal, original.goal)
  assert.equal(taskMemoryContext(state, bytes), output)
  assert.throws(() => taskMemoryContext(state, bytes - 1), /not truncated/)
})

test('corrections, code changes and focus switches do not revive stale evidence or leak another task', () => {
  let state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: task() })
  const revised = reviseTaskMemory(requireTaskMemory(state, 'a'), {
    source: { seq: 10, quote: 'Use Rust' }, requirements: [{ id: 'language', text: 'Use Rust', source: { seq: 10, quote: 'Use Rust' } }],
  }, 1)
  state = foldTaskMemory(state, { kind: 'save', task: revised })
  const current = JSON.parse(taskMemoryContext(state, 32768)).current
  assert.deepEqual(current.evidence, [])
  assert.equal(current.omittedEvidence, 0)
  assert.equal(current.requirements[0].text, 'Do not publish')
  assert.equal(current.requirements[1].text, 'Use Rust')
  state = foldTaskMemory(state, { kind: 'save', task: { ...task(), id: 'b', title: 'Feature B', goal: 'Independent B' } })
  state = foldTaskMemory(state, { kind: 'focus', id: 'b' })
  const b = JSON.parse(taskMemoryContext(state, 32768))
  assert.equal(b.current.id, 'b')
  assert.deepEqual(b.tasks.find((item: { id: string }) => item.id === 'a'), { id: 'a', title: 'Feature A', status: 'active' })
  assert.equal(JSON.stringify(b).includes('Use Rust'), false)
  state = foldTaskMemory(state, { kind: 'save', task: reviseTaskMemory(requireTaskMemory(state, 'b'), { sourceVersion: 'code-2' }, 1) })
  assert.deepEqual(JSON.parse(taskMemoryContext(state, 32768)).current.evidence, [])
  state = foldTaskMemory(state, { kind: 'focus', id: 'a' })
  assert.deepEqual(JSON.parse(taskMemoryContext(state, 32768)).current, current)
})

test('empty and nonfocused views remain bounded and invalid budgets are rejected', () => {
  assert.equal(taskMemoryContext(emptyTaskMemory(), 1), '')
  const recent = { ...emptyTaskMemory(), recentSources: [1, 2] }
  assert.deepEqual(JSON.parse(taskMemoryContext(recent, 100)), { tasks: [], recentUserEventSeqs: [1, 2] })
  const state = { ...foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: task() }), focus: { kind: 'none' as const } }
  assert.equal(JSON.parse(taskMemoryContext(state, 200)).current, undefined)
  assert.throws(() => taskMemoryContext(state, 10), /not truncated/)
  for (const budget of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => taskMemoryContext(state, budget), /positive safe integer/)
})

test('recovery reads share the current view, preserve hard fields and never mutate stored evidence', () => {
  const original = task()
  original.evidence.push({ ...original.evidence[0]!, sourceVersion: 'old-code', summary: 'Old success' })
  const before = JSON.stringify(original)
  const state = foldTaskMemory(emptyTaskMemory(), { kind: 'save', task: original })
  const read = taskMemoryRead(original, 32768)
  const { current } = JSON.parse(read)
  assert.deepEqual(current, JSON.parse(taskMemoryContext(state, 32768)).current)
  assert.equal(current.staleEvidence, 1)
  assert.equal(current.omittedEvidence, 5)
  assert.equal(read.includes('Old success'), false)
  assert.equal(read.includes(source.quote), false)
  const withoutEvidence = { current: { ...current, evidence: [], omittedEvidence: 8 } }
  const minBytes = Buffer.byteLength(JSON.stringify(withoutEvidence))
  assert.deepEqual(JSON.parse(taskMemoryRead(original, minBytes)), withoutEvidence)
  assert.throws(() => taskMemoryRead(original, minBytes - 1), /Hard requirements were not truncated/)
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => taskMemoryRead(original, invalid), /positive safe integer/)
  assert.equal(JSON.stringify(original), before)
})

test('matching recorded versions do not certify unchanged working files or current acceptance', () => {
  const original = task()
  original.sourceVersion = 'HEAD-unchanged'
  original.evidence = [{ kind: 'test', summary: 'Passed before local edits', ref: 'old-check.log', sourceVersion: 'HEAD-unchanged', requirementsRevision: 1 }]
  const current = JSON.parse(taskMemoryRead(original, 32768)).current
  assert.equal(current.evidence.length, 1, 'recorded evidence remains available for investigation')
  assert.equal(current.evidenceBasis, 'recorded-versions; current workspace not checked')
  const changed = reviseTaskMemory(original, { sourceVersion: 'HEAD-unchanged:worktree-2' }, 1)
  const recovered = JSON.parse(taskMemoryRead(changed, 32768)).current
  assert.deepEqual(recovered.evidence, [])
  assert.equal(recovered.staleEvidence, 1)
  assert.equal(recovered.evidenceBasis, undefined)
  assert.equal(changed.evidence[0]!.summary, 'Passed before local edits')
})

test('redundant requirement fields in a real progress update preserve evidence, decisions and member validity', () => {
  const original = task()
  const assignment = { owner: 'worker', attemptId: '1', objective: 'Check interface', ownedPaths: ['a.ts'], acceptance: ['Pass'], maxTokens: 100 }
  const brief = createMemberBrief(original, 'session', assignment)
  const result = { binding: brief.binding, owner: 'worker', attemptId: '1', outcome: 'completed' as const, summary: 'Checked', artifacts: [], checks: ['interface'], unknowns: [], cost: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, toolCalls: 1, complete: true } }
  for (const fields of [{ goal: original.goal }, { workspace: original.workspace }, { acceptance: original.acceptance },
    { requirements: original.requirements }, { requirements: [] }, { removeRequirements: [] },
    { goal: ` ${original.goal} `, acceptance: original.acceptance, requirements: original.requirements }]) {
    const revised = reviseTaskMemory(original, { ...fields, source, next: 'Check the causal boundary' }, 1)
    assert.equal(revised.revision, 2)
    assert.equal(revised.requirementsRevision, 1, JSON.stringify(fields))
    assert.equal(revised.delegationRevision, 1)
    assert.deepEqual(revised.decisions, original.decisions)
    assert.deepEqual(revised.evidence, original.evidence)
    assert.equal(validateMemberResult(revised, 'session', assignment, result).reviewable, true)
  }
  const correction = { seq: 20, quote: 'Keep the goal and check another boundary' }
  for (const fields of [{ goal: original.goal, source: correction }, { acceptance: ['New check'], source },
    { requirements: [{ ...original.requirements[0]!, source: correction }], source },
    { removeRequirements: ['publish'], source }]) {
    const revised = reviseTaskMemory(original, { ...fields, next: 'Changed' }, 1)
    assert.equal(revised.requirementsRevision, 2)
    assert.deepEqual(revised.decisions, [])
    assert.equal(validateMemberResult(revised, 'session', assignment, result).reviewable, false)
  }
  for (const fields of [{ status: 'paused' as const }, { sourceVersion: 'code-2' }]) {
    const revised = reviseTaskMemory(original, { ...fields, goal: original.goal, source }, 1)
    assert.equal(revised.requirementsRevision, 1)
    assert.equal(revised.delegationRevision, 2)
    assert.equal(validateMemberResult(revised, 'session', assignment, result).reviewable, false)
  }
  const sourceOnly = reviseTaskMemory(original, { source: correction }, 1)
  assert.equal(sourceOnly.revision, 2)
  assert.equal(sourceOnly.requirementsRevision, 1)
  assert.throws(() => reviseTaskMemory(original, { goal: original.goal, next: 'Changed' }, 1), /source/)
  assert.throws(() => reviseTaskMemory(original, { next: 'Changed' }, 0), /Stale/)
  assert.throws(() => reviseTaskMemory(original, { requirements: [original.requirements[0]!, original.requirements[0]!], source }, 1), /Conflicting/)
  assert.throws(() => reviseTaskMemory(original, { removeRequirements: ['unknown'], source }, 1), /unknown/)
})
