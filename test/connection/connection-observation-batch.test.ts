import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validationRoot } from '../validation-root.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'

test('同轮观察一次保存全部变化，落盘失败不发布半批状态，恢复后不重放任务', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'observation-batch-'))
  const store = new ConnectionStore(join(root, 'profile'))
  let revision = 0, prompts = 0, saves = 0, fail = false
  const host = {
    preset: async () => 'super-code', create: async () => {}, cancel: async () => {},
    prompt: async () => { prompts++ },
    observe: async () => ({ status: 'running' as const, output: `结果 ${revision}`, detail: `进度 ${revision}` }),
  }
  const tasks = new DelegatedTasks(store, host, () => ({ ...defaultConnectionConfig, enabled: true, allowedDirectories: [root] }))
  t.after(async () => { await tasks.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  await store.initialize()
  await tasks.initialize()
  for (let i = 0; i < 3; i++) {
    const cwd = join(root, `workspace-${i}`)
    await mkdir(cwd)
    await tasks.run({ requestId: `request-${i}`, cwd, prompt: '继续任务' })
  }
  const save = store.saveTasks.bind(store)
  t.mock.method(store, 'saveTasks', async records => {
    saves++
    if (fail) throw new Error('受控落盘失败')
    await save(records)
  })
  revision = 1
  await tasks.tick()
  assert.equal(saves, 1, '同一轮三个任务的变化只提交一次')
  assert.deepEqual((await store.tasks()).map(row => row.output), ['结果 1', '结果 1', '结果 1'])
  const before = tasks.overview(), persisted = await store.tasks()
  revision = 2; fail = true
  await assert.rejects(tasks.tick(), /受控落盘失败/)
  assert.deepEqual(tasks.overview(), before)
  assert.deepEqual(await store.tasks(), persisted)
  fail = false
  await tasks.tick()
  assert.equal(saves, 3)
  assert.deepEqual((await store.tasks()).map(row => row.output), ['结果 2', '结果 2', '结果 2'])
  assert.equal(prompts, 3, '观察失败与恢复都不能重放任务')
  const unchanged = saves
  await tasks.tick()
  assert.equal(saves, unchanged, '无变化时不写入')
})
