import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemberBrief, validateMemberResult } from '../src/core/delegation.js'
import { taskMemorySchema, reviseTaskMemory } from '../src/core/task-memory.js'

const source = { seq: 1, quote: 'Fix the function' }
const task = taskMemorySchema.parse({ id: 'a', createdAtSeq: 2, title: 'Fix', team: 'develop', depth: 'complex', workspace: '/repo', sourceVersion: 'sha1', goal: 'Fix', source, requirements: [], acceptance: ['tests pass'], decisions: [], evidence: [], next: '', status: 'active', revision: 1, requirementsRevision: 1, delegationRevision: 1 })
const assignment = { owner: 'reviewer', attemptId: 'attempt-1', objective: 'Inspect boundaries', ownedPaths: [], acceptance: ['actionable findings'], maxTokens: 100 }
const brief = createMemberBrief(task, 'session-a', assignment)
const result = { binding: brief.binding, owner: assignment.owner, attemptId: assignment.attemptId, outcome: 'completed' as const, summary: 'checked', artifacts: [], checks: ['bounds'], unknowns: [], cost: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, toolCalls: 1, complete: true } }

test('only same-scope current results are eligible for lead review', () => {
  assert.equal(validateMemberResult(task, 'session-a', assignment, result).reviewable, true)
  for (const changed of [{ ...task, sourceVersion: 'sha2' }, { ...task, workspace: '/other' }, { ...task, createdAtSeq: 10 }, reviseTaskMemory(task, { source, requirements: [{ id: 'no-write', text: 'Read only', source }] }, 1)]) {
    assert.equal(validateMemberResult(changed, 'session-a', assignment, result).reviewable, false)
  }
  assert.equal(validateMemberResult(task, 'session-b', assignment, result).reviewable, false)
  assert.equal(validateMemberResult(task, 'session-a', { ...assignment, attemptId: 'attempt-2' }, result).reviewable, false)
})
test('execution status and unverified accounting are independent', () => {
  for (const outcome of ['failed', 'cancelled', 'stop_unknown'] as const) assert.equal(validateMemberResult(task, 'session-a', assignment, { ...result, outcome }).reviewable, false)
  for (const [cost, reportedBudget] of [[{ ...result.cost, inputTokens: 101 }, 'exceeded'], [{ ...result.cost, complete: false }, 'incomplete'], [{ ...result.cost, cachedTokens: 99 }, 'invalid'], [result.cost, 'within']] as const) {
    const review = validateMemberResult(task, 'session-a', assignment, { ...result, cost })
    assert.equal(review.reviewable, true)
    assert.deepEqual(review.accounting, { kind: 'model-reported', budget: 'unknown', reportedBudget })
  }
  const { cost: _cost, ...withoutCost } = result
  const review = validateMemberResult(task, 'session-a', assignment, withoutCost)
  assert.equal(review.reviewable, true)
  assert.deepEqual(review.accounting, { kind: 'unavailable', budget: 'unknown' })
  assert.throws(() => validateMemberResult(task, 'session-a', assignment, { ...result, cost: { ...result.cost, inputTokens: -1 } }))
})

test('pause/resume invalidates old members while ordinary progress does not', () => {
  const progress = reviseTaskMemory(task, { next: 'Waiting for review' }, 1)
  assert.equal(validateMemberResult(progress, 'session-a', assignment, result).reviewable, true)
  const paused = reviseTaskMemory(progress, { status: 'paused' }, 2)
  const resumed = reviseTaskMemory(paused, { status: 'active' }, 3)
  assert.equal(resumed.requirementsRevision, task.requirementsRevision)
  assert.equal(validateMemberResult(resumed, 'session-a', assignment, result).reviewable, false)
  const rebound = createMemberBrief(resumed, 'session-a', assignment)
  assert.equal(rebound.taskGoal, task.goal)
  assert.deepEqual(rebound.taskAcceptance, task.acceptance)
  assert.equal(validateMemberResult(resumed, 'session-a', assignment, { ...result, binding: rebound.binding }).reviewable, true)
  const cancelled = reviseTaskMemory(task, { status: 'cancelled' }, 1)
  assert.throws(() => reviseTaskMemory(cancelled, { status: 'active' }, 2), /Archive and restore/)
})
