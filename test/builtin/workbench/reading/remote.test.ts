import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceApi } from '../../../../builtin/workbench/remote.js'

test('阅读流要求正常完成且 done 后没有额外内容，取消信号原样传递', async () => {
  const abort = new AbortController(), content = { kind: 'plan', goal: '入口' }
  const api = workspaceApi({ async *reading(session: string, json: string, signal: AbortSignal) {
    assert.equal(session, 's'); assert.deepEqual(JSON.parse(json), content); assert.equal(signal, abort.signal)
    yield { kind: 'status', stage: 'reading' }; yield { kind: 'done' }
  } }, 's')
  assert.equal((await Array.fromAsync(api.reading(content, abort.signal))).length, 2)
  await assert.rejects(Array.fromAsync(workspaceApi({ async *reading() {} }, 's').reading(content)), /WORKBENCH_MODEL_INCOMPLETE/)
  await assert.rejects(Array.fromAsync(workspaceApi({ async *reading() { yield { kind: 'done' }; yield { kind: 'done' } } }, 's').reading(content)), /READING_FORMAT/)
  const cancelled = workspaceApi({ async *reading() { abort.abort(); yield { kind: 'done' } } }, 's')
  await assert.rejects(Array.fromAsync(cancelled.reading(content, abort.signal)))
})
