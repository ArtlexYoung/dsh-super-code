import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { ConnectionService } from '../../src/connection/service.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { DelegationHost, HostObservation } from '../../src/connection/types.js'
import { invokeConnectionTool } from '../../src/connection/client.js'

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-observation-'))
  const socket = createServer()
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => socket.close(() => resolve()))
  const host: DelegationHost & { observation: HostObservation; prompts: number } = {
    observation: { status: 'running', output: '', detail: '受控任务仍在运行' }, prompts: 0,
    preset: async () => 'super-code', create: async () => {}, cancel: async () => {},
    prompt: async () => { host.prompts++ }, observe: async () => host.observation,
  }
  let service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host)
  const tick = DelegatedTasks.prototype.tick
  let ticks = 0, settled = Promise.withResolvers<void>()
  t.mock.method(DelegatedTasks.prototype, 'tick', async function (this: DelegatedTasks) {
    ticks++
    try { await tick.call(this) } finally { settled.resolve() }
  })
  t.mock.timers.enable({ apis: ['setInterval'] })
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  await service.initialize()
  const save = async (enabled: boolean): Promise<void> => {
    const before = service.read()
    const result = await service.save(JSON.stringify({ ...defaultConnectionConfig, ...before.configuration,
      enabled, allowedDirectories: [root], port: address.port }), String(before.revision))
    assert.equal(result.ok, true)
  }
  const advance = async (expected: number): Promise<void> => {
    const before = ticks
    settled = Promise.withResolvers<void>()
    t.mock.timers.tick(3000)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(ticks, expected)
    if (expected > before) await settled.promise
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  return { host, save, advance, service: () => service,
    async run(): Promise<void> {
      const result = await invokeConnectionTool({ tool: 'dsh_run', url: service.read().url,
        token: service.reveal().token, arguments: { cwd: root, requestId: 'observation-lifecycle', prompt: '受控任务' } })
      assert.equal(result.isError, undefined)
      assert.equal(service.overview().sessions[0]?.status, 'running')
    },
    async reopen(): Promise<void> {
      await service.close()
      service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host)
      await service.initialize()
    } }
}

test('关闭且空闲的MCP入口不轮询，重复启用只保留一份轮询', async t => {
  const f = await fixture(t)
  await f.advance(0)
  await f.save(true)
  await f.save(true)
  await f.advance(1)
  await f.save(false)
  // 没有任务时关闭入口即清理轮询，不需要关闭整个插件。
  await f.advance(1)
  await f.save(true)
  await f.advance(2)
  await f.service().close()
  await f.advance(2)
})

test('关闭MCP入口仍跟踪已启动任务，任务结束后释放轮询', async t => {
  const f = await fixture(t)
  await f.save(true)
  await f.run()
  await f.save(false)
  assert.equal(f.service().read().state, 'disabled')
  await f.advance(1)
  assert.equal(f.service().overview().sessions[0]?.status, 'running')
  f.host.observation = { status: 'finished', output: '42', detail: '受控任务已完成' }
  await f.advance(2)
  assert.equal(f.service().overview().sessions[0]?.status, 'finished')
  assert.equal(f.host.prompts, 1)
  await f.advance(2)
})

test('关闭状态冷启动仍核对中断任务，不重新发送请求', async t => {
  const f = await fixture(t)
  await f.save(true)
  await f.run()
  await f.save(false)
  await f.reopen()
  assert.equal(f.service().overview().sessions[0]?.status, 'interrupted')
  f.host.observation = { status: 'finished', output: '42', detail: '回读原任务' }
  await f.advance(1)
  assert.equal(f.service().overview().sessions[0]?.status, 'finished')
  assert.equal(f.host.prompts, 1)
  await f.advance(1)
})
