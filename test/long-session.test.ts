import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { emptyTaskMemory, taskMemoryContext, taskMemorySchema } from '../src/core/task-memory.js'
import { taskMemoryProjection, TASK_MEMORY_SOURCE } from '../src/task-memory-projection.js'

test('ten thousand archived tasks keep a bounded projection and current context', t => {
  let state = emptyTaskMemory()
  const started = performance.now()
  const record = taskMemorySchema.parse({ id: 'a', createdAtSeq: 0, title: 'Work', team: 'develop', depth: 'simple', workspace: '/w', sourceVersion: 's', goal: 'Implement', source: { seq: 0, quote: 'Implement' }, requirements: [{ id: 'critical', text: 'Do not publish', source: { seq: 0, quote: 'Do not publish' } }], acceptance: ['tested'], decisions: [], evidence: [], next: '', status: 'completed', revision: 1, requirementsRevision: 1, delegationRevision: 1 })
  const event = (seq: number, change: unknown) => ({ type: 'user/message', seq, time: seq, data: { id: `m${seq}`, role: 'user', source: { kind: 'plugin', plugin: TASK_MEMORY_SOURCE }, content: [{ type: 'text', text: JSON.stringify(change) }] }, surfaceOp: 'append' } as never)
  for (let i = 0; i < 10000; i++) {
    const current = { ...record, id: `task-${i}`, createdAtSeq: i * 2 }
    state = taskMemoryProjection.apply(state, event(i * 2, { kind: 'save', task: current }))
    state = taskMemoryProjection.apply(state, event(i * 2 + 1, { kind: 'archive', task: current }))
  }
  assert.deepEqual(state, emptyTaskMemory())
  state = taskMemoryProjection.apply(state, event(20000, { kind: 'save', task: { ...record, status: 'active' } }))
  assert.match(taskMemoryContext(state, 2048), /Do not publish/)
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 2048)
  t.diagnostic(`20,001 task events: ${(performance.now() - started).toFixed(1)} ms; current state ${Buffer.byteLength(JSON.stringify(state))} bytes (local synthetic workload)`)
})
