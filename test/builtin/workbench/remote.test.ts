import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceApi } from '../../../builtin/workbench/remote.js'

test('选区助手等待流完整结束后返回结果，流失败时不接受部分修改', async () => {
  const result = { kind: 'edit', replacement: 'count' }
  const remote = { async *assist() { yield result } }
  assert.deepEqual(await workspaceApi(remote, 'session').assist({}, new AbortController().signal), result)
  await assert.rejects(workspaceApi({ async *assist() {} }, 'session').assist({}), /WORKBENCH_MODEL_INCOMPLETE/)
  const failure = { async *assist() { yield result; throw new Error('connection closed') } }
  await assert.rejects(workspaceApi(failure, 'session').assist({}), /connection closed/)
})

test('选区助手把取消信号交给宿主流，取消后不返回修改', async () => {
  const started = Promise.withResolvers<void>(), abort = new AbortController()
  const remote = { async *assist(sessionId: string, content: string, signal: AbortSignal) {
    assert.equal(sessionId, 'session')
    assert.deepEqual(JSON.parse(content), { instruction: '修改' })
    started.resolve()
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    yield { kind: 'edit', replacement: 'late' }
  } }
  const pending = workspaceApi(remote, 'session').assist({ instruction: '修改' }, abort.signal)
  await started.promise
  abort.abort()
  await assert.rejects(pending)
})

test('Git 请求使用当前会话的流，空流或中途失败不返回成功状态', async () => {
  const signal = new AbortController().signal
  const result = { kind: 'state', state: { backend: 'builtin' } }
  const remote = { async *git(sessionId: string, content: string, received: AbortSignal) {
    assert.equal(sessionId, 'git-session'); assert.deepEqual(JSON.parse(content), { action: 'status' }); assert.equal(received, signal)
    yield result
  } }
  assert.deepEqual(await workspaceApi(remote, 'git-session').git({ action: 'status' }, signal), result)
  await assert.rejects(workspaceApi({ async *git() {} }, 's').git({ action: 'status' }), /WORKBENCH_GIT_INCOMPLETE/)
  await assert.rejects(workspaceApi({ async *git() { yield result; throw new Error('interrupted') } }, 's').git({ action: 'status' }), /interrupted/)
})
