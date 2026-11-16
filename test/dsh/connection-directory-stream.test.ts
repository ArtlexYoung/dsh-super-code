import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { SuperCodeConnection } from '../../src/dsh/connection.js'
import { ConnectionService } from '../../src/connection/service.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import { invokeConnectionTool } from '../../src/connection/client.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'super-code-consent-stream-')))
  const allowed = join(root, 'allowed'), requested = join(root, 'requested')
  await mkdir(allowed); await mkdir(requested)
  const ctx = new Context(), aborts: AbortController[] = []
  let attached = false
  const store = new ConnectionStore(join(root, 'profile'))
  const service = new ConnectionService(store, {
    preset: async () => assert.fail('Consent must not invoke a model or create a session'),
    create: async () => assert.fail('Consent must not create a session'),
    prompt: async () => assert.fail('Consent must not prompt'), cancel: async () => {},
    observe: async () => ({ status: 'finished', output: '', detail: '' }),
  }, () => remote.directoriesChanged())
  const remote = new SuperCodeConnection(ctx, () => attached && service)
  t.after(async () => {
    for (const abort of aborts) abort.abort()
    try { await ctx.fiber.dispose(); await service.close() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  await service.initialize()
  const attach = (value = true) => { attached = value; remote.directoriesChanged() }
  const watch = () => {
    const abort = new AbortController(); aborts.push(abort)
    return { abort, stream: remote.watchDirectories(abort.signal) }
  }
  const enable = async () => {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    await new Promise<void>(resolve => server.close(() => resolve()))
    const before = service.read()
    assert.ok((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true,
      port: address.port, allowedDirectories: [allowed] }), String(before.revision))).ok)
  }
  const request = async (requestId = 'first') => {
    const result = await invokeConnectionTool({ url: service.read().url, token: service.reveal().token,
      tool: 'dsh_request_directory', arguments: { requestId, path: requested, reason: 'Stream consent test' } })
    assert.ok(!result.isError)
    return JSON.parse((result.content as { text: string }[])[0]!.text) as { id: string }
  }
  return { ctx, root, allowed, requested, service, store, remote, watch, enable, attach, request }
}

test('directory stream stays idle when unavailable or disabled and receives initialization and new requests', { timeout: 10000 }, async t => {
  const f = await fixture(t), { stream, abort } = f.watch()
  assert.deepEqual((await stream.next()).value, [])
  const ready = stream.next(); f.attach()
  assert.deepEqual((await ready).value, [])
  let settled = false
  const update = stream.next().then(value => { settled = true; return value })
  await tick(); assert.equal(settled, false)
  await f.enable(); await tick(); assert.equal(settled, false, 'enabling without a request is not a directory change')
  const request = await f.request()
  assert.deepEqual((await update).value?.map(row => row.id), [request.id])
  const done = stream.next(); abort.abort()
  assert.equal((await done).done, true)
})

test('independent subscribers receive approval and rejection, cancellation does not affect another client', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.attach(); await f.enable()
  const first = f.watch(), second = f.watch()
  await first.stream.next(); await second.stream.next()
  const one = first.stream.next(), two = second.stream.next(), request = await f.request()
  assert.deepEqual((await one).value, (await two).value)
  const done = first.stream.next(); first.abort.abort(); assert.equal((await done).done, true)
  const approved = second.stream.next()
  assert.deepEqual(await f.remote.resolveDirectory(request.id, 'approved'), { status: 'approved' })
  assert.deepEqual((await approved).value, [])
  assert.ok(f.service.read().configuration.allowedDirectories.includes(f.requested))
  const before = f.service.read()
  assert.ok((await f.service.save(JSON.stringify({ ...before.configuration, allowedDirectories: [f.allowed] }), String(before.revision))).ok)
  const next = second.stream.next(), fresh = await f.request('fresh')
  assert.deepEqual((await next).value?.map(row => row.id), [fresh.id])
  const rejected = second.stream.next()
  await f.remote.resolveDirectory(fresh.id, 'rejected')
  assert.deepEqual((await rejected).value, [])
})

test('failed persistence leaves consent pending and does not replay a grant', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.attach(); await f.enable()
  const request = await f.request(), { stream } = f.watch()
  assert.equal((await stream.next()).value?.length, 1)
  const save = f.store.saveSettings.bind(f.store)
  let writes = 0, received = false
  f.store.saveSettings = async () => { writes++; throw new Error('Fixture storage unavailable') }
  const update = stream.next().then(value => { received = true; return value })
  await assert.rejects(f.remote.resolveDirectory(request.id, 'approved'), /storage unavailable/)
  await tick(); assert.equal(received, false); assert.equal(writes, 1)
  assert.equal(f.service.pendingDirectories().length, 1)
  assert.equal(f.service.read().configuration.allowedDirectories.includes(f.requested), false)
  f.store.saveSettings = async settings => { writes++; return save(settings) }
  await f.remote.resolveDirectory(request.id, 'approved')
  assert.deepEqual((await update).value, []); assert.equal(writes, 2)
})

test('directory replacement rejects consent and notifies subscribers without granting access', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.attach(); await f.enable()
  const request = await f.request(), { stream } = f.watch()
  await stream.next(); const update = stream.next()
  await rename(f.requested, join(f.root, 'original')); await mkdir(f.requested)
  await assert.rejects(f.remote.resolveDirectory(request.id, 'approved'), /directory-changed/)
  assert.deepEqual((await update).value, [])
  assert.equal(f.service.read().configuration.allowedDirectories.includes(f.requested), false)
})

test('disabled service withdraws consent and disposing the Remote releases a waiting stream', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.attach(); await f.enable()
  await f.request(); const { stream } = f.watch(); await stream.next()
  const update = stream.next(), before = f.service.read()
  assert.ok((await f.service.save(JSON.stringify({ ...before.configuration, enabled: false }), String(before.revision))).ok)
  assert.deepEqual((await update).value, [])
  const done = stream.next(); await f.ctx.fiber.dispose()
  assert.equal((await done).done, true)
})

test('directory changes coalesce while a consumer is paused and a late subscriber receives current state', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.attach(); await f.enable()
  const { stream } = f.watch(); await stream.next()
  const requests = [await f.request(), await f.request('second'), await f.request('third')]
  const expected = requests.map(row => row.id)
  assert.deepEqual((await stream.next()).value?.map(row => row.id), expected)
  const late = f.watch(); assert.deepEqual((await late.stream.next()).value?.map(row => row.id), expected)
  const update = stream.next(); await f.remote.resolveDirectory(requests[0]!.id, 'rejected')
  assert.deepEqual((await update).value?.map(row => row.id), expected.slice(1))
})

test('existing service observation expires consent without client polling or a new timer', { timeout: 10000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const f = await fixture(t); f.attach(); await f.enable()
  await f.request(); const { stream } = f.watch(); await stream.next()
  const expired = stream.next(); t.mock.timers.tick(300000)
  assert.deepEqual((await expired).value, [])
  assert.equal(f.service.pendingDirectories().length, 0)
})
