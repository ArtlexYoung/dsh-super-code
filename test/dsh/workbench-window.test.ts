import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SuperCodeWorkbench } from '../../src/dsh/workbench.js'
import { workspaceApi } from '../../builtin/workbench/remote.js'

test('窗口 Remote 校验会话、参数与取消，双向流保持原会话边界', async t => {
  const ctx = new Context()
  new SessionStore(ctx)
  t.after(() => ctx.fiber.dispose())
  ctx.provide('fs', {})
  const session = ctx.sessions.create(SessionId('window-owner'), {})
  const other = ctx.sessions.create(SessionId('window-other'), {})
  const api = new SuperCodeWorkbench(ctx), signal = new AbortController().signal
  await assert.rejects(api.openWindow('missing', 'false', signal), /WORKBENCH_SESSION/)
  await assert.rejects(api.openWindow(session.id, 'invalid', signal))
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(api.openWindow(session.id, 'false', stopped.signal), { name: 'AbortError' })
  const address = await api.openWindow(session.id, 'false', signal)
  const url = new URL(address.url), headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' }
  const events = api.windowEvents(session.id, address.id, signal), first = events.next()
  const page = await fetch(url.origin + '/events', { headers }), reader = page.body!.getReader()
  await assert.rejects(api.windowMessage(other.id, address.id, '{}', signal), /WORKBENCH_WINDOW_CLOSED/)
  await assert.rejects(api.closeWindow(other.id, address.id, signal), /WORKBENCH_WINDOW_CLOSED/)
  await assert.rejects(api.windowMessage(session.id, address.id, '{}', stopped.signal), { name: 'AbortError' })
  await api.windowMessage(session.id, address.id, '{"kind":"state"}', signal)
  assert.match(new TextDecoder().decode((await reader.read()).value), /"kind":"state"/)
  assert.equal((await fetch(url.origin + '/message', { method: 'POST', headers, body: '{"kind":"hello"}' })).status, 204)
  assert.deepEqual((await first).value, { kind: 'message', content: '{"kind":"hello"}' })
  await api.closeWindow(session.id, address.id, signal)
  assert.equal((await events.next()).value.kind, 'closed')
  await events.return(undefined); await reader.cancel()
  await assert.rejects(fetch(url.origin))
})

test('前端窗口调用传递真实会话、字符串参数及取消信号', async () => {
  const calls: unknown[][] = [], signal = new AbortController().signal
  const api = workspaceApi({
    openWindow: async (...args: unknown[]) => { calls.push(args); return { ok: true, value: { id: 'window' } } },
    windowMessage: async (...args: unknown[]) => { calls.push(args); return { ok: true } },
    closeWindow: async (...args: unknown[]) => { calls.push(args); return { ok: false, error: { message: 'WORKBENCH_WINDOW_CLOSED' } } },
    async *windowEvents(...args: unknown[]) { calls.push(args); yield { kind: 'closed' } },
  }, 'session')
  assert.deepEqual(await api.windows.open(false, signal), { id: 'window' })
  await api.windows.send('window', '{}', signal)
  assert.deepEqual(await Array.fromAsync(api.windows.events('window', signal)), [{ kind: 'closed' }])
  await assert.rejects(api.windows.close('window', signal), /WORKBENCH_WINDOW_CLOSED/)
  assert.deepEqual(calls, [
    ['session', 'false', signal], ['session', 'window', '{}', signal],
    ['session', 'window', signal], ['session', 'window', signal],
  ])
})
