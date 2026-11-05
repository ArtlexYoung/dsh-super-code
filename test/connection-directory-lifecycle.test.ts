import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { DirectoryRequests } from '../src/connection/directories.js'
import { ConnectionService } from '../src/connection/service.js'
import { ConnectionStore } from '../src/connection/store.js'
import { defaultConnectionConfig } from '../src/connection/types.js'
import { invokeConnectionTool } from '../src/connection/client.js'

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'super-code-directory-lifecycle-'))), path = join(root, 'workspace')
  await mkdir(path)
  const cleanup: (() => Promise<void>)[] = []
  t.after(async () => { try { for (const release of cleanup.reverse()) await release() } finally { await rm(root, { recursive: true, force: true }) } })
  let now = 0
  const allowed: string[] = [], queue = new DirectoryRequests(() => allowed, () => now), grants: string[] = []
  const input = { requestId: 'directory', path, reason: 'Use this exact directory' }
  const grant = async (path: string): Promise<void> => { grants.push(path); allowed.push(path) }
  return { root, path, queue, input, grants, grant, cleanup, time: (value: number) => { now = value } }
}

test('replacing a requested directory with another ordinary directory requires fresh consent', async t => {
  const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
  await rename(f.path, join(f.root, 'original-workspace')); await mkdir(f.path)
  await assert.rejects(f.queue.resolve(pending.id, 'approved', f.grant), /directory-changed/)
  assert.deepEqual(f.grants, [])
  assert.equal((await f.queue.request(f.input, 'client')).status, 'rejected')
})

test('a request expiring during asynchronous directory validation cannot grant access', async t => {
  const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
  const resolving = f.queue.resolve(pending.id, 'approved', f.grant)
  f.time(300000)
  assert.deepEqual(await resolving, { status: 'expired' })
  assert.deepEqual(f.grants, [])
})

test('a request withdrawn during asynchronous directory validation cannot be revived', async t => {
  const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
  const resolving = f.queue.resolve(pending.id, 'approved', f.grant)
  f.queue.rejectPending()
  assert.deepEqual(await resolving, { status: 'rejected' })
  assert.deepEqual(f.grants, [])
})

for (const replacement of ['missing', 'file', 'symlink'] as const) {
  test(`a requested directory becoming ${replacement} never grants access`, async t => {
    const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
    const original = join(f.root, 'original-workspace'); await rename(f.path, original)
    if (replacement === 'file') await writeFile(f.path, 'ordinary file')
    if (replacement === 'symlink') await symlink(original, f.path)
    await assert.rejects(f.queue.resolve(pending.id, 'approved', f.grant), /directory-changed/)
    assert.deepEqual(f.grants, [])
  })
}

test('new consent can approve a replacement, while the old request remains rejected even if the original returns', async t => {
  const f = await fixture(t), old = await f.queue.request(f.input, 'client'), original = join(f.root, 'original-workspace')
  await rename(f.path, original); await mkdir(f.path)
  await assert.rejects(f.queue.resolve(old.id, 'approved', f.grant), /directory-changed/)
  await rename(f.path, join(f.root, 'replacement')); await rename(original, f.path)
  assert.deepEqual(await f.queue.resolve(old.id, 'approved', f.grant), { status: 'rejected' })
  const fresh = await f.queue.request({ ...f.input, requestId: 'fresh-consent' }, 'client')
  assert.deepEqual(await f.queue.resolve(fresh.id, 'approved', f.grant), { status: 'approved' })
  assert.deepEqual(f.grants, [f.path])
})

test('a canonical directory alias and ordinary content changes preserve the exact consent target', async t => {
  const f = await fixture(t), alias = join(f.root, 'alias'); await symlink(f.path, alias)
  const input = { ...f.input, path: alias }, pending = await f.queue.request(input, 'client')
  assert.equal(pending.path, f.path)
  await writeFile(join(f.path, 'new-file.txt'), 'content changed without replacing directory')
  assert.equal((await f.queue.request(input, 'client')).id, pending.id)
  assert.deepEqual(await f.queue.resolve(pending.id, 'approved', f.grant), { status: 'approved' })
  assert.deepEqual(await f.queue.resolve(pending.id, 'approved', f.grant), { status: 'approved' })
  assert.deepEqual(f.grants, [f.path])
})

test('a failed grant remains pending and a later valid retry writes once', async t => {
  const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
  await assert.rejects(f.queue.resolve(pending.id, 'approved', async () => { throw new Error('fixture persistence unavailable') }), /persistence unavailable/)
  assert.equal(f.queue.pending().length, 1); assert.deepEqual(f.grants, [])
  assert.deepEqual(await f.queue.resolve(pending.id, 'approved', f.grant), { status: 'approved' })
  assert.deepEqual(f.grants, [f.path])
})

test('consent just before expiry still works, and an already started grant is not retroactively undone', async t => {
  const f = await fixture(t), pending = await f.queue.request(f.input, 'client')
  f.time(299999)
  const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  t.after(() => released.resolve())
  const resolving = f.queue.resolve(pending.id, 'approved', async path => { entered.resolve(); await released.promise; await f.grant(path) })
  await entered.promise; f.time(300000)
  f.queue.pending(); released.resolve()
  assert.deepEqual(await resolving, { status: 'approved' }); assert.deepEqual(f.grants, [f.path])
})

async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

test('real HTTP consent refuses a replaced directory, preserves settings, and persists a fresh approval', { timeout: 10000 }, async t => {
  const f = await fixture(t), allowed = join(f.root, 'allowed'), profile = join(f.root, 'profile'); await mkdir(allowed)
  const store = new ConnectionStore(profile), service = new ConnectionService(store, {
    preset: async () => 'super-code', create: async () => assert.fail('No conversation should be created'),
    prompt: async () => assert.fail('No prompt should be sent'), cancel: async () => {},
    observe: async () => ({ status: 'finished', output: '', detail: 'No model call' }),
  })
  await service.initialize(); f.cleanup.push(() => service.close())
  assert.ok((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: await port(), allowedDirectories: [allowed] }), '0')).ok)
  const call = async (input: typeof f.input) => {
    const response = await invokeConnectionTool({ url: service.read().url, token: service.reveal().token,
      tool: 'dsh_request_directory', arguments: input })
    assert.ok(!response.isError)
    return JSON.parse((response.content as { text: string }[])[0]!.text) as { id: string; status: string }
  }
  const pending = await call(f.input), before = service.read(), saved = await readFile(join(profile, 'settings.json'))
  await rename(f.path, join(f.root, 'old-workspace')); await mkdir(f.path)
  await assert.rejects(service.resolveDirectory(pending.id, 'approved'), /directory-changed/)
  assert.deepEqual(service.read(), before)
  assert.deepEqual(await readFile(join(profile, 'settings.json')), saved)
  assert.equal((await call(f.input)).status, 'rejected')
  const fresh = await call({ ...f.input, requestId: 'fresh' })
  assert.equal(fresh.status, 'pending')
  assert.deepEqual(await service.resolveDirectory(fresh.id, 'approved'), { status: 'approved' })
  assert.ok(service.read().configuration.allowedDirectories.includes(f.path))
  assert.equal(service.read().revision, before.revision + 1)
  assert.equal((await store.settings()).config.allowedDirectories.includes(f.path), true)
})
