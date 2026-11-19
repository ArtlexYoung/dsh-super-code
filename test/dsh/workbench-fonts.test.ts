import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'

test('系统字体目录无需对话和模型，真实本机查询只返回名字，取消和卸载后拒绝', { timeout: 20000 }, async t => {
  const ctx = new Context(); new SessionStore(ctx)
  const session = ctx.sessions.create(SessionId('font-test'), {})
  ctx.provide('fs', { readText() { assert.fail('字体枚举不读取项目文件') } })
  const service = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  t.after(() => ctx.fiber.dispose())
  const events = session.snapshotEvents()
  if (process.platform === 'darwin') {
    const fonts = await service.fonts('', signal)
    assert.ok(fonts.includes('Menlo'))
    assert.ok(fonts.every(value => typeof value === 'string' && !value.includes('/Users/')))
    assert.deepEqual(session.snapshotEvents(), events); assert.equal(ctx.sessions.list().length, 1)
  }
  const abort = new AbortController(); abort.abort()
  await assert.rejects(service.fonts('', abort.signal), { name: 'AbortError' })
  await ctx.fiber.dispose()
  await assert.rejects(service.fonts('', signal), { name: 'AbortError' })
})
