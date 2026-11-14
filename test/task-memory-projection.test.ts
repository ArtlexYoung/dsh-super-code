import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { taskMemoryProjection } from '../src/task-memory-projection.js'

const taskView = { tasks: [{ id: 'a', title: 'A', status: 'active' }], current: { kind: 'task', id: 'a', title: 'A', goal: 'Build', status: 'active', next: 'Check' } }
const text = JSON.stringify({ recordId: '1d40c701-cc94-4af8-bba4-9e1d0ee79a71', taskView })
const result = (name: string): SessionEvent => ({ type: 'tool/ptc-dispatch', seq: 1, time: 0, data: {
  rootCallId: 'root', parentCallId: 'root', subCallId: 'task-call', name, arguments: {}, isError: false, content: [{ type: 'text', text }],
} } as unknown as SessionEvent)

test('task views come from actual PTC task results and remain separate from legacy task data', () => {
  const state = taskMemoryProjection.init({} as never, 0 as never)
  assert.equal(taskMemoryProjection.apply(state, result('bash')), state)
  const updated = taskMemoryProjection.apply(state, result('super_code_task'))
  assert.deepEqual(taskMemoryProjection.wire.view(updated), taskView)
  assert.deepEqual(updated.legacy.tasks, {}, 'A view is never imported as authoritative task data')
})

test('native task view requires a matching task call and ignores failed results', () => {
  const state = taskMemoryProjection.init({} as never, 0 as never), callId = ToolCallId('native-task')
  const result: SessionEvent = { type: 'tool/result', seq: 2, time: 0, surfaceOp: 'append', data: {
    turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false }),
  } }
  assert.equal(taskMemoryProjection.apply(state, result), state)
  const called = taskMemoryProjection.apply(state, { type: 'tool/call', seq: 1, time: 0, data: { turn: 1, step: 1, callId, name: 'super_code_task', arguments: '{}' } })
  const updated = taskMemoryProjection.apply(called, result)
  assert.deepEqual(updated.view, taskView)
  assert.deepEqual(updated.calls, [])
  const failed = { ...result, data: { ...result.data, message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: true }) } } as SessionEvent
  assert.deepEqual(taskMemoryProjection.apply(called, failed).view, state.view)
})
