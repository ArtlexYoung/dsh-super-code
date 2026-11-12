import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { ConnectionService } from '../../src/connection/service.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { ConnectionHttp } from '../../src/connection/http.js'
import { DirectoryRequests } from '../../src/connection/directories.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import { invokeConnectionTool } from '../../src/connection/client.js'

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

async function poll(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(check(), 'the service interval should settle within four seconds')
}

test('successful background observation clears a temporary storage warning without restarting MCP', { timeout: 6000 }, async t => {
  const f = await fixture(t), tasks = (f.service as unknown as { tasks: { tick(): Promise<void> } }).tasks
  const before = f.service.read(), token = f.service.reveal().token
  const tick = tasks.tick
  let fail = true, attempts = 0
  tasks.tick = async () => { attempts++; if (fail) throw new Error('Fixture temporary write failure') }
  t.after(() => { tasks.tick = tick })
  await poll(() => attempts >= 1 && f.service.read().error === 'storage-unavailable')
  fail = false
  await poll(() => attempts >= 2 && f.service.read().error === '')
  assert.equal(f.service.read().state, 'listening')
  assert.equal(f.service.read().revision, before.revision)
  assert.equal(f.service.reveal().token, token)
})

test('background observation failures and recovery preserve a listener startup error', { timeout: 6000 }, async t => {
  const f = await fixture(t), tasks = (f.service as unknown as { tasks: { tick(): Promise<void> } }).tasks
  const blocker = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => blocker.close(() => resolve())))
  const address = blocker.address(); assert.ok(address && typeof address !== 'string')
  const before = f.service.read()
  const saved = await f.service.save(JSON.stringify({ ...before.configuration, port: address.port }), String(before.revision))
  assert.ok(saved.ok)
  assert.equal(saved.snapshot.error, 'port-unavailable')
  const tick = tasks.tick
  let fail = true, attempts = 0
  tasks.tick = async () => { attempts++; if (fail) throw new Error('Fixture observation write failure') }
  t.after(() => { tasks.tick = tick })
  await poll(() => attempts >= 1 && !(f.service as unknown as { observing: boolean }).observing)
  assert.equal(f.service.read().error, 'port-unavailable')
  fail = false
  await poll(() => attempts >= 2 && !(f.service as unknown as { observing: boolean }).observing)
  assert.equal(f.service.read().error, 'port-unavailable')
  assert.equal(f.service.read().state, 'error')
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

for (const replacement of ['missing', 'file', 'symlink'] as const) {
  test(`MCP can be disabled after its allowed directory becomes ${replacement}, without changing its grant`, async t => {
    const f = await fixture(t), directory = join(f.root, '中文 工作目录')
    await mkdir(directory)
    let current = f.service.read()
    const selected = await f.service.save(JSON.stringify({ ...current.configuration, allowedDirectories: [directory], knownDirectories: [directory] }), String(current.revision))
    assert.ok(selected.ok)
    const path = selected.snapshot.configuration.allowedDirectories[0]!, backup = join(f.root, 'original')
    await rename(path, backup)
    if (replacement === 'file') await writeFile(path, 'This is no longer a directory')
    if (replacement === 'symlink') await symlink(await realpath(f.root), path, 'junction')

    current = f.service.read()
    const disabled = await f.service.save(JSON.stringify({ ...current.configuration, enabled: false }), String(current.revision))
    assert.ok(disabled.ok, 'an unavailable saved directory must not prevent the user from stopping admission')
    assert.equal(disabled.snapshot.state, 'disabled')
    assert.equal(disabled.snapshot.configuration.enabled, false)
    assert.deepEqual(disabled.snapshot.configuration.allowedDirectories, [path], 'disabling does not clear a saved grant or follow a replacement symlink')
    assert.deepEqual((await f.store.settings()).config.allowedDirectories, [path])
    await assert.rejects(fetch(current.url))
    if (replacement !== 'symlink') {
      assert.deepEqual(await f.service.save(JSON.stringify({ ...disabled.snapshot.configuration, enabled: true }), String(disabled.snapshot.revision)), { ok: false, error: 'invalid' })
      assert.deepEqual(f.service.read(), disabled.snapshot, 'reenabling must validate all grants and leave the disabled state unchanged on failure')
    }
    if (replacement !== 'missing') await rm(path)
    await rename(backup, path)
    const restored = await f.service.save(JSON.stringify({ ...disabled.snapshot.configuration, enabled: true }), String(disabled.snapshot.revision))
    assert.ok(restored.ok)
    assert.equal(restored.snapshot.state, 'listening')
    assert.equal((await invokeConnectionTool({ url: restored.snapshot.url, token: f.service.reveal().token, tool: 'dsh_status', arguments: {} })).isError, undefined)
  })
}

test('a disabled MCP still rejects a newly added unavailable directory', async t => {
  const f = await fixture(t), before = f.service.read()
  const disabled = await f.service.save(JSON.stringify({ ...before.configuration, enabled: false }), String(before.revision))
  assert.ok(disabled.ok)
  const invalid = await f.service.save(JSON.stringify({ ...disabled.snapshot.configuration,
    allowedDirectories: [...disabled.snapshot.configuration.allowedDirectories, join(f.root, 'missing-new-grant')] }), String(disabled.snapshot.revision))
  assert.deepEqual(invalid, { ok: false, error: 'invalid' })
  assert.deepEqual(f.service.read(), disabled.snapshot)
})

test('a disabled connection with an unavailable saved directory survives restart and further settings changes', async t => {
  const f = await fixture(t), directory = join(f.root, 'workspace')
  await mkdir(directory)
  const before = f.service.read()
  const selected = await f.service.save(JSON.stringify({ ...before.configuration, allowedDirectories: [directory] }), String(before.revision))
  assert.ok(selected.ok)
  const path = selected.snapshot.configuration.allowedDirectories[0]!
  await rename(path, join(f.root, 'original-workspace'))
  const disabled = await f.service.save(JSON.stringify({ ...selected.snapshot.configuration, enabled: false }), String(selected.snapshot.revision))
  assert.ok(disabled.ok)
  await f.service.close()
  const restarted = new ConnectionService(new ConnectionStore(join(f.root, 'profile')), {
    preset: async () => assert.fail('No model task is needed'), create: async () => assert.fail('No conversation should be created'),
    prompt: async () => assert.fail('No prompt should be sent'), cancel: async () => {},
    observe: async () => assert.fail('No model task is needed'),
  })
  await restarted.initialize()
  try {
    assert.deepEqual(restarted.read(), disabled.snapshot)
    const changed = await restarted.save(JSON.stringify({ ...disabled.snapshot.configuration, maxConnections: 5 }), String(disabled.snapshot.revision))
    assert.ok(changed.ok)
    assert.equal(changed.snapshot.state, 'disabled')
    assert.equal(changed.snapshot.configuration.maxConnections, 5)
    assert.equal(changed.snapshot.configuration.maxConcurrent, 5)
    assert.deepEqual(changed.snapshot.configuration.allowedDirectories, [path])
    await assert.rejects(fetch(changed.snapshot.url))
  } finally { await restarted.close() }
})
