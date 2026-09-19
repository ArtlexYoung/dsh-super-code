import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { taskMemoryEventOf, TASK_MEMORY_SOURCE } from '../src/task-memory-projection.js'

function message(plugin: string, text = '{"kind":"focus","id":"task-1"}'): SessionEvent {
  return {
    type: 'user/message', seq: 1, time: 1, surfaceOp: 'append',
    data: { id: 'm1', role: 'user', source: { kind: 'plugin', plugin }, content: [{ type: 'text', text }] },
  }
}

test('renamed package reads both current and persisted legacy task records', () => {
  assert.equal(TASK_MEMORY_SOURCE, 'dsh-super-code/task-memory/v1')
  for (const source of [TASK_MEMORY_SOURCE, 'dsh-super-agent/task-memory/v1']) {
    assert.deepEqual(taskMemoryEventOf(message(source)), { kind: 'record', record: { kind: 'focus', id: 'task-1' } })
    assert.throws(() => taskMemoryEventOf(message(source, '{broken')))
    assert.throws(() => taskMemoryEventOf(message(source, '{"kind":"focus","id":""}')))
  }
  assert.deepEqual(taskMemoryEventOf(message('another-plugin/task-memory/v1', '{broken')), { kind: 'unrelated' })
})
