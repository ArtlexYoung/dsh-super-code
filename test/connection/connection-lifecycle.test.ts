import test from 'node:test'
import assert from 'node:assert/strict'
import filesystem, { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:net'
import { ConnectionService } from '../../src/connection/service.js'
import { applyConnection, SuperCodeConnection } from '../../src/dsh/connection.js'

test('an early host unloading during profile discovery releases any subsequently initialized MCP service', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-early-connection-')), ctx = new Context()
  ctx.baseUrl = pathToFileURL(root + '/').href
  await writeFile(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-super-code'] } } }))
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>()
  const read = filesystem.readFile, initialize = ConnectionService.prototype.initialize, close = ConnectionService.prototype.close
  let starts = 0, closes = 0
  filesystem.readFile = (async (...args: Parameters<typeof read>) => {
    if (args[0] !== join(root, 'package.json')) return read(...args)
    entered.resolve(); await gate.promise
    try { return await read(...args) } finally { finished.resolve() }
  }) as typeof read
  syncBuiltinESMExports()
  ConnectionService.prototype.initialize = async function () { starts++ }
  ConnectionService.prototype.close = async function () { closes++ }
  t.after(async () => {
    gate.resolve(); await finished.promise; await ctx.fiber.dispose()
    filesystem.readFile = read; syncBuiltinESMExports()
    ConnectionService.prototype.initialize = initialize
    ConnectionService.prototype.close = close
    await rm(root, { recursive: true, force: true })
  })
  for (const name of ['sessionController', 'agents', 'sessionQuery', 'subagents', 'superCodePresets'] as const) ctx.provide(name, {} as never)
  const feature = ctx.plugin({ apply: applyConnection })
  await entered.promise
  const stopping = feature.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  gate.resolve(); await stopping; await finished.promise
  await new Promise<void>(resolve => setImmediate(resolve))
  // Cordis may settle startup before running teardown; every started service
  // must still be closed before disposal completes.
  assert.equal(closes, starts)
  assert.equal(ctx.get('superCodeConnection'), undefined)
})

test('unloading while MCP initializes waits for startup and releases the profile lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-connection-lifetime-')), ctx = new Context()
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>()
  const initialize = ConnectionService.prototype.initialize, close = ConnectionService.prototype.close
  let connection: ConnectionService | false = false, initialized = false, closes = 0
  ConnectionService.prototype.initialize = async function () {
    connection = this; entered.resolve(); await gate.promise
    try { await initialize.call(this); initialized = true }
    finally { finished.resolve() }
  }
  ConnectionService.prototype.close = async function () { closes++; await close.call(this) }
  t.after(async () => {
    gate.resolve()
    await finished.promise
    await ctx.fiber.dispose()
    if (connection && initialized && !closes) await close.call(connection)
    ConnectionService.prototype.initialize = initialize
    ConnectionService.prototype.close = close
    await rm(root, { recursive: true, force: true })
  })
  ctx.provide('profileContext', { patchPath: join(root, 'cordis.patch.yml') })
  for (const name of ['sessionController', 'agents', 'sessionQuery', 'subagents', 'superCodePresets'] as const) ctx.provide(name, {} as never)
  const feature = ctx.plugin({ apply: applyConnection })
  await entered.promise
  const stopping = feature.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  gate.resolve()
  await stopping
  await finished.promise
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.ok(initialized)
  assert.equal(closes, 1)
  await assert.rejects(access(join(root, 'super-code-connection/owner.lock')))
  assert.equal(ctx.get('superCodeConnection'), undefined)
})

test('unloading an enabled MCP plugin closes its actual HTTP listener and releases storage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-live-connection-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  ctx.provide('profileContext', { patchPath: join(root, 'cordis.patch.yml') })
  for (const name of ['sessionController', 'agents', 'sessionQuery', 'subagents', 'superCodePresets'] as const) ctx.provide(name, {} as never)
  const feature = ctx.plugin({ apply: applyConnection })
  await feature
  const api = ctx.get('superCodeConnection') as SuperCodeConnection
  let snapshot = api.readConfig()
  for (let i = 0; !snapshot.writable && i < 300; i++) {
    await new Promise(resolve => setTimeout(resolve, 10)); snapshot = api.readConfig()
  }
  assert.ok(snapshot.writable)
  const portFinder = createServer()
  await new Promise<void>(resolve => portFinder.listen(0, '127.0.0.1', resolve))
  const address = portFinder.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>(resolve => portFinder.close(() => resolve()))
  const saved = await api.saveConfig(JSON.stringify({ ...snapshot.configuration, enabled: true, port,
    directoriesConfigured: true, allowedDirectories: [root] }), String(snapshot.revision))
  assert.equal(saved.ok, true)
  snapshot = api.readConfig()
  assert.equal(snapshot.state, 'listening')
  const response = await fetch(snapshot.url)
  assert.equal(response.status, 401)
  await response.arrayBuffer()
  await feature.dispose()
  await assert.rejects(fetch(snapshot.url))
  await assert.rejects(access(join(root, 'super-code-connection/owner.lock')))
})
