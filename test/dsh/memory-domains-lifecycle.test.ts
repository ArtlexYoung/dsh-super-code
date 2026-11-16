import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { apply } from '../../src/dsh/memory-domains.js'
import { taskMemoryDomainSpec } from '../../src/task-memory-store.js'

for (const delayed of ['super_code_tasks', 'super_code_memory']) {
  test(`卸载期间才打开的${delayed}域必须释放且不发布服务`, async t => {
    const ctx = new Context(), entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
    const opened: string[] = [], closed: string[] = []
    t.after(async () => { gate.resolve(); await ctx.fiber.dispose() })
    new SessionStore(ctx)
    ctx.provide('storageDomain', { open: async (spec: { name: string }) => {
      if (spec.name === delayed) { entered.resolve(); await gate.promise }
      opened.push(spec.name)
      return { table: () => new Map(), close: async () => { closed.push(spec.name) } }
    } } as never)
    const plugin = ctx.plugin({ apply })
    await entered.promise
    const stopping = plugin.dispose()
    await new Promise<void>(resolve => setImmediate(resolve))
    gate.resolve()
    await stopping
    assert.equal(closed.filter(name => name === delayed).length, 1)
    assert.deepEqual([...closed].sort(), [...opened].sort())
    assert.equal(ctx.get('superCodeLongMemory'), undefined)
    assert.equal(ctx.get('superCodeTaskMemory'), undefined)
  })
}

for (const failed of ['super_code_tasks', 'super_code_memory']) {
  test(`${failed}域初始化失败立即释放，另一个域继续可用`, async t => {
    const ctx = new Context(), closed: string[] = []
    t.after(() => ctx.fiber.dispose())
    new SessionStore(ctx)
    ctx.provide('storageDomain', { open: async (spec: { name: string }) => ({
      table: () => {
        if (spec.name === failed) throw new Error('受控表接口异常')
        return new Map()
      },
      close: async () => { closed.push(spec.name) },
    }) } as never)
    const plugin = ctx.plugin({ apply })
    await plugin
    assert.deepEqual([...closed], [failed])
    assert.equal(!!ctx.get('superCodeTaskMemory'), failed !== 'super_code_tasks')
    assert.equal(!!ctx.get('superCodeLongMemory'), failed !== 'super_code_memory')
    await plugin.dispose()
    assert.deepEqual([...closed].sort(), ['super_code_memory', 'super_code_tasks'])
  })
}

test('真实存储中的任务序号缺口释放域且保留数据，显式修复后重启恢复', async t => {
  const ctx = new Context(), root = await mkdtemp(join(tmpdir(), 'super-code-domain-recovery-'))
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  new SessionStore(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const facility = ctx.storageDomain, recordId = randomUUID()
  const record = { recordId, sessionId: 'domain-recovery', callId: 'source', index: 1,
    sourceEnd: 0, change: { kind: 'focus' as const, id: 'saved-task' } }
  const seed = await facility.open(taskMemoryDomainSpec)
  await seed.table('records').put(recordId, record)
  await seed.close()
  const plugin = ctx.plugin({ apply })
  await plugin
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(facility.get(taskMemoryDomainSpec.name), undefined)
  assert.equal(ctx.get('superCodeTaskMemory'), undefined)
  assert.ok(ctx.get('superCodeLongMemory'))
  const repair = await facility.open(taskMemoryDomainSpec)
  assert.deepEqual(repair.table('records').get(recordId), record)
  await repair.table('records').put(recordId, { ...record, index: 0 })
  await repair.close()
  await plugin.restart()
  assert.ok(ctx.get('superCodeTaskMemory'))
  assert.ok(ctx.get('superCodeLongMemory'))
})
