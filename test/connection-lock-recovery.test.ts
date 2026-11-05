import test from 'node:test'
import assert from 'node:assert/strict'
import { access, chmod, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionService } from '../src/connection/service.js'
import type { ConnectionHttp } from '../src/connection/http.js'

const permissionTest = { skip: process.platform === 'win32' || process.getuid?.() === 0 }

for (const stage of ['write', 'sync', 'close'] as const) test(`failed initial owner ${stage} releases only its own lock and can retry`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-lock-claim-')), store = new ConnectionStore(root)
  const original = fs.open, failure = new Error(`initial ${stage} failed`)
  let failed = false
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  t.mock.method(fs, 'open', async (...args: Parameters<typeof original>) => {
    const file = await original(...args)
    if (String(args[0]) !== join(root, 'owner.lock') || failed) return file
    return new Proxy(file, { get(target, key) {
      if (key === ({ write: 'writeFile', sync: 'sync', close: 'close' }[stage])) return async (...parameters: any[]) => {
        if (!failed) {
          failed = true
          if (stage === 'write') await target.writeFile('partial')
          if (stage === 'close') await target.close()
          throw failure
        }
        return Reflect.apply(Reflect.get(target, key), target, parameters)
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  syncBuiltinESMExports()
  try { await assert.rejects(store.initialize(), error => error === failure) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  await assert.rejects(access(join(root, 'owner.lock')), { code: 'ENOENT' })
  await store.initialize(); await store.saveTasks([]); await store.close()
})

test('failed initial owner write cannot remove a replacement lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-lock-replaced-')), store = new ConnectionStore(root)
  const original = fs.open, failure = new Error('owner replaced during failure'), foreign = `${process.pid}:replacement`
  t.after(() => rm(root, { recursive: true, force: true }))
  t.mock.method(fs, 'open', async (...args: Parameters<typeof original>) => {
    const file = await original(...args)
    if (String(args[0]) !== join(root, 'owner.lock')) return file
    return new Proxy(file, { get(target, key) {
      if (key === 'writeFile') return async () => {
        await fs.rename(join(root, 'owner.lock'), join(root, 'failed.lock'))
        await writeFile(join(root, 'owner.lock'), foreign)
        throw failure
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  syncBuiltinESMExports()
  try { await assert.rejects(store.initialize(), error => error === failure) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(await readFile(join(root, 'owner.lock'), 'utf8'), foreign)
})

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-lock-recovery-')), profile = join(root, 'profile')
  const store = new ConnectionStore(profile)
  const service = new ConnectionService(store, {
    preset: async () => 'super-code', create: async () => assert.fail('No session should be created'),
    prompt: async () => assert.fail('No prompt should be sent'), cancel: async () => {},
    observe: async () => ({ status: 'finished', output: '', detail: 'No external model call' }),
  })
  await service.initialize()
  t.after(async () => {
    await chmod(profile, 0o700)
    try { await service.close() } catch { /* The test retains deliberate cleanup errors. */ }
    try { await store.close() } finally { await rm(root, { recursive: true, force: true }) }
  })
  return { root, profile, store, service }
}

test('a failed lock release remains retryable after filesystem permissions recover', permissionTest, async t => {
  const f = await fixture(t), lock = join(f.profile, 'owner.lock'), original = await readFile(lock, 'utf8')
  await chmod(f.profile, 0o500)
  await assert.rejects(f.store.close(), { code: 'EACCES' })
  await chmod(f.profile, 0o700)
  assert.equal(await readFile(lock, 'utf8'), original)
  await assert.rejects(f.store.saveTasks([]), /storage-unavailable/, 'a failed close must not reopen writes')
  await f.store.close()
  await assert.rejects(access(lock), { code: 'ENOENT' })
  const replacement = new ConnectionStore(f.profile)
  await replacement.initialize()
  await replacement.close()
})

test('an already absent owner lock counts as released storage', async t => {
  const f = await fixture(t)
  await unlink(join(f.profile, 'owner.lock'))
  await f.store.close()
  await f.store.close()
  await assert.rejects(f.store.saveTasks([]), /storage-unavailable/)
})

test('cleanup never removes another owner token', async t => {
  const f = await fixture(t), lock = join(f.profile, 'owner.lock'), foreign = `${process.pid}:foreign-owner`
  await writeFile(lock, foreign)
  await f.store.close()
  assert.equal(await readFile(lock, 'utf8'), foreign)
  await f.store.close()
  assert.equal(await readFile(lock, 'utf8'), foreign)
})

test('a rejected second initialization cannot replace the active owner token', async t => {
  const f = await fixture(t)
  await assert.rejects(f.store.initialize(), /profile-busy/)
  await f.service.close()
  await assert.rejects(access(join(f.profile, 'owner.lock')), { code: 'ENOENT' })
})

test('concurrent initialization of the same store has one owner and releases its own token', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-lock-concurrent-')), store = new ConnectionStore(root)
  t.after(async () => { try { await store.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const results = await Promise.allSettled([store.initialize(), store.initialize()])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && /profile-busy/.test(String(result.reason))).length, 1)
  await store.close()
  await assert.rejects(access(join(root, 'owner.lock')), { code: 'ENOENT' })
})

test('a service can explicitly retry a failed lock release while remaining closed', permissionTest, async t => {
  const f = await fixture(t), close = f.store.close
  let releases = 0
  f.store.close = async function () {
    if (++releases === 1) {
      await chmod(f.profile, 0o500)
      try { await close.call(this) } finally { await chmod(f.profile, 0o700) }
    } else await close.call(this)
  }
  t.after(() => { f.store.close = close })
  await assert.rejects(f.service.close(), { code: 'EACCES' })
  assert.equal(f.service.read().writable, false)
  assert.equal(f.service.read().state, 'disabled')
  const revision = f.service.read().revision
  await f.service.close()
  assert.equal(releases, 2)
  assert.equal(f.service.read().revision, revision)
  assert.equal(f.service.read().writable, false)
  await assert.rejects(access(join(f.profile, 'owner.lock')), { code: 'ENOENT' })
  const replacement = new ConnectionStore(f.profile)
  await replacement.initialize(); await replacement.close()
})

test('failed transport cleanup can be retried without rewriting released task storage', async t => {
  const f = await fixture(t), http = (f.service as unknown as { http: ConnectionHttp }).http
  const close = http.close, save = f.store.saveTasks, failure = new Error('fixture transport cleanup failure')
  let releases = 0, writes = 0
  http.close = async function () { await close.call(this); if (++releases === 1) throw failure }
  f.store.saveTasks = async function (tasks) { writes++; await save.call(this, tasks) }
  t.after(() => { http.close = close; f.store.saveTasks = save })
  await assert.rejects(f.service.close(), error => error === failure)
  assert.equal(writes, 1)
  await f.service.close()
  await f.service.close()
  assert.equal(releases, 2)
  assert.equal(writes, 1)
  assert.equal(f.service.read().writable, false)
})

test('retrying shutdown preserves a task persistence error without writing after lock release', async t => {
  const f = await fixture(t), save = f.store.saveTasks, failure = new Error('fixture task persistence failure')
  let writes = 0
  f.store.saveTasks = async () => { writes++; throw failure }
  t.after(() => { f.store.saveTasks = save })
  await assert.rejects(f.service.close(), error => error === failure)
  await assert.rejects(access(join(f.profile, 'owner.lock')), { code: 'ENOENT' })
  await assert.rejects(f.service.close(), error => error === failure)
  assert.equal(writes, 1)
  assert.equal(f.service.read().state, 'disabled')
})

test('parallel shutdown retries share cleanup and cannot reopen settings', async t => {
  const f = await fixture(t), close = f.store.close, gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const failure = new Error('fixture temporary lock cleanup failure')
  let releases = 0
  f.store.close = async function () {
    if (++releases === 1) throw failure
    entered.resolve(); await gate.promise; await close.call(this)
  }
  t.after(() => { gate.resolve(); f.store.close = close })
  const first = f.service.close()
  assert.equal(f.service.close(), first)
  await assert.rejects(first, error => error === failure)
  const retry = f.service.close()
  await entered.promise
  assert.equal(f.service.close(), retry)
  const snapshot = f.service.read()
  const saving = f.service.save(JSON.stringify(snapshot.configuration), String(snapshot.revision))
  const rotating = f.service.rotate(String(snapshot.revision))
  gate.resolve(); await retry
  assert.deepEqual(await saving, { ok: false, error: 'unavailable' })
  assert.deepEqual(await rotating, { ok: false, error: 'unavailable' })
  assert.equal(releases, 2)
  assert.equal(f.service.close(), retry)
})
