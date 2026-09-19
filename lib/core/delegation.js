import { createHash } from 'node:crypto';
import { z } from 'zod';
const text = z.string().trim().min(1).max(4000);
const count = z.number().int().nonnegative().safe();
const assignmentSchema = z.object({ owner: text, attemptId: text, objective: text, ownedPaths: z.array(text).max(64), acceptance: z.array(text).min(1).max(32), maxTokens: z.number().int().positive() }).strict();
const resultSchema = z.object({ binding: text, owner: text, attemptId: text, outcome: z.enum(['completed', 'failed', 'cancelled', 'stop_unknown']), summary: text, artifacts: z.array(text).max(64), checks: z.array(text).max(64), unknowns: z.array(text).max(32), cost: z.object({ inputTokens: count, outputTokens: count, cachedTokens: count, toolCalls: count, complete: z.boolean() }).strict().optional() }).strict();
/** Compact, version-bound inputs for the existing host subagent provider. */
export function createMemberBrief(task, sessionId, input) {
    const assignment = assignmentSchema.parse(input);
    if (sessionId.trim() === '')
        throw new Error('sessionId is required');
    if (task.status !== 'active')
        throw new Error('Only active tasks may delegate work');
    const fields = { ...assignment, sessionId, taskId: task.id, createdAtSeq: task.createdAtSeq, requirementsRevision: task.requirementsRevision,
        delegationRevision: task.delegationRevision, taskGoal: task.goal, taskAcceptance: [...task.acceptance],
        workspace: task.workspace, sourceVersion: task.sourceVersion, constraints: task.requirements.map(item => item.text) };
    return { ...fields, binding: createHash('sha256').update(JSON.stringify(fields)).digest('hex') };
}
/** Version matching is necessary for review, not proof that the work is correct. */
export function validateMemberResult(task, sessionId, assignment, input) {
    assignment = assignmentSchema.parse(assignment);
    const result = resultSchema.parse(input);
    const reasons = [];
    if (task.status !== 'active')
        reasons.push('parent task is not active');
    else {
        const current = createMemberBrief(task, sessionId, assignment);
        if (result.binding !== current.binding)
            reasons.push('stale task, requirements, workspace, source or assignment');
    }
    if (result.owner !== assignment.owner || result.attemptId !== assignment.attemptId)
        reasons.push('owner or attempt differs');
    if (result.outcome !== 'completed')
        reasons.push(result.outcome);
    const cost = result.cost;
    const accounting = cost === undefined ? { kind: 'unavailable', budget: 'unknown' }
        : { kind: 'model-reported', budget: 'unknown', reportedBudget: cost.cachedTokens > cost.inputTokens || !Number.isSafeInteger(cost.inputTokens + cost.outputTokens) ? 'invalid'
                : !cost.complete ? 'incomplete' : cost.inputTokens + cost.outputTokens > assignment.maxTokens ? 'exceeded' : 'within' };
    return { reviewable: reasons.length === 0, reasons, accounting, result };
}
//# sourceMappingURL=delegation.js.map