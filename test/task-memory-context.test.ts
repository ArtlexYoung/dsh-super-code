import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTaskMemory, foldTaskMemory, requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemorySchema } from '../src/core/task-memory.js'

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
  assert.deepEqual(current.details, { tool: 'super_code_task', action: 'read', taskId: 'a' })
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
