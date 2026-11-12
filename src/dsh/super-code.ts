/** Agent-scoped tools and logged runtime context, using the installed Harness API. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { TEAM_NAMES, METHODS, SUPER_CODE_INSTRUCTIONS, readTeamMethod } from '../core/teams.js'
import type { MethodName } from '../core/teams.js'
import { EXPERIMENT_RECIPES, readExperimentRecipe } from '../core/experiment-recipes.js'
import { taskMemoryProjection, taskMemoryEventOf } from '../task-memory-projection.js'
import { requireTaskMemory, reviseTaskMemory, taskMemoryContext, taskMemoryRead, taskMemorySchema } from '../core/task-memory.js'
import type { TaskMemoryEvent, TaskSource } from '../core/task-memory.js'
import { createMemberBrief, validateMemberResult } from '../core/delegation.js'
import { z as json } from 'zod'
import { createGuidanceSelector, GUIDED_INSTRUCTIONS } from '../core/guidance.js'
import type { GuidedRoute } from '../core/guidance.js'
import { listToolEvidence, readToolEvidence, toolEvidenceRef } from '../core/tool-evidence.js'
import { scanSessionPage } from '../core/session-scan.js'
import { TaskMemoryStore } from '../task-memory-store.js'
import { LongMemoryStore, longMemoryContext, memoryWorkspace, memoryGlobalNamespace, GLOBAL_PREFERENCES_TOPIC } from '../long-memory.js'
import { batchSafety, classifyMemoryAction, classifyTaskAction } from '../core/batch-policy.js'
import { configurationOf, validateConfiguration } from './budgets.js'
import { applyPtcBudget } from './ptc-budget.js'
import { actionHelp, assertActionInput, prepareTaskRecord, prepareMemoryRecord, invalidInput } from './tool-contracts.js'

export const name = 'super-code'
export const inject: readonly string[] = ['tools', 'systemPrompt', 'sessions', 'sessionProjections']
export interface Config { readonly maxTasks?: number; readonly maxContextBytes?: number; readonly guidedRoutes?: GuidedRoute[]; readonly presetVersion?: string; readonly presetInstallation?: string }
export const Config: z<Config> = z.object({
  maxTasks: z.number().step(1).min(1).max(128),
  maxContextBytes: z.number().step(1).min(1024).max(262144),
  guidedRoutes: z.array(z.object({ provider: z.string().required(), model: z.string().required() })),
  presetVersion: z.string(),
  presetInstallation: z.string(),
})

function assertSource(session: Session, source: TaskSource): void {
  const event = session.eventAt(SessionSeq(source.seq))
  if (event?.type !== 'user/message' || event.data.source.kind !== 'user') throw new Error('Requirement source must reference a direct user message in this session')
  const original = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (!original.includes(source.quote)) throw new Error('Requirement quote is not present in its original user message')
}

/** Installs no agent loop and starts no model calls. */
export function apply(ctx: Context, config: Config = {}): void {
  validateConfiguration({ maxTasks: config.maxTasks, maxContextBytes: config.maxContextBytes })
  const resources = new WeakMap<Agent, { memory: TaskMemoryStore; maxTasks: number; maxContextBytes: number }>()
  const resourcesFor = (agent: Agent) => {
    let value = resources.get(agent)
    if (!value) {
      const inherited = configurationOf(ctx, agent)
      const maxTasks = config.maxTasks ?? inherited.maxTasks ?? 32
      const maxContextBytes = config.maxContextBytes ?? inherited.maxContextBytes ?? 32768
      value = { memory: new TaskMemoryStore(ctx, maxContextBytes), maxTasks, maxContextBytes }
      resources.set(agent, value)
    }
    return value
  }
  applyPtcBudget(ctx, agent => configurationOf(ctx, agent).budgets ?? {})
  const selectGuidance = createGuidanceSelector(config.guidedRoutes)
  ctx.sessionProjections.register(taskMemoryProjection)
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
    const { memory, maxContextBytes } = resourcesFor(agent)
    if (memory.isPending(agent.session)) return 'The last task-memory checkpoint is unconfirmed. Use super_code_task read to retry persistence before relying on it.'
    return taskMemoryContext(memory.current(agent.session), maxContextBytes)
  } })
  ctx.systemPrompt.context({ name: 'super-code:project-memory', order: 81, text: ({ agent }) => {
    if (!agent) return ''
    const { memory } = resourcesFor(agent)
    if (memory.isPending(agent.session)) return ''
    const state = memory.current(agent.session)
    const task = state.focus.kind === 'task' ? state.tasks[state.focus.id] : undefined
    if (!task?.topic) return ''
    const longMemory = ctx.get('superCodeLongMemory') as LongMemoryStore | undefined
    if (!longMemory) return 'Long memory is unavailable; current task memory remains available.'
    let workspace: string
    try { workspace = memoryWorkspace(agent.session) }
    catch { return 'Long memory cannot read this workspace; verify its path before relying on it.' }
    const found = longMemory.read(workspace, task.topic)
    return found.kind === 'found' ? longMemoryContext(found.value, 2048, task.sourceVersion) : ''
  } })
  ctx.systemPrompt.context({ name: 'super-code:global-memory', order: 82, text: ({ agent }) => {
    if (!agent) return ''
    const { memory } = resourcesFor(agent)
    if (memory.isPending(agent.session)) return ''
    const longMemory = ctx.get('superCodeLongMemory') as LongMemoryStore | undefined
    if (!longMemory) return ''
    const found = longMemory.read(memoryGlobalNamespace(), GLOBAL_PREFERENCES_TOPIC)
    return found.kind === 'found' ? `Lower priority than the current user request, conversation and project memory: ${longMemoryContext(found.value, 1024)}` : ''
  } })
  ctx.tools.register(defineTool({
    name: 'super_code_method',
    description: 'Read expertise when causes remain indistinguishable, failures repeat or recovery/state behavior is unclear. Select a method directly; omit it only to inspect a team. Reuse loaded guidance; batch with independent reads. Not a routine prerequisite.',
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
    description: 'Task ledger; no execution or permission. Skip simple tasks. List: {"action":"list"}. Read focused task: {"action":"read"}; explicit taskId selects another. Update using a revision already observed: {"action":"update","taskId":"t1","expectedRevision":1,"record":{"next":"Run the relevant check"}}. For other actions or record fields, use {"action":"help","forAction":"create"}. Reads may batch; sequence writes. Sources must be visible direct user quotes. Never replay writes when persistence is unconfirmed.',
    // Pagination never scans or returns an unbounded archive in one tool call.
    parameters: {
      action: { type: 'string', enum: ['help', 'list', 'read', 'source', 'create', 'update', 'focus', 'archive', 'archives', 'restore', 'history', 'delegate', 'validate_member', 'evidence'], required: true,
        description: 'Use help with forAction for one complete action contract. history/source use visible eventSeq only.' },
      forAction: { type: 'string', description: 'help only: the action to explain.' },
      taskId: { type: 'string' }, expectedRevision: { type: 'integer' }, eventSeq: { type: 'integer', description: 'Visible source/event identity; list exposes recentUserEventSeqs.' }, record: { type: 'json' },
      view: { type: 'string', enum: ['resume', 'full'], description: 'read only: resume is bounded current state; full adds omitted sources, evidence and versions. Stale evidence is historical.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: args => batchSafety(classifyTaskAction(args.action)) === 'parallel',
    execute: async (args, exec) => {
      try {
        exec.signal.throwIfAborted()
        assertActionInput('super_code_task', args)
        if (args.action === 'help') return actionHelp('super_code_task', args.forAction!)
        const prepared = prepareTaskRecord(args)
        if (exec.agent === undefined) throw new Error('super-code requires an agent-owned session')
        const { memory, maxTasks, maxContextBytes } = resourcesFor(exec.agent)
        const session = exec.agent.session
        if (args.action === 'evidence') {
          exec.signal.throwIfAborted()
          if (args.record === undefined) return JSON.stringify(await listToolEvidence(session.seq, args.eventSeq ?? session.seq, seq => session.eventAt(SessionSeq(seq)), exec.signal))
          const input = prepared.evidence!
          const ref = 'ref' in input ? input.ref : toolEvidenceRef({ ...input, sessionId: session.id })
          return JSON.stringify(readToolEvidence(session.id, ref, seq => session.eventAt(SessionSeq(seq)), input.offset))
        }
        const mutating = ['create', 'update', 'focus', 'archive', 'restore'].includes(args.action)
        if (!mutating) {
          if (args.action === 'archives') {
            const { end } = await memory.read(session, exec.signal)
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
          if (args.action === 'source' || args.action === 'history') {
            await memory.read(session, exec.signal)
            if (args.eventSeq === undefined) throw new Error('eventSeq is required')
            const event = session.eventAt(SessionSeq(args.eventSeq))
            if (args.action === 'source' && event?.type === 'user/message' && event.data.source.kind === 'user') return JSON.stringify(event)
            if (args.action === 'history' && event !== undefined && taskMemoryEventOf(event).kind === 'record') return JSON.stringify(event)
            throw new Error('The event is not a matching source or task record')
          }
          const { state } = await memory.read(session, exec.signal)
          if (args.action === 'list') return JSON.stringify({ tasks: Object.values(state.tasks).map(({ id, title, status, revision }) => ({ id, title, status, revision })), focus: state.focus, recentUserEventSeqs: state.recentSources })
          if (args.action === 'read') {
            const taskId = args.taskId ?? (state.focus.kind === 'task' ? state.focus.id : undefined)
            if (taskId === undefined) throw new Error('No focused task. Use super_code_task {"action":"list"}, then read with taskId.')
            const task = requireTaskMemory(state, taskId)
            return args.view === 'full' ? JSON.stringify(task) : taskMemoryRead(task, maxContextBytes)
          }
          if (args.action === 'delegate' || args.action === 'validate_member') {
            const task = requireTaskMemory(state, args.taskId ?? '')
            if (args.action === 'delegate') return JSON.stringify(createMemberBrief(task, session.id, prepared.assignment!))
            const envelope = prepared.member!
            return JSON.stringify(validateMemberResult(task, session.id, envelope.assignment, envelope.result))
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
            const record = prepared.restore!
            assertSource(session, record.source)
            if (record.source.seq <= event.seq) throw new Error('Restoration requires a user message after the archive')
            const task = archived.record.task
            if (Object.hasOwn(state.tasks, task.id)) throw new Error(`Task ${task.id} already exists`)
            if (Object.keys(state.tasks).length >= maxTasks) throw new Error('Working set is full; archive a completed task first')
            change = { kind: 'save', task: taskMemorySchema.parse({ ...task, ...record, createdAtSeq: session.seq, revision: 1, requirementsRevision: task.requirementsRevision + 1, delegationRevision: 1, status: 'active', decisions: [], keyPoints: [], next: '' }) }
          } else if (args.action === 'create') {
            const record = prepared.create!
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
              if (args.expectedRevision !== task.revision) throw new Error(`Stale task ${task.id}; inspect the current state with super_code_task ${JSON.stringify({ action: 'read', taskId: task.id })} before deciding an update. No new task snapshot was appended.`)
              if (args.action === 'archive') {
                if (task.status !== 'completed' && task.status !== 'cancelled') throw new Error('Only completed or cancelled memory can be archived; stop workers separately')
                change = { kind: 'archive', task }
              } else {
                const patch = prepared.patch!
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
        if (error instanceof json.ZodError) throw invalidInput('super_code_task', args.action, error)
        throw error
      }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'super_code_memory',
    description: 'Read historical project knowledge directly: {"action":"read","topic":"build"}; topics lists names. Omit topic for the focused task topic. Add id for full detail. scope defaults to project; global holds explicit cross-project user preferences. For writes or paging use {"action":"help","forAction":"remember"}. Writes retain focused-topic, source and revision checks. Reads do not verify mutable facts or grant permission.',
    parameters: { action: { type: 'string', enum: ['help', 'topics', 'read', 'remember', 'forget'], required: true },
      forAction: { type: 'string', description: 'help only: topics, read, remember or forget.' },
      scope: { type: 'string', enum: ['project', 'global'], description: 'Default project. Global is for explicit cross-project user preferences only.' },
      topic: { type: 'string', description: 'Project read only; selects a topic without changing task focus.' },
      id: { type: 'string', description: 'Only for read or forget. Omit for topic overview.' }, record: { type: 'json' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: args => batchSafety(classifyMemoryAction(args.action)) === 'parallel',
    execute: async (args, exec) => {
      try {
        exec.signal.throwIfAborted()
        assertActionInput('super_code_memory', args)
        if (args.action === 'help') return actionHelp('super_code_memory', args.forAction!)
        if (!exec.agent) throw new Error('Long memory requires an agent-owned session')
        const prepared = prepareMemoryRecord(args, exec.agent.session.id)
        const { memory } = resourcesFor(exec.agent)
        const session = exec.agent.session
        const longMemory = ctx.get('superCodeLongMemory') as LongMemoryStore | undefined
        if (!longMemory) throw new Error('Long memory storage is unavailable')
        const scope = args.scope ?? 'project'
        if (scope !== 'project' && scope !== 'global') throw new Error('Unknown memory scope')
        const workspace = scope === 'global' ? memoryGlobalNamespace() : memoryWorkspace(session)
        if (args.action === 'topics') {
          if (args.id !== undefined) throw new Error('topics does not accept id')
          const { offset } = prepared.topics!
          const topics = scope === 'global' ? longMemory.topics(workspace).filter(item => item.topic === GLOBAL_PREFERENCES_TOPIC) : longMemory.topics(workspace)
          const page = topics.slice(offset, offset + 20)
          const nextOffset = offset + page.length
          return JSON.stringify({ topics: page, total: topics.length, nextOffset: nextOffset < topics.length ? nextOffset : undefined })
        }
        const state = args.action === 'read' && args.topic !== undefined ? undefined : (await memory.read(session, exec.signal)).state
        const task = state?.focus.kind === 'task' ? requireTaskMemory(state, state.focus.id) : undefined
        const topic = scope === 'global' ? GLOBAL_PREFERENCES_TOPIC : args.topic ?? task?.topic
        if (topic === undefined) throw new Error(args.action === 'read'
          ? 'No focused topic. Use super_code_memory {"action":"topics"}, then {"action":"read","topic":"chosen-topic"}.'
          : 'Focus a task with a topic before writing project memory; explicit topic is only supported by read.')
        const found = longMemory.read(workspace, topic)
        const current = found.kind === 'found' ? found.value : undefined
        if (args.action === 'read') {
          if (args.record !== undefined) throw new Error('read does not accept record')
          if (args.id === undefined) {
            if (!current) return JSON.stringify({ scope, topic, revision: 0, entries: [], ids: [] })
            const overview = JSON.parse(longMemoryContext(current, scope === 'global' ? 1024 : 2048, task?.sourceVersion))
            return JSON.stringify({ scope, ...overview, ids: current.entries.map(entry => entry.id) })
          }
          if (found.kind === 'missing') throw new Error(`Unknown memory ${args.id}`)
          const entry = found.value.entries.find(item => item.id === args.id)
          if (!entry) throw new Error(`Unknown memory ${args.id}`)
          const sourceSession = ctx.sessions.get(SessionId(entry.source.sessionId))
          let sourceAvailability: 'session-not-live' | 'available' | 'unavailable' | 'manual' = entry.source.kind === 'manual' ? 'manual' : 'session-not-live'
          if (sourceSession && entry.source.kind !== 'manual') {
            try {
              if (entry.source.kind === 'user') {
                assertSource(sourceSession, { seq: entry.source.eventSeq, quote: entry.source.quote })
                sourceAvailability = 'available'
              } else {
                const ref = toolEvidenceRef({ sessionId: sourceSession.id, callSeq: entry.source.callSeq, resultSeq: entry.source.eventSeq })
                sourceAvailability = readToolEvidence(sourceSession.id, ref, seq => sourceSession.eventAt(SessionSeq(seq))).kind === 'recorded' ? 'available' : 'unavailable'
              }
            } catch { sourceAvailability = 'unavailable' }
          }
          return JSON.stringify({ scope, topic, revision: found.value.revision, entry, sourceAvailability,
            basis: 'historical; tool source pair checked at write time, summary/detail not semantically verified; source availability does not reverify mutable facts or grant permission' })
        }
        if (args.action === 'remember') {
          if (args.id !== undefined) throw new Error('remember does not accept id')
          const input = prepared.remember!
          if (scope === 'global' && input.globalConfirmed !== true) throw new Error('Global memory requires explicit confirmation in this request')
          if (scope === 'project' && input.globalConfirmed !== undefined) throw new Error('globalConfirmed is only valid for global memory')
          const entries = input.entries.map(entry => {
            if (scope === 'global' && (entry.kind !== 'constraint' || entry.sourceVersion !== undefined)) {
              throw new Error('Global memory accepts only sourced user preferences')
            }
            if (entry.kind === 'constraint') {
              if (entry.source.kind !== 'user') throw new Error('A constraint needs a quoted user source')
              assertSource(session, { seq: entry.source.eventSeq, quote: entry.source.quote })
            } else {
              if (entry.source.kind !== 'tool' || entry.sourceVersion !== task?.sourceVersion) throw new Error('A fact or experience needs current tool evidence and version')
              const ref = toolEvidenceRef({ sessionId: session.id, callSeq: entry.source.callSeq, resultSeq: entry.source.eventSeq })
              const observed = readToolEvidence(session.id, ref, seq => session.eventAt(SessionSeq(seq)))
              if (observed.kind !== 'recorded' || (entry.kind === 'fact' && observed.outcome !== 'tool-returned')) {
                throw new Error('Tool source is unavailable or failed')
              }
            }
            return entry
          })
          exec.signal.throwIfAborted()
          if (!await ctx.sessions.flush(session)) throw new Error('No host persistence checkpoint is configured; memory sources are not durable')
          exec.signal.throwIfAborted()
          const saved = await longMemory.remember(workspace, topic, input.expectedRevision, entries, exec.signal)
          return JSON.stringify({ scope, topic: saved.topic, revision: saved.revision, count: saved.entries.length })
        }
        if (args.action === 'forget') {
          if (args.id === undefined) throw new Error('forget requires id')
          const input = prepared.forget!
          assertSource(session, input.source)
          exec.signal.throwIfAborted()
          if (!await ctx.sessions.flush(session)) throw new Error('No host persistence checkpoint is configured; memory sources are not durable')
          exec.signal.throwIfAborted()
          const saved = await longMemory.forget(workspace, topic, input.expectedRevision, args.id, exec.signal)
          return JSON.stringify({ scope, topic: saved.topic, revision: saved.revision, count: saved.entries.length })
        }
        throw new Error('Unsupported memory action')
      } catch (error) {
        if (error instanceof json.ZodError) throw invalidInput('super_code_memory', args.action, error)
        throw error
      }
    },
  }))
}

const plugin: { readonly name: string; readonly inject: readonly string[]; readonly Config: z<Config>; readonly apply: typeof apply } = { name, inject, Config, apply }
export default plugin
