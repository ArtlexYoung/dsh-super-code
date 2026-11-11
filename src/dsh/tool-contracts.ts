/** Action-local help and pure input preparation, before task barriers or persistence. */
import { z } from 'zod'
import { taskMemoryCreateSchema, taskMemoryPatchSchema, sourceSchema } from '../core/task-memory.js'
import type { TaskMemoryCreate, TaskMemoryPatch, TaskSource } from '../core/task-memory.js'
import { assignmentSchema, resultSchema } from '../core/delegation.js'
import type { MemberAssignment, MemberResult } from '../core/delegation.js'
import { longMemoryEntrySchema } from '../long-memory.js'
import type { LongMemoryEntry } from '../long-memory.js'

export interface ActionInput { action: string; [key: string]: unknown }
interface ActionContract {
  required: readonly string[]; optional?: readonly string[]; record?: z.ZodType
  example: ActionInput; notes: string; returns: string
}
type Contracts = Readonly<Record<string, ActionContract>>
const count = z.number().int().nonnegative().safe()
const restoreSchema = z.object({ source: sourceSchema, sourceVersion: z.string().trim().min(1).max(4000) }).strict()
const evidenceSchema = z.union([
  z.object({ ref: z.string().min(1).max(4000), offset: count.optional() }).strict(),
  z.object({ callSeq: count, resultSeq: count, offset: count.optional() }).strict(),
])
const memberSchema = z.object({ assignment: assignmentSchema, result: resultSchema }).strict()
const source = { seq: 0, quote: 'Implement the requested change.' }
const assignment = { owner: 'worker', attemptId: '1', objective: 'Check the changed interface', ownedPaths: ['src/module.ts'], acceptance: ['Relevant check passes'], maxTokens: 1000 }
const taskContracts: Contracts = {
  list: { required: [], example: { action: 'list' }, notes: 'Lists live task identities and recent direct user event IDs. Does not change focus.', returns: 'tasks[{id,title,status,revision}], focus, recentUserEventSeqs' },
  read: { required: [], optional: ['taskId', 'view'], example: { action: 'read' }, notes: 'Omit taskId only for the focused task. view defaults to resume; full includes sources and all recorded evidence. Use the returned revision for updates.', returns: 'resume: {current:{id,revision,requirements,acceptance,next,details,...}}; full: task record' },
  source: { required: ['eventSeq'], example: { action: 'source', eventSeq: 0 }, notes: 'Use a visible direct user event ID; returns its original message, never grants additional authority.', returns: 'one direct user event' },
  history: { required: ['eventSeq'], example: { action: 'history', eventSeq: 1 }, notes: 'Use a visible task event ID. Historical evidence does not establish current correctness.', returns: 'one recorded task event' },
  create: { required: ['record'], record: taskMemoryCreateSchema,
    example: { action: 'create', record: { id: 't1', title: 'Requested change', team: 'develop', depth: 'complex', workspace: '/repo', sourceVersion: 'observed-worktree-version', goal: 'Implement the requested change', source, requirements: [], acceptance: ['Relevant check passes'] } },
    notes: 'All sources must be exact quotes from visible direct user events. Use actual workspace/version; examples are placeholders. Optional topic and keyPoints (summary at most 30 characters). Does not execute work.', returns: 'action, id, revision, eventSeq' },
  update: { required: ['taskId', 'expectedRevision', 'record'], record: taskMemoryPatchSchema,
    example: { action: 'update', taskId: 't1', expectedRevision: 1, record: { next: 'Run the relevant check' } },
    notes: 'Patch only changed fields; omitted fields remain. requirements replace by id; removeRequirements deletes. Goal/requirements/workspace/acceptance/topic changes require a direct user correction source and invalidate stale decisions/evidence. Use an observed revision, never automatically replace it with the newest revision.', returns: 'action, id, revision, eventSeq; unchanged:true for identical state' },
  focus: { required: ['taskId'], example: { action: 'focus', taskId: 't1' }, notes: 'Changes the focused task and its injected memory topic; does not start or stop work.', returns: 'action, id, eventSeq or unchanged:true' },
  archive: { required: ['taskId', 'expectedRevision'], example: { action: 'archive', taskId: 't1', expectedRevision: 2 }, notes: 'Only completed/cancelled tasks may be archived. Stop workers separately. Use a revision already observed.', returns: 'action, id, revision, eventSeq' },
  archives: { required: [], optional: ['taskId', 'eventSeq'], example: { action: 'archives' }, notes: 'Pages backward; eventSeq is an exclusive cursor. Continue with nextBeforeSeq while done=false. taskId filters.', returns: 'records, nextBeforeSeq, done, scanned' },
  restore: { required: ['eventSeq', 'record'], record: restoreSchema, example: { action: 'restore', eventSeq: 2, record: { source, sourceVersion: 'new-observed-worktree-version' } }, notes: 'Inspect an archive first, then use a newer direct user source and inspected workspace version. Clears decisions and current evidence validity. Does not restore worker processes.', returns: 'action, id, revision, eventSeq' },
  delegate: { required: ['taskId', 'record'], record: assignmentSchema, example: { action: 'delegate', taskId: 't1', record: assignment }, notes: 'Returns a version-bound brief for an active task; does not spawn an agent. maxTokens is a stated budget, not verified accounting.', returns: 'binding, taskId, sessionId, assignment, constraints, taskGoal, taskAcceptance and revision identities' },
  validate_member: { required: ['taskId', 'record'], record: memberSchema, example: { action: 'validate_member', taskId: 't1', record: { assignment, result: { binding: 'binding-from-delegate', owner: 'worker', attemptId: '1', outcome: 'completed', summary: 'Observed result', artifacts: [], checks: ['relevant check'], unknowns: [] } } }, notes: 'Checks binding, owner/attempt and stop status against current task. Does not prove acceptance; inspect artifacts/checks. Cost is optional self-report.', returns: 'reviewable, reasons, accounting, result' },
  evidence: { required: [], optional: ['eventSeq', 'record'], record: evidenceSchema, example: { action: 'evidence' }, notes: 'Without record, page identities using eventSeq/nextBeforeSeq. With record, read {ref,offset?} or {callSeq,resultSeq,offset?}; eventSeq and record are mutually exclusive. Follow readMore for omitted output. Recorded results never prove current code.', returns: 'directory records/cursor, recorded output with provenance/readMore, or explicit unavailable reason' },
}
const rememberSchema = z.object({ expectedRevision: count, globalConfirmed: z.boolean().optional(), entries: z.array(z.object({
  id: z.string(), kind: z.enum(['constraint', 'fact', 'experience']), summary: z.string(), detail: z.string(), sourceVersion: z.string().optional(),
  source: z.object({ kind: z.enum(['user', 'tool']), eventSeq: count, quote: z.string().min(1).max(4000).optional(), callSeq: count.optional() }).strict(),
}).strict()).min(1).max(8) }).strict()
const forgetSchema = z.object({ expectedRevision: count.positive(), source: sourceSchema }).strict()
const topicsSchema = z.object({ offset: count.default(0) }).strict()
const memoryContracts: Contracts = {
  topics: { required: [], optional: ['scope', 'record'], record: topicsSchema, example: { action: 'topics' }, notes: 'Project scope defaults to the session workspace; global lists its preference topic. Optional record:{offset:20} continues pages.', returns: 'topics[{topic,revision,count}], total, nextOffset when incomplete' },
  read: { required: [], optional: ['scope', 'topic', 'id'], example: { action: 'read', topic: 'build' }, notes: 'Project topic can be explicit without creating/focusing a task. Omit topic to use the focused task topic. Global does not accept topic. Omit id for overview; add an entry id for full detail. Historical information does not certify current code.', returns: 'scope, topic, revision, entries, ids, details; or entry, sourceAvailability, basis' },
  remember: { required: ['record'], optional: ['scope'], record: rememberSchema, example: { action: 'remember', record: { expectedRevision: 0, entries: [{ id: 'constraint', kind: 'constraint', summary: 'Retain the public API', detail: 'Preserve the requested public interface.', source: { kind: 'user', eventSeq: 0, quote: 'Retain the public API' } }] } }, notes: 'Project writes still require a focused task topic. Each summary <=30 characters, detail <=1000, id matches [a-zA-Z0-9][a-zA-Z0-9._-]{0,95}. Constraints need exact direct user quotes. Facts/experience need a real tool call/result source and the focused task sourceVersion. Global accepts only explicit cross-project user constraints with record.globalConfirmed:true. Use observed revision. No automatic retry.', returns: 'scope, topic, revision, count' },
  forget: { required: ['id', 'record'], optional: ['scope'], record: forgetSchema, example: { action: 'forget', id: 'constraint', record: { expectedRevision: 1, source } }, notes: 'Project deletion requires the focused topic. Use an observed revision and a direct user source. Does not accept topic or silently change focus.', returns: 'scope, topic, revision, count' },
}

function contractFor(contracts: Contracts, action: string): ActionContract {
  if (!Object.hasOwn(contracts, action)) throw new Error(`Unsupported action; choose ${Object.keys(contracts).join(', ')}`)
  return contracts[action]!
}

/** No session, storage, model or filesystem access. */
export function actionHelp(tool: 'super_code_task' | 'super_code_memory', action: string): string {
  const contract = contractFor(tool === 'super_code_task' ? taskContracts : memoryContracts, action)
  return JSON.stringify({ tool, action, required: contract.required, optional: contract.optional ?? [],
    ...(contract.record ? { recordSchema: z.toJSONSchema(contract.record, { unrepresentable: 'any' }) } : {}),
    example: contract.example, notes: contract.notes, returns: contract.returns,
    recovery: 'Examples use placeholder identities/sources: replace them with observed values. Invalid input appends no business change. On stale revision, read before deciding again. Unconfirmed persistence may follow an appended event: confirm with list/read, never replay a write automatically.' })
}

/** Validate top-level combinations before any checkpoint can be retried. */
export function assertActionInput(tool: 'super_code_task' | 'super_code_memory', args: ActionInput): void {
  const help = args.action === 'help'
  const contract: Pick<ActionContract, 'required' | 'optional'> = help ? { required: ['forAction'], optional: [] } : contractFor(tool === 'super_code_task' ? taskContracts : memoryContracts, args.action)
  const hint = ` Use ${tool} ${JSON.stringify({ action: 'help', forAction: help ? 'read' : args.action })}.`
  for (const field of contract.required) if (args[field] === undefined) throw new Error(`${args.action} requires ${field}; no business change was appended.${hint}`)
  for (const field of Object.keys(args)) {
    // Existing details/readMore links include their destination alongside the arguments.
    if (field === 'tool' && args.tool === tool) continue
    if (field !== 'action' && args[field] !== undefined && !contract.required.includes(field) && !contract.optional?.includes(field)) {
      throw new Error(`Unsupported field for ${args.action}; allowed: ${[...contract.required, ...contract.optional ?? []].join(', ') || 'none'}.${hint}`)
    }
  }
  if (help) { contractFor(tool === 'super_code_task' ? taskContracts : memoryContracts, args.forAction as string); return }
  z.object({ expectedRevision: count.optional(), eventSeq: count.optional() }).parse(args)
  if (args.action === 'evidence' && args.record !== undefined && args.eventSeq !== undefined) throw new Error(`evidence accepts either record or eventSeq.${hint}`)
  if (tool === 'super_code_memory' && args.topic !== undefined) {
    if (args.scope === 'global') throw new Error('Global memory does not accept topic; use {"action":"read","scope":"global"}.')
    z.object({ topic: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/) }).parse(args)
  }
}

export interface PreparedTaskRecord {
  create?: TaskMemoryCreate; patch?: TaskMemoryPatch; restore?: { source: TaskSource; sourceVersion: string }
  assignment?: MemberAssignment; member?: { assignment: MemberAssignment; result: MemberResult }
  evidence?: { ref: string; offset?: number } | { callSeq: number; resultSeq: number; offset?: number }
}
export function prepareTaskRecord(args: ActionInput): PreparedTaskRecord {
  switch (args.action) {
    case 'create': return { create: taskMemoryCreateSchema.parse(args.record) }
    case 'update': return { patch: taskMemoryPatchSchema.parse(args.record) }
    case 'restore': return { restore: restoreSchema.parse(args.record) }
    case 'delegate': return { assignment: assignmentSchema.parse(args.record) }
    case 'validate_member': return { member: memberSchema.parse(args.record) }
    case 'evidence': return args.record === undefined ? {} : { evidence: evidenceSchema.parse(args.record) }
    default: return {}
  }
}
export interface PreparedMemoryRecord {
  topics?: { offset: number }
  remember?: { expectedRevision: number; globalConfirmed?: boolean; entries: LongMemoryEntry[] }
  forget?: { expectedRevision: number; source: TaskSource }
}
export function prepareMemoryRecord(args: ActionInput, sessionId: string): PreparedMemoryRecord {
  if (args.action === 'topics') return { topics: topicsSchema.parse(args.record ?? {}) }
  if (args.action === 'forget') return { forget: forgetSchema.parse(args.record) }
  if (args.action !== 'remember') return {}
  const input = rememberSchema.parse(args.record)
  const entries = input.entries.map(entry => longMemoryEntrySchema.parse({ ...entry, source: { ...entry.source, sessionId } }))
  return { remember: { ...input, entries } }
}

/** Schema-owned diagnostics and a small example; submitted values are never echoed. */
export function invalidInput(tool: 'super_code_task' | 'super_code_memory', action: string, error: z.ZodError): Error {
  const issues = error.issues.slice(0, 4).map(issue => {
    let hint: string = issue.code
    if (issue.code === 'invalid_type') hint += `; expected ${issue.expected}`
    if (issue.code === 'too_small') hint += `; ${issue.origin} ${issue.inclusive ? 'min' : 'greater than'} ${issue.minimum}`
    if (issue.code === 'too_big') hint += `; ${issue.origin} ${issue.inclusive ? 'max' : 'less than'} ${issue.maximum}`
    return `${issue.path.map(String).join('.').slice(0, 120) || 'record'} (${hint})`
  })
  const example = JSON.stringify(contractFor(tool === 'super_code_task' ? taskContracts : memoryContracts, action).example)
  return new Error(`Invalid ${action} input: ${issues.join('; ')}${error.issues.length > 4 ? '; additional invalid fields omitted' : ''}. No automatic correction was applied. Example (replace identities/sources): ${example}. Help: ${tool} ${JSON.stringify({ action: 'help', forAction: action })}.`)
}
