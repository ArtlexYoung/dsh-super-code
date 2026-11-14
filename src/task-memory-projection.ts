import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { emptyTaskMemory, foldTaskMemory, taskMemoryStateSchema, taskMemoryEventSchema } from './core/task-memory.js'
import type { TaskMemoryState, TaskMemoryEvent } from './core/task-memory.js'
import { z } from 'zod'
import { recordedToolResult } from './core/host-messages.js'

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
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'dsh-super-code/task-memory/v1': { kind: 'dsh-super-code/task-memory/v1' } }
}
// Persisted records from before the package rename must remain readable.
const LEGACY_TASK_MEMORY_SOURCE = 'dsh-super-agent/task-memory/v1'
const taskMemorySources = new Set([TASK_MEMORY_SOURCE, LEGACY_TASK_MEMORY_SOURCE])

/** V4 prefixes migrated plugin wrappers; native producer kinds remain unchanged. */
export function taskMemoryEventOf(event: SessionEvent): { kind: 'record'; record: TaskMemoryEvent } | { kind: 'unrelated' } {
  if (event.type !== 'user/message') return { kind: 'unrelated' }
  const source = event.data.source as { kind: string; plugin?: string }
  const producer = source.kind === 'plugin' ? source.plugin ?? ''
    : source.kind.startsWith('plugin:') ? source.kind.slice('plugin:'.length) : source.kind
  if (!taskMemorySources.has(producer)) return { kind: 'unrelated' }
  const content = event.data.content
  if (content.length !== 1 || content[0]?.type !== 'text') throw new Error('Malformed task-memory record')
  return { kind: 'record', record: taskMemoryEventSchema.parse(JSON.parse(content[0].text)) }
}
export interface TaskProjectionState { legacy: TaskMemoryState; view: TaskMemoryView; calls: string[] }
const projectionSchema: z.ZodType<TaskProjectionState> = z.object({
  legacy: taskMemoryStateSchema, view: viewSchema, calls: z.array(z.string()),
}).strict()

/** 只读取真实任务工具的回执；用户文字和其他工具输出不能成为任务状态。 */
export function taskMemoryToolResultOf(event: SessionEvent, calls: ReadonlySet<string> = new Set()): {
  callId: string; recordId?: string; view: TaskMemoryView
} | undefined {
  let callId: string, texts: string[]
  if (event.type === 'tool/ptc-dispatch' && event.data.name === 'super_code_task' && !event.data.isError) {
    callId = event.data.subCallId; texts = event.data.content.filter(block => block.type === 'text').map(block => block.text)
  } else if (event.type === 'tool/result') {
    const result = recordedToolResult(event.data.message)
    if (result.kind !== 'record' || result.isError || !calls.has(result.callId)) return undefined
    callId = result.callId; texts = result.texts
  } else return undefined
  if (texts.length !== 1) return undefined
  let value: unknown
  try { value = JSON.parse(texts[0]!) } catch { return undefined }
  const parsed = z.object({ taskView: viewSchema, recordId: z.string().optional(), action: z.string().optional() }).passthrough().safeParse(value)
  if (!parsed.success) return undefined
  const write = ['create', 'update', 'focus', 'archive', 'restore'].includes(parsed.data.action ?? '')
  return { callId, view: parsed.data.taskView, ...(write && parsed.data.recordId ? { recordId: z.uuid().parse(parsed.data.recordId) } : {}) }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { superCodeTasks: TaskProjectionState }
  interface SessionProjectionMap { superCodeTasks: TaskMemoryView }
}

/** Host checkpoints restore the bounded working set without summarizing summaries. */
export const taskMemoryProjection: ProjectionDefinition<'superCodeTasks', TaskProjectionState> & {
  wire: NonNullable<ProjectionDefinition<'superCodeTasks', TaskProjectionState>['wire']>
} = {
  // 任务完整数据由独立存储负责，投影只保留历史读取和界面摘要。
  key: 'superCodeTasks', stateVersion: 3, stateSchema: projectionSchema,
  init: () => ({ legacy: emptyTaskMemory(), view: taskMemoryView(emptyTaskMemory()), calls: [] }),
  apply: (state, event) => {
    const record = taskMemoryEventOf(event)
    if (record.kind === 'record') {
      const legacy = foldTaskMemory(state.legacy, record.record)
      return { ...state, legacy, view: taskMemoryView(legacy) }
    }
    if (event.type === 'tool/call' && event.data.name === 'super_code_task') return { ...state, calls: [...state.calls, event.data.callId] }
    const receipt = taskMemoryToolResultOf(event, new Set(state.calls))
    const result = event.type === 'tool/result' ? recordedToolResult(event.data.message) : undefined
    const calls = result?.kind === 'record' && state.calls.includes(result.callId)
      ? state.calls.filter(id => id !== result.callId) : state.calls
    if (receipt || calls !== state.calls) return { ...state, calls, view: receipt?.view ?? state.view }
    return state
  },
  wire: { viewSchema, view: state => state.view },
}
