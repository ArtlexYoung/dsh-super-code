import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionStore } from '../src/connection/store.js'
import { ConnectionService } from '../src/connection/service.js'
import { defaultConnectionConfig } from '../src/connection/types.js'
import { invokeConnectionTool } from '../src/connection/client.js'

test('an owner released during startup contention can be claimed without restarting the service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-start-release-'))
  const previous = new ConnectionStore(directory), next = new ConnectionStore(directory)
  await previous.initialize()
  t.after(async () => { await previous.close(); await next.close(); await rm(directory, { recursive: true, force: true }) })
  const read = fs.readFile
  let released = false
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof read>) => {
    if (String(args[0]) === join(directory, 'owner.lock') && !released) {
      released = true
      await previous.close()
    }
    return read(...args)
  })
  syncBuiltinESMExports()
  try { await next.initialize() }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.ok(released)
  await next.saveTasks([])
  await assert.rejects(access(join(directory, 'recovery.lock')), { code: 'ENOENT' })
  await next.close()
  await assert.rejects(access(join(directory, 'owner.lock')), { code: 'ENOENT' })
})

for (const stage of ['close', 'unlink'] as const) test(`failed recovery-lock ${stage} cannot strand a newly claimed owner`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-start-cleanup-')), store = new ConnectionStore(directory)
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  assert.equal(child.status, 0)
  await writeFile(join(directory, 'owner.lock'), `${child.pid}:stale`)
  const open = fs.open, remove = fs.unlink, failure = new Error(`recovery ${stage} failed`)
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  if (stage === 'unlink') t.mock.method(fs, 'unlink', async (path: Parameters<typeof remove>[0]) => {
    if (String(path) === join(directory, 'recovery.lock')) throw failure
    return remove(path)
  })
  else t.mock.method(fs, 'open', async (...args: Parameters<typeof open>) => {
    const file = await open(...args)
    if (String(args[0]) !== join(directory, 'recovery.lock')) return file
    return new Proxy(file, { get(target, key) {
      if (key === 'close') return async () => { await target.close(); throw failure }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  syncBuiltinESMExports()
  try { await assert.rejects(store.initialize(), error => error === failure) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  await assert.rejects(access(join(directory, 'owner.lock')), { code: 'ENOENT' })
  await assert.rejects(store.saveTasks([]), /storage-unavailable/)
  await unlink(join(directory, 'recovery.lock')).catch(error => { if (error.code !== 'ENOENT') throw error })
  await store.initialize(); await store.saveTasks([]); await store.close()
})

test('recovery rollback preserves an owner replaced by another host', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-start-replaced-')), store = new ConnectionStore(directory)
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  assert.equal(child.status, 0)
  await writeFile(join(directory, 'owner.lock'), `${child.pid}:stale`)
  const remove = fs.unlink, failure = new Error('recovery cleanup failed'), foreign = `${process.pid}:foreign`
  t.after(() => rm(directory, { recursive: true, force: true }))
  t.mock.method(fs, 'unlink', async (path: Parameters<typeof remove>[0]) => {
    if (String(path) === join(directory, 'recovery.lock')) {
      await writeFile(join(directory, 'owner.lock'), foreign)
      throw failure
    }
    return remove(path)
  })
  syncBuiltinESMExports()
  try { await assert.rejects(store.initialize(), error => error === failure) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(await readFile(join(directory, 'owner.lock'), 'utf8'), foreign)
})

test('a live owner and a recovery cleanup failure are both reported without removing the live lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-start-live-')), owner = new ConnectionStore(directory), next = new ConnectionStore(directory)
  await owner.initialize()
  const token = await readFile(join(directory, 'owner.lock'), 'utf8'), remove = fs.unlink, failure = new Error('recovery cleanup failed')
  t.after(async () => { await owner.close(); await rm(directory, { recursive: true, force: true }) })
  t.mock.method(fs, 'unlink', async (path: Parameters<typeof remove>[0]) => {
    if (String(path) === join(directory, 'recovery.lock')) throw failure
    return remove(path)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(next.initialize(), error => error instanceof AggregateError && error.errors.length === 2
      && /profile-busy/.test(String(error.errors[0])) && error.errors[1] === failure)
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(await readFile(join(directory, 'owner.lock'), 'utf8'), token)
  await owner.saveTasks([])
})

async function httpFixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-session-choice-')), effects = { created: 0, prompted: 0 }
  const socket = createServer()
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => socket.close(() => resolve()))
  const service = new ConnectionService(new ConnectionStore(join(directory, 'profile')), {
    preset: async () => 'super-code', create: async () => { effects.created++ }, prompt: async () => { effects.prompted++ },
    cancel: async () => {}, observe: async () => ({ status: 'finished', output: 'done', detail: 'Deterministic fixture; no external model' }),
  })
  await service.initialize()
  t.after(async () => { try { await service.close() } finally { await rm(directory, { recursive: true, force: true }) } })
  assert.ok((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, allowedDirectories: [directory], port: address.port }), '0')).ok)
  const call = (args: Record<string, unknown>) => invokeConnectionTool({ tool: 'dsh_run', url: service.read().url, token: service.reveal().token,
    arguments: { cwd: directory, prompt: 'Test explicit conversation selection', ...args } })
  return { service, effects, call }
}

test('explicitly disabling new-conversation creation requires a task instead of creating one', async t => {
  const f = await httpFixture(t)
  const response = await f.call({ requestId: 'no-new-conversation', newConversation: false })
  assert.equal(response.isError, true)
  assert.match(JSON.stringify(response.content), /taskId/)
  assert.deepEqual(f.effects, { created: 0, prompted: 0 })
  assert.deepEqual(f.service.overview().sessions, [])
})

test('false can reuse an explicit task while omitted and true retain legacy creation and stable retries', async t => {
  const f = await httpFixture(t)
  for (const option of [{}, { newConversation: true }]) {
    const input = { requestId: 'choice-' + f.effects.created, ...option }
    const first = await f.call(input), retry = await f.call(input)
    assert.equal(first.isError, undefined); assert.equal(retry.isError, undefined)
    const taskId = JSON.parse((first.content as { text: string }[])[0]!.text).taskId
    assert.equal(JSON.parse((retry.content as { text: string }[])[0]!.text).taskId, taskId)
    const reused = await f.call({ requestId: 'follow-' + f.effects.created, taskId, newConversation: false })
    assert.equal(reused.isError, undefined)
    assert.equal(JSON.parse((reused.content as { text: string }[])[0]!.text).taskId, taskId)
    const conflict = await f.call({ requestId: 'conflict-' + f.effects.created, taskId, newConversation: true })
    assert.equal(conflict.isError, true)
  }
  assert.deepEqual(f.effects, { created: 2, prompted: 4 })
})
