import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { emptyTaskMemory, foldTaskMemory, taskMemoryStateSchema, taskMemoryEventSchema } from './core/task-memory.js'
import type { TaskMemoryState, TaskMemoryEvent } from './core/task-memory.js'
import { z } from 'zod'

export interface TaskMemoryView {
  tasks: { id: string; title: string; status: string }[]
  current: { kind: 'none' } | { kind: 'task'; id: string; title: string; goal: string; status: string; next: string }
}
const viewSchema: z.ZodType<TaskMemoryView> = z.object({
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() }).strict()),
  current: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('task'), id: z.string(), title: z.string(), goal: z.string(), status: z.string(), next: z.string() }).strict()]),
}).strict()

/** The browser needs a task summary, never the durable source quotes or evidence. */
export function taskMemoryView(state: TaskMemoryState): TaskMemoryView {
  const tasks = Object.values(state.tasks).map(({ id, title, status }) => ({ id, title, status }))
  if (state.focus.kind === 'none') return { tasks, current: { kind: 'none' } }
  const task = state.tasks[state.focus.id]
  if (!task) throw new Error('Task memory focus is missing')
  const { id, title, goal, status, next } = task
  return { tasks, current: { kind: 'task', id, title, goal, status, next } }
}

export const TASK_MEMORY_SOURCE = 'dsh-super-code/task-memory/v1'
// Persisted records from before the package rename must remain readable.
const LEGACY_TASK_MEMORY_SOURCE = 'dsh-super-agent/task-memory/v1'

/** Known host message vocabulary keeps external plugin records resumable. */
export function taskMemoryEventOf(event: SessionEvent): { kind: 'record'; record: TaskMemoryEvent } | { kind: 'unrelated' } {
  if (event.type !== 'user/message' || event.data.source.kind !== 'plugin') return { kind: 'unrelated' }
  if (event.data.source.plugin !== TASK_MEMORY_SOURCE && event.data.source.plugin !== LEGACY_TASK_MEMORY_SOURCE) return { kind: 'unrelated' }
  const content = event.data.content
  if (content.length !== 1 || content[0]?.type !== 'text') throw new Error('Malformed task-memory record')
  return { kind: 'record', record: taskMemoryEventSchema.parse(JSON.parse(content[0].text)) }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { superCodeTasks: TaskMemoryState }
  interface SessionProjectionMap { superCodeTasks: TaskMemoryView }
}

/** Host checkpoints restore the bounded working set without summarizing summaries. */
export const taskMemoryProjection: ProjectionDefinition<'superCodeTasks', TaskMemoryState> & {
  wire: NonNullable<ProjectionDefinition<'superCodeTasks', TaskMemoryState>['wire']>
} = {
  key: 'superCodeTasks', stateVersion: 1, stateSchema: taskMemoryStateSchema,
  init: () => emptyTaskMemory(),
  apply: (state, event) => {
    const record = taskMemoryEventOf(event)
    if (record.kind === 'record') return foldTaskMemory(state, record.record)
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      return { ...state, recentSources: [...state.recentSources.slice(-7), event.seq] }
    }
    return state
  },
  wire: { viewSchema, view: taskMemoryView },
}
