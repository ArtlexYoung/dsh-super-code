import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { emptyTaskMemory, foldTaskMemory, taskMemoryStateSchema, taskMemoryEventSchema } from './core/task-memory.js'
import type { TaskMemoryState, TaskMemoryEvent } from './core/task-memory.js'

export const TASK_MEMORY_SOURCE = 'dsh-super-agent/task-memory/v1'

/** Known host message vocabulary keeps external plugin records resumable. */
export function taskMemoryEventOf(event: SessionEvent): { kind: 'record'; record: TaskMemoryEvent } | { kind: 'unrelated' } {
  if (event.type !== 'user/message' || event.data.source.kind !== 'plugin' || event.data.source.plugin !== TASK_MEMORY_SOURCE) return { kind: 'unrelated' }
  const content = event.data.content
  if (content.length !== 1 || content[0]?.type !== 'text') throw new Error('Malformed task-memory record')
  return { kind: 'record', record: taskMemoryEventSchema.parse(JSON.parse(content[0].text)) }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { superCodeTasks: TaskMemoryState }
  interface SessionProjectionMap { superCodeTasks: TaskMemoryState }
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
  wire: { viewSchema: taskMemoryStateSchema, view: state => state },
}
