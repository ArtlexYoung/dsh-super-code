import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { HostObservation } from '../../src/connection/types.js'
import { validationRoot } from '../validation-root.js'

async function fixture(t: test.TestContext) {
  await mkdir(validationRoot, { recursive: true })
  const dir = await mkdtemp(join(validationRoot, 'wait-notification-'))
  const store = new ConnectionStore(join(dir, 'profile'))
  let status: HostObservation['status'] = 'running', observations = 0
  const host = {
    preset: async () => 'super-code', create: async () => {}, prompt: async () => {},
    cancel: async () => { status = 'interrupted' },
    observe: async () => { observations++; return { status, output: status, detail: status } },
  }
  const config = { ...defaultConnectionConfig, enabled: true, allowedDirectories: [dir], allowNewConversations: true }
  const tasks = new DelegatedTasks(store, host, () => config)
  t.after(async () => { await tasks.close(); await store.close(); await rm(dir, { recursive: true, force: true }) })
  await store.initialize()
  await tasks.initialize()
  const created = await tasks.run({ cwd: dir, requestId: 'run', prompt: 'run' })
  const view = await tasks.wait(created.taskId, created.cursor, 0)
  return { store, tasks, view, status: (value: HostObservation['status']) => { status = value }, observations: () => observations }
}

test('成功落盘后立即唤醒且返回完整状态，未知任务不遗留监听', async t => {
  const f = await fixture(t)
  let settled = false
  const wait = f.tasks.wait(f.view.taskId, f.view.cursor, 5000).then(value => { settled = true; return value })
  await pause(50)
  assert.equal(settled, false)
  f.status('finished')
  const at = performance.now()
  await f.tasks.tick()
  const result = await wait
  assert.ok(performance.now() - at < 700)
  assert.equal(result.status, 'finished')
  assert.equal(result.output, 'finished')
  assert.equal((f.tasks as any).waiters.size, 0)
  await assert.rejects(f.tasks.wait('missing', 0, 10), /task-not-found/)
  assert.equal((f.tasks as any).waiters.size, 0)
})

test('持久化失败不唤醒旧状态，恢复后一次发布成功状态', async t => {
  const f = await fixture(t), save = f.store.saveTasks.bind(f.store)
  let settled = false, fail = true
  t.mock.method(f.store, 'saveTasks', async records => { if (fail) throw new Error('disk'); await save(records) })
  const wait = f.tasks.wait(f.view.taskId, f.view.cursor, 5000).then(value => { settled = true; return value })
  await pause(50)
  f.status('finished')
  try {
    await assert.rejects(f.tasks.tick(), /disk/)
    await pause(80)
    assert.equal(settled, false)
    assert.equal((await f.store.tasks())[0]!.status, 'running')
  } finally { fail = false }
  await f.tasks.tick()
  assert.equal((await wait).status, 'finished')
  assert.equal((f.tasks as any).waiters.size, 0)
})

test('取消等待、超时和关闭均清理资源，保留取消错误且关闭后不再观察', async t => {
  const f = await fixture(t)
  for (const reason of [undefined, new Error('自定义取消原因')]) {
    const controller = new AbortController()
    const wait = f.tasks.wait(f.view.taskId, f.view.cursor, 5000, controller.signal)
    await pause(30)
    controller.abort(reason)
    await assert.rejects(wait, (error: any) => error.name === 'AbortError' && error.code === 'ABORT_ERR' && error.cause === controller.signal.reason)
    assert.equal((f.tasks as any).waiters.size, 0)
  }
  await f.tasks.wait(f.view.taskId, f.view.cursor, 20)
  assert.equal((f.tasks as any).waiters.size, 0)
  const waiting = f.tasks.wait(f.view.taskId, f.view.cursor, 5000)
  await pause(30)
  const before = f.observations()
  await f.tasks.close()
  await waiting
  assert.equal((f.tasks as any).waiters.size, 0)
  assert.equal(f.observations(), before)
})

test('快照返回前的并发提交不会丢失通知，并发等待各自释放', async t => {
  const f = await fixture(t)
  const waits = Array.from({ length: 8 }, () => f.tasks.wait(f.view.taskId, f.view.cursor, 5000))
  f.status('finished')
  await f.tasks.tick()
  for (const row of await Promise.all(waits)) assert.equal(row.status, 'finished')
  assert.equal((f.tasks as any).waiters.size, 0)
})
