/** Agent-scoped tools and logged runtime context, using the installed Harness API. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { TEAM_NAMES, METHODS, SUPER_CODE_INSTRUCTIONS, readTeamMethod } from '../core/teams.js'
import type { MethodName } from '../core/teams.js'
import { EXPERIMENT_RECIPES, readExperimentRecipe } from '../core/experiment-recipes.js'
import { taskMemoryProjection, taskMemoryEventOf } from '../task-memory-projection.js'
import { requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemoryRead, taskMemoryCreateSchema, taskMemoryPatchSchema, taskMemorySchema, sourceSchema } from '../core/task-memory.js'
import type { TaskMemoryEvent, TaskSource } from '../core/task-memory.js'
import { createMemberBrief, validateMemberResult } from '../core/delegation.js'
import { z as json } from 'zod'
import type { MemberAssignment, MemberResult } from '../core/delegation.js'
import { createGuidanceSelector, GUIDED_INSTRUCTIONS } from '../core/guidance.js'
import type { GuidedRoute } from '../core/guidance.js'
import { listToolEvidence, readToolEvidence, toolEvidenceRef } from '../core/tool-evidence.js'
import { scanSessionPage } from '../core/session-scan.js'
import { TaskMemoryStore } from '../task-memory-store.js'

export const name = 'super-code'
export const inject: readonly string[] = ['tools', 'systemPrompt', 'sessions', 'sessionProjections']
export interface Config { readonly maxTasks?: number; readonly maxContextBytes?: number; readonly guidedRoutes?: GuidedRoute[] }
export const Config: z<Config> = z.object({
  maxTasks: z.number().step(1).min(1).max(128).default(32),
  maxContextBytes: z.number().step(1).min(1024).max(262144).default(32768),
  guidedRoutes: z.array(z.object({ provider: z.string().required(), model: z.string().required() })),
})

function assertSource(session: Session, source: TaskSource): void {
  const event = session.eventAt(SessionSeq(source.seq))
  if (event?.type !== 'user/message' || event.data.source.kind !== 'user') throw new Error('Requirement source must reference a direct user message in this session')
  const original = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (!original.includes(source.quote)) throw new Error('Requirement quote is not present in its original user message')
}

/** Schema-owned expectations only; never echo submitted values or arbitrary error messages. */
function inputIssue(issue: json.core.$ZodIssue): string {
  let hint: string = issue.code
  if (issue.code === 'invalid_type') hint += `; expected ${issue.expected}`
  if (issue.code === 'too_small') hint += `; ${issue.origin} ${issue.inclusive ? 'min' : 'greater than'} ${issue.minimum}`
  if (issue.code === 'too_big') hint += `; ${issue.origin} ${issue.inclusive ? 'max' : 'less than'} ${issue.maximum}`
  return `${issue.path.map(String).join('.').slice(0, 120) || 'record'} (${hint})`
}

// Runtime-only contracts keep the model-facing schema compact without silently ignoring fields.
const actionFields: Record<string, { required: readonly string[]; optional?: readonly string[] }> = {
  list: { required: [] }, read: { required: ['taskId'], optional: ['view'] },
  source: { required: ['eventSeq'] }, history: { required: ['eventSeq'] },
  create: { required: ['record'] }, update: { required: ['taskId', 'expectedRevision', 'record'] },
  focus: { required: ['taskId'] }, archive: { required: ['taskId', 'expectedRevision'] },
  archives: { required: [], optional: ['taskId', 'eventSeq'] }, restore: { required: ['eventSeq', 'record'] },
  delegate: { required: ['taskId', 'record'] }, validate_member: { required: ['taskId', 'record'] },
  evidence: { required: [], optional: ['eventSeq', 'record'] },
}

function assertActionFields(args: { action: string; [key: string]: unknown }): void {
  if (!Object.hasOwn(actionFields, args.action)) throw new Error('Unsupported task action')
  const rule = actionFields[args.action]!
  for (const field of rule.required) if (args[field] === undefined) throw new Error(`${args.action} requires ${field}; no task snapshot was appended.`)
  for (const field of ['taskId', 'expectedRevision', 'eventSeq', 'record', 'view']) {
    if (args[field] !== undefined && !rule.required.includes(field) && !rule.optional?.includes(field)) throw new Error(`${field} is not supported by ${args.action}`)
  }
  if (args.action === 'evidence' && args.record !== undefined && args.eventSeq !== undefined) throw new Error('evidence accepts either a record or an eventSeq cursor')
}

/** Installs no agent loop and starts no model calls. */
export function apply(ctx: Context, config: Config = {}): void {
  const maxTasks = config.maxTasks ?? 32
  const maxContextBytes = config.maxContextBytes ?? 32768
  const selectGuidance = createGuidanceSelector(config.guidedRoutes)
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 128 || !Number.isSafeInteger(maxContextBytes) || maxContextBytes < 1024 || maxContextBytes > 262144) throw new Error('Invalid super-code capacity')
  ctx.sessionProjections.register(taskMemoryProjection)
  const memory = new TaskMemoryStore(ctx, maxContextBytes)
  ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: SUPER_CODE_INSTRUCTIONS })
  // Wrap the host selection waterfall: providers run before its model snapshot is resolved.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    if (selectGuidance(assembled.variables.provider, assembled.variables.model) === 'standard') return assembled
    return { ...assembled, sections: assembled.sections.map(section => section.name === PERSONA_PREFIX_SECTION && section.text === SUPER_CODE_INSTRUCTIONS
      ? { ...section, text: `${section.text}\n${GUIDED_INSTRUCTIONS}` } : section) }
  }, { prepend: true })
  ctx.systemPrompt.context({ name: 'super-code:tasks', order: 80, text: ({ agent }) => {
    if (agent === undefined) return ''
    if (memory.isPending(agent.session)) return 'The last task-memory checkpoint is unconfirmed. Use super_code_task read to retry persistence before relying on it.'
    return taskMemoryContext(memory.current(agent.session), maxContextBytes)
  } })
  ctx.tools.register(defineTool({
    name: 'super_code_method',
    description: 'Read missing expertise, not a routine prerequisite. Select a known method directly; omit method only to inspect a team. Reuse guidance in context; batch with independent reads when useful.',
    parameters: { team: { type: 'string', enum: TEAM_NAMES, required: true }, method: { type: 'string', enum: Object.keys(METHODS) as MethodName[] },
      recipe: { type: 'string', enum: EXPERIMENT_RECIPES, description: 'Optional runnable Shell example for a hard problem: failure reduction, differential oracle, controlled async interleavings or contract relation. Omit when unnecessary.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    execute: async args => {
      const method = readTeamMethod(args.team, args.method)
      return args.recipe === undefined ? method : `${method}\n\n${readExperimentRecipe(args.recipe)}`
    },
  }))
  ctx.tools.register(defineTool({
    name: 'super_code_task',
    description: `Task memory; never grants permission or executes work. Simple tasks need no record. Actions: list; read(taskId,view?); source(eventSeq); create(record); update(taskId,expectedRevision,record patch); focus(taskId); archive(taskId,expectedRevision); history(eventSeq). Create fields: id,title,team,depth,workspace,sourceVersion,goal,source:{seq,quote},requirements:[{id,text,source:{seq,quote}}],acceptance:[string]. Source seqs appear in runtime context. Update preserves omitted fields; requirement entries replace matching ids, removeRequirements explicitly removes ids. Goal/requirements/workspace/acceptance changes need a user source. Old evidence becomes stale on requirements/source revision changes. Optional updates: decisions:[string], evidence:[{summary,ref,sourceVersion,requirementsRevision,kind:observed|assumption|test|decision}], next:string, status:active|paused|completed|cancelled. Archive only finished tasks; keep eventSeq to read history. Focus does not stop work. delegate(taskId,record:{owner,attemptId,objective,ownedPaths:[string],acceptance:[string],maxTokens}) returns a compact brief to pass to host subagent. validate_member(taskId,record:{assignment:original assignment,result:{binding,owner,attemptId,outcome:completed|failed|cancelled|stop_unknown,summary,artifacts:[string],checks:[string],unknowns:[string]}}) rejects stale returns; reviewable still needs lead review. Accounting is separate; never guess costs or treat model-reported usage as a verified budget.`,
    // Pagination never scans or returns an unbounded archive in one tool call.
    parameters: {
      action: { type: 'string', enum: ['list', 'read', 'source', 'create', 'update', 'focus', 'archive', 'archives', 'restore', 'history', 'delegate', 'validate_member', 'evidence'], required: true,
        description: 'evidence: record:{callSeq,resultSeq} or {ref} reads a pair, not acceptance/current-code proof. Long output returns a head/tail excerpt and readMore; optional record.offset reads original text pages (UTF-16 offsets). Without record, list identities; match callId/turn/step and inspect arguments. Directory/archives use exclusive eventSeq/nextBeforeSeq; done=false means more. archives optionally filters taskId. restore: archived eventSeq plus record:{source:{seq,quote},sourceVersion}, after user asks to resume and you inspect the workspace. sourceVersion must distinguish relevant working-tree edits, not just HEAD. Recorded versions do not verify current files. Restore retains requirements and invalidates old evidence; starts no workers.' },
      taskId: { type: 'string' }, expectedRevision: { type: 'integer' }, eventSeq: { type: 'integer', description: 'Use visible runtime source identities; if the newest user source is absent, list returns recentUserEventSeqs. Never guess an event sequence.' }, record: { type: 'json' },
      view: { type: 'string', enum: ['resume', 'full'], description: 'Only for read: default resume returns {current} with all constraints and bounded current evidence. full retrieves omitted details: source quotes, all evidence and versions. Stale evidence is historical, not current proof.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      try {
        if (exec.agent === undefined) throw new Error('super-code requires an agent-owned session')
        assertActionFields(args)
        const session = exec.agent.session
        if (args.action === 'evidence') {
          exec.signal.throwIfAborted()
          if (args.record === undefined) return JSON.stringify(await listToolEvidence(session.seq, args.eventSeq ?? session.seq, seq => session.eventAt(SessionSeq(seq)), exec.signal))
          const input = json.union([
            json.object({ ref: json.string().min(1).max(4000), offset: json.number().int().nonnegative().safe().optional() }).strict(),
            json.object({ callSeq: json.number().int().nonnegative(), resultSeq: json.number().int().nonnegative(), offset: json.number().int().nonnegative().safe().optional() }).strict(),
          ]).parse(args.record)
          const ref = 'ref' in input ? input.ref : toolEvidenceRef({ ...input, sessionId: session.id })
          return JSON.stringify(readToolEvidence(session.id, ref, seq => session.eventAt(SessionSeq(seq)), input.offset))
        }
        const mutating = ['create', 'update', 'focus', 'archive', 'restore'].includes(args.action)
        if (!mutating) {
          const { state, end } = await memory.read(session, exec.signal)
          if (args.action === 'archives') {
            const records: { eventSeq: number; id: string; title: string; status: string }[] = []
            const page = await scanSessionPage(end, args.eventSeq ?? end, seq => session.eventAt(SessionSeq(seq)), event => {
              const item = taskMemoryEventOf(event)
              if (item.kind === 'record' && item.record.kind === 'archive' && (args.taskId === undefined || item.record.task.id === args.taskId)) {
                const { id, title, status } = item.record.task
                records.push({ eventSeq: event.seq, id, title, status })
              }
              return records.length >= 10
            }, exec.signal)
            return JSON.stringify({ records, ...page })
          }
          if (args.action === 'list') return JSON.stringify({ tasks: Object.values(state.tasks).map(({ id, title, status, revision }) => ({ id, title, status, revision })), focus: state.focus, recentUserEventSeqs: state.recentSources })
          if (args.action === 'source' || args.action === 'history') {
            if (args.eventSeq === undefined) throw new Error('eventSeq is required')
            const event = session.eventAt(SessionSeq(args.eventSeq))
            if (args.action === 'source' && event?.type === 'user/message' && event.data.source.kind === 'user') return JSON.stringify(event)
            if (args.action === 'history' && event !== undefined && taskMemoryEventOf(event).kind === 'record') return JSON.stringify(event)
            throw new Error('The event is not a matching source or task record')
          }
          if (args.action === 'read') {
            const task = requireTaskMemory(state, args.taskId ?? '')
            return args.view === 'full' ? JSON.stringify(task) : taskMemoryRead(task, maxContextBytes)
          }
          if (args.action === 'delegate' || args.action === 'validate_member') {
            const task = requireTaskMemory(state, args.taskId ?? '')
            if (args.action === 'delegate') return JSON.stringify(createMemberBrief(task, session.id, args.record as unknown as MemberAssignment))
            const envelope = json.object({ assignment: json.unknown(), result: json.unknown() }).strict().parse(args.record)
            return JSON.stringify(validateMemberResult(task, session.id, envelope.assignment as MemberAssignment, envelope.result as MemberResult))
          }
          throw new Error('Unsupported task action')
        }
        const receipt = await memory.write(session, exec.signal, state => {
          let change: TaskMemoryEvent
          if (args.action === 'restore') {
            if (!Number.isSafeInteger(args.eventSeq) || args.eventSeq! < 0) throw new Error('An archived eventSeq is required')
            const event = session.eventAt(SessionSeq(args.eventSeq!))
            if (event === undefined) throw new Error('Unknown archive event')
            const archived = taskMemoryEventOf(event)
            if (archived.kind !== 'record' || archived.record.kind !== 'archive') throw new Error('Only archived tasks can be restored')
            const record = json.object({ source: sourceSchema, sourceVersion: json.string().trim().min(1).max(4000) }).strict().parse(args.record)
            assertSource(session, record.source)
            if (record.source.seq <= event.seq) throw new Error('Restoration requires a user message after the archive')
            const task = archived.record.task
            if (Object.hasOwn(state.tasks, task.id)) throw new Error(`Task ${task.id} already exists`)
            if (Object.keys(state.tasks).length >= maxTasks) throw new Error('Working set is full; archive a completed task first')
            change = { kind: 'save', task: taskMemorySchema.parse({ ...task, ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: task.requirementsRevision + 1, delegationRevision: 1, status: 'active', decisions: [], next: '' }) }
          } else if (args.action === 'create') {
            const record = taskMemoryCreateSchema.parse(args.record)
            if (Object.hasOwn(state.tasks, record.id)) throw new Error(`Task ${record.id} already exists`)
            if (Object.keys(state.tasks).length >= maxTasks) throw new Error('Working set is full; archive a completed task first')
            if (new Set(record.requirements.map(item => item.id)).size !== record.requirements.length) throw new Error('Duplicate requirement ids')
            assertSource(session, record.source)
            record.requirements.forEach(item => assertSource(session, item.source))
            change = { kind: 'save', task: taskMemorySchema.parse({ ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: 1, delegationRevision: 1, status: 'active', decisions: [], evidence: [], next: '' }) }
          } else {
            const task = requireTaskMemory(state, args.taskId ?? '')
            if (args.action === 'focus') {
              if (state.focus.kind === 'task' && state.focus.id === task.id) return { kind: 'unchanged', id: task.id, revision: task.revision }
              change = { kind: 'focus', id: task.id }
            }
            else {
              if (args.expectedRevision === undefined) throw new Error(`${args.action} requires expectedRevision; use the current task view. No task snapshot was appended.`)
              if (args.expectedRevision !== task.revision) throw new Error(`Stale task ${task.id}; read revision ${task.revision} first`)
              if (args.action === 'archive') {
                if (task.status !== 'completed' && task.status !== 'cancelled') throw new Error('Only completed or cancelled memory can be archived; stop workers separately')
                change = { kind: 'archive', task }
              } else {
                const patch = taskMemoryPatchSchema.parse(args.record)
                if (patch.source !== undefined) assertSource(session, patch.source)
                patch.requirements?.forEach(item => assertSource(session, item.source))
                const revised = reviseTaskMemory(task, patch, args.expectedRevision)
                if (revised === task) return { kind: 'unchanged', id: task.id, revision: task.revision }
                change = { kind: 'save', task: revised }
              }
            }
          }
          return change
        })
        return JSON.stringify({ action: args.action, ...receipt })
      } catch (error) {
        if (error instanceof json.ZodError) throw new Error(`Invalid ${args.action} input: ${error.issues.slice(0, 4).map(inputIssue).join('; ')}${error.issues.length > 4 ? '; additional invalid fields omitted' : ''}. Check the action fields; no automatic correction was applied.`)
        throw error
      }
    },
  }))
}

const plugin: { readonly name: string; readonly inject: readonly string[]; readonly Config: z<Config>; readonly apply: typeof apply } = { name, inject, Config, apply }
export default plugin
