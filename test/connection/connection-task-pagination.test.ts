import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validationRoot } from '../validation-root.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { DelegatedTask } from '../../src/connection/types.js'

test('任务分页保留完整倒序语义、游标和返回对象隔离', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'pagination-'))
  const store = new ConnectionStore(join(root, 'profile'))
  await store.initialize()
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const host = {
    preset: async () => 'super-code', create: async () => {}, prompt: async () => {}, cancel: async () => {},
    observe: async () => { throw new Error('终态列表不应观察宿主') },
  }
  for (const size of [0, 1, 20, 25, 26, 200]) {
    const rows: DelegatedTask[] = Array.from({ length: size }, (_, index) => {
      const id = `sc-00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
      return { id, sessionId: id, requestId: `request-${index}`, fingerprint: 'a'.repeat(64), cwd: root,
        preset: 'super-code', client: '测试', status: 'finished', cancellationRequested: false,
        createdAt: index, updatedAt: index, currentRequest: `request-${index}`, output: '', sequence: 0,
        events: [], operations: {}, baseline: { available: false, root: '', head: '', fingerprint: '', dirty: [] } }
    })
    await store.saveTasks(rows)
    const tasks = new DelegatedTasks(store, host, () => defaultConnectionConfig)
    await tasks.initialize()
    try {
      const reversed = [...rows].reverse()
      for (let cursor = 0; cursor <= 225; cursor++) {
        const page = await tasks.list(cursor)
        assert.deepEqual(page, {
          tasks: reversed.slice(cursor, cursor + 25).map(row => ({ taskId: row.id, sessionId: row.sessionId,
            cwd: row.cwd, client: row.client, status: row.status, updatedAt: row.updatedAt })),
          nextCursor: cursor + 25 < size ? cursor + 25 : false,
        })
      }
      const first = await tasks.list(0)
      if (first.tasks.length) {
        first.tasks[0]!.client = '调用方修改'
        assert.equal((await tasks.list(0)).tasks[0]!.client, '测试')
      }
    } finally { await tasks.close() }
  }
})
