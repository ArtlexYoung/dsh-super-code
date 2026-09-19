import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TaskMemory } from './task-memory.js'

export interface MemberAssignment {
  owner: string; attemptId: string; objective: string; ownedPaths: string[]; acceptance: string[]; maxTokens: number
}
export interface MemberBrief extends MemberAssignment {
  binding: string; sessionId: string; taskId: string; createdAtSeq: number; requirementsRevision: number; delegationRevision: number
  workspace: string; sourceVersion: string; constraints: string[]; taskGoal: string; taskAcceptance: string[]
}
export interface MemberResult {
  binding: string; owner: string; attemptId: string
  outcome: 'completed' | 'failed' | 'cancelled' | 'stop_unknown'
  summary: string; artifacts: string[]; checks: string[]; unknowns: string[]
  /** Optional self-report, never authenticated usage or budget enforcement. */
  cost?: { inputTokens: number; outputTokens: number; cachedTokens: number; toolCalls: number; complete: boolean }
}
export type MemberAccounting = { kind: 'unavailable'; budget: 'unknown' }
  | { kind: 'model-reported'; budget: 'unknown'; reportedBudget: 'within' | 'exceeded' | 'incomplete' | 'invalid' }
export interface MemberReview { reviewable: boolean; reasons: string[]; accounting: MemberAccounting; result: MemberResult }
const text = z.string().trim().min(1).max(4000)
const count = z.number().int().nonnegative().safe()
const assignmentSchema: z.ZodType<MemberAssignment> = z.object({ owner: text, attemptId: text, objective: text, ownedPaths: z.array(text).max(64), acceptance: z.array(text).min(1).max(32), maxTokens: z.number().int().positive() }).strict()
const resultSchema: z.ZodType<MemberResult> = z.object({ binding: text, owner: text, attemptId: text, outcome: z.enum(['completed', 'failed', 'cancelled', 'stop_unknown']), summary: text, artifacts: z.array(text).max(64), checks: z.array(text).max(64), unknowns: z.array(text).max(32), cost: z.object({ inputTokens: count, outputTokens: count, cachedTokens: count, toolCalls: count, complete: z.boolean() }).strict().optional() }).strict()

/** Compact, version-bound inputs for the existing host subagent provider. */
export function createMemberBrief(task: TaskMemory, sessionId: string, input: MemberAssignment): MemberBrief {
  const assignment = assignmentSchema.parse(input)
  if (sessionId.trim() === '') throw new Error('sessionId is required')
  if (task.status !== 'active') throw new Error('Only active tasks may delegate work')
  const fields = { ...assignment, sessionId, taskId: task.id, createdAtSeq: task.createdAtSeq, requirementsRevision: task.requirementsRevision,
    delegationRevision: task.delegationRevision, taskGoal: task.goal, taskAcceptance: [...task.acceptance],
    workspace: task.workspace, sourceVersion: task.sourceVersion, constraints: task.requirements.map(item => item.text) }
  return { ...fields, binding: createHash('sha256').update(JSON.stringify(fields)).digest('hex') }
}

/** Version matching is necessary for review, not proof that the work is correct. */
export function validateMemberResult(task: TaskMemory, sessionId: string, assignment: MemberAssignment, input: MemberResult): MemberReview {
  assignment = assignmentSchema.parse(assignment)
  const result = resultSchema.parse(input)
  const reasons: string[] = []
  if (task.status !== 'active') reasons.push('parent task is not active')
  else {
    const current = createMemberBrief(task, sessionId, assignment)
    if (result.binding !== current.binding) reasons.push('stale task, requirements, workspace, source or assignment')
  }
  if (result.owner !== assignment.owner || result.attemptId !== assignment.attemptId) reasons.push('owner or attempt differs')
  if (result.outcome !== 'completed') reasons.push(result.outcome)
  const cost = result.cost
  const accounting: MemberAccounting = cost === undefined ? { kind: 'unavailable', budget: 'unknown' }
    : { kind: 'model-reported', budget: 'unknown', reportedBudget:
      cost.cachedTokens > cost.inputTokens || !Number.isSafeInteger(cost.inputTokens + cost.outputTokens) ? 'invalid'
        : !cost.complete ? 'incomplete' : cost.inputTokens + cost.outputTokens > assignment.maxTokens ? 'exceeded' : 'within' }
  return { reviewable: reasons.length === 0, reasons, accounting, result }
}
