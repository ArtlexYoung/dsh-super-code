import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { ConnectionService } from '../src/connection/service.js'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionHttp } from '../src/connection/http.js'
import { DirectoryRequests } from '../src/connection/directories.js'
import { defaultConnectionConfig } from '../src/connection/types.js'
import { invokeConnectionTool } from '../src/connection/client.js'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-settings-recovery-')), store = new ConnectionStore(join(root, 'profile'))
  const service = new ConnectionService(store, {
    preset: async () => 'super-code', create: async () => {}, prompt: async () => {}, cancel: async () => {},
    observe: async () => ({ status: 'running', output: '', detail: 'Running' }),
  })
  await service.initialize()
  t.after(async () => { try { await service.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const saved = await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: await freePort(), allowedDirectories: [root] }), '0')
  assert.ok(saved.ok)
  const http = (service as unknown as { http: ConnectionHttp }).http
  return { root, store, service, http }
}

test('saving connection settings reports a truthful recoverable state when old transport cleanup fails', async t => {
  const f = await fixture(t), close = f.http.close, before = f.service.read(), target = await freePort()
  f.http.close = async function () { await close.call(this); throw new Error('fixture old transport cleanup failed') }
  try {
    const saved = await f.service.save(JSON.stringify({ ...before.configuration, port: target }), String(before.revision))
    assert.ok(saved.ok, 'persisted settings return their actual new revision')
    assert.equal(saved.snapshot.revision, before.revision + 1)
    assert.equal(saved.snapshot.configuration.port, target)
    assert.equal(saved.snapshot.state, 'error')
    assert.equal(saved.snapshot.error, 'cleanup-failed')
    await assert.rejects(fetch(before.url))
    await assert.rejects(fetch(saved.snapshot.url))
  } finally { f.http.close = close }
  const current = f.service.read()
  const retried = await f.service.save(JSON.stringify(current.configuration), String(current.revision))
  assert.ok(retried.ok)
  assert.equal(retried.snapshot.state, 'listening')
  assert.equal(retried.snapshot.error, '')
  const response = await invokeConnectionTool({ url: retried.snapshot.url, token: f.service.reveal().token, tool: 'dsh_status', arguments: {} })
  assert.equal(response.isError, undefined)
})

test('token rotation keeps its persisted revision and can recover from failed connection cleanup', async t => {
  const f = await fixture(t), close = f.http.close, previous = f.service.reveal().token, before = f.service.read()
  f.http.close = async function () { await close.call(this); throw new Error('fixture rotate cleanup failed') }
  try {
    const rotated = await f.service.rotate(String(before.revision))
    assert.ok(rotated.ok)
    assert.equal(rotated.snapshot.state, 'error')
    assert.equal(rotated.snapshot.error, 'cleanup-failed')
    assert.notEqual(f.service.reveal().token, previous)
    assert.equal(rotated.snapshot.revision, before.revision + 1)
  } finally { f.http.close = close }
  const current = f.service.read(), token = f.service.reveal().token
  const saved = await f.service.save(JSON.stringify(current.configuration), String(current.revision))
  assert.ok(saved.ok)
  assert.equal(saved.snapshot.state, 'listening')
  const denied = await fetch(saved.snapshot.url, { headers: { authorization: `Bearer ${previous}` } })
  assert.equal(denied.status, 401); await denied.arrayBuffer()
  assert.equal((await invokeConnectionTool({ url: saved.snapshot.url, token, tool: 'dsh_status', arguments: {} })).isError, undefined)
})

test('a closing connection is read-only and rejects stale settings and token writes', async t => {
  const f = await fixture(t), before = f.service.read(), close = f.store.close
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  f.store.close = async function () { entered.resolve(); await gate.promise; await close.call(this) }
  t.after(() => gate.resolve())
  const stopping = f.service.close()
  try {
    assert.equal(f.service.read().writable, false)
    await entered.promise
    const saved = f.service.save(JSON.stringify(before.configuration), String(before.revision))
    const rotated = f.service.rotate(String(before.revision))
    gate.resolve(); await stopping
    assert.deepEqual(await saved, { ok: false, error: 'unavailable' })
    assert.deepEqual(await rotated, { ok: false, error: 'unavailable' })
    assert.equal(f.service.read().revision, before.revision)
    assert.equal(f.service.read().writable, false)
    assert.equal(f.service.read().state, 'disabled')
  } finally { gate.resolve(); await stopping; f.store.close = close }
})

test('a revoked directory grant cannot keep reporting approved when a request is polled again', async t => {
  const f = await fixture(t)
  let allowed = [await realpath(f.root)]
  const queue = new DirectoryRequests(() => allowed)
  const input = { requestId: 'previous-grant', path: f.root, reason: 'Use this workspace' }
  const first = await queue.request(input, 'client')
  assert.equal(first.status, 'approved')
  allowed = []
  assert.equal((await queue.request(input, 'client')).status, 'rejected')
  assert.deepEqual(await queue.resolve(first.id, 'approved', async () => assert.fail('Revoked consent cannot be silently granted')), { status: 'rejected' })
  const next = await queue.request({ ...input, requestId: 'new-consent' }, 'client')
  assert.equal(next.status, 'pending')
  await queue.resolve(next.id, 'approved', async path => { allowed = [path] })
  assert.equal((await queue.request({ ...input, requestId: 'new-consent' }, 'client')).status, 'approved')
})

test('a settings persistence error leaves the live endpoint, revision and token unchanged', async t => {
  const f = await fixture(t), before = f.service.read(), token = f.service.reveal().token, save = f.store.saveSettings
  f.store.saveSettings = async () => { throw new Error('fixture disk failure') }
  try {
    assert.deepEqual(await f.service.save(JSON.stringify({ ...before.configuration, port: await freePort() }), String(before.revision)), { ok: false, error: 'save-failed' })
    assert.deepEqual(await f.service.rotate(String(before.revision)), { ok: false, error: 'save-failed' })
    assert.deepEqual(f.service.read(), before)
    assert.equal(f.service.reveal().token, token)
    assert.equal((await invokeConnectionTool({ url: before.url, token, tool: 'dsh_status', arguments: {} })).isError, undefined)
  } finally { f.store.saveSettings = save }
})

for (const operation of ['save', 'rotate'] as const) {
  test(`shutdown during an already persisted ${operation} never restarts the MCP listener`, async t => {
    const f = await fixture(t), before = f.service.read(), save = f.store.saveSettings, start = f.http.start
    const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
    let starts = 0
    f.store.saveSettings = async function (value) { await save.call(this, value); entered.resolve(); await gate.promise }
    f.http.start = async function (...args) { starts++; await start.apply(this, args) }
    t.after(() => gate.resolve())
    const writing = operation === 'save'
      ? f.service.save(JSON.stringify({ ...before.configuration, port: await freePort() }), String(before.revision))
      : f.service.rotate(String(before.revision))
    try {
      await entered.promise
      const stopping = f.service.close()
      gate.resolve()
      const result = await writing
      await stopping
      assert.ok(result.ok, 'a write already persisted before shutdown remains acknowledged')
      assert.equal(result.snapshot.writable, false)
      assert.equal(result.snapshot.state, 'disabled')
      assert.equal(result.snapshot.revision, before.revision + 1)
      assert.equal(starts, 0)
      await assert.rejects(fetch(before.url))
    } finally { gate.resolve(); f.store.saveSettings = save; f.http.start = start }
  })
}

test('disabling MCP can retry cleanup without enabling the saved endpoint', async t => {
  const f = await fixture(t), before = f.service.read(), close = f.http.close
  f.http.close = async function () { await close.call(this); throw new Error('fixture disable cleanup failure') }
  try {
    const result = await f.service.save(JSON.stringify({ ...before.configuration, enabled: false }), String(before.revision))
    assert.ok(result.ok)
    assert.equal(result.snapshot.state, 'error')
    assert.equal(result.snapshot.configuration.enabled, false)
    assert.equal(result.snapshot.error, 'cleanup-failed')
  } finally { f.http.close = close }
  const current = f.service.read(), result = await f.service.save(JSON.stringify(current.configuration), String(current.revision))
  assert.ok(result.ok)
  assert.equal(result.snapshot.state, 'disabled')
  assert.equal(result.snapshot.error, '')
  await assert.rejects(fetch(before.url))
})
