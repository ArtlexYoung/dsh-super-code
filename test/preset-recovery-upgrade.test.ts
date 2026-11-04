import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ts from 'typescript'
import { RecoveryState } from '../src/dsh/preset-recovery-runtime.js'
import type { RecoveryService } from '../src/dsh/preset-recovery-runtime.js'

async function fixture(t: test.TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'super-code-runtime-upgrade-'))), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  const source = await readFile(new URL('../src/dsh/preset-recovery-runtime.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const modules = await Promise.all(['first', 'second', 'third'].map(async generation => {
    const path = join(directory, generation + '.mjs')
    await writeFile(path, compiled.replace('Super Code 插件已卸载，', `GENERATION_${generation} Super Code 插件已卸载，`))
    return { url: pathToFileURL(path).href, plugin: await import(pathToFileURL(path).href) }
  }))
  const config = { statePath: join(directory, 'state.json'), packagePath: join(directory, 'package.json') }
  // prepareRecovery creates this owned record before loading a profile module.
  await writeFile(config.statePath, JSON.stringify({ plugin: 'dsh-super-code', format: 1, sessions: {} }))
  let content: string | false = 'owned Super Code composition'
  const bound = new WeakMap<Context, string>(), mounts: string[] = []
  const registry = {
    async resolve(id = 'standard') { if (id !== 'standard' && !content) throw new Error('Missing'); return { id } },
    async list() { return [{ id: 'standard' }, ...(content ? [{ id: 'owned' }] : [])] },
    async readDocument(id: string) { if (!content) throw new Error('Missing'); return { agentPreset: id, content } },
    async mount(agentCtx: Context, id = 'standard') {
      if (id !== 'standard' && !content) throw new Error('Missing')
      mounts.push(id); bound.set(agentCtx, id); return { id }
    },
    composedPreset(agentCtx: Context) { return bound.get(agentCtx) },
  }
  ctx.provide('profileContext', { installAnchor: fileURLToPath(new URL('../package.json', import.meta.url)) })
  let removeRegistry = ctx.provide('agentPresets', registry)
  ctx.provide('sessionProjections', { stateOf(session: Session) {
    let preset = session.header.agentPreset
    for (const event of session.snapshotEvents()) if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
    return preset
  } })
  ctx.provide('tools', { get: (_name: string, agent: Agent) => bound.has(agent.ctx) })
  const agent = (id: string) => {
    const who = { session: Session.create(SessionId(id), [], { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1,
      agentPreset: 'owned', cwd: directory, isSeeded: false }) } as Agent
    Object.assign(who, { ctx: createScope(ctx, who).ctx })
    bound.set(who.ctx, 'owned')
    return who
  }
  const waitFor = async (source: string): Promise<RecoveryService> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const service = ctx.get('superCodeSessionRecovery')
      if (service?.lifetime?.source === source) return service
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Recovery generation did not load: ' + source)
  }
  const reloadRegistry = async (): Promise<void> => { await removeRegistry(); removeRegistry = ctx.provide('agentPresets', registry) }
  return { ctx, directory, config, registry, modules, agent, mounts, waitFor, reloadRegistry, removePreset: () => { content = false } }
}

test('changed copied runtimes replace their hooks, retain records and ignore duplicate loads', async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!, agent = f.agent('existing')
  await f.ctx.plugin(first.plugin, f.config)
  const previous = await f.waitFor(first.url)
  await previous.remember(agent)
  const before = agent.session.snapshotEvents()

  await f.ctx.plugin(second.plugin, f.config)
  const current = await f.waitFor(second.url)
  assert.notEqual(current, previous)
  assert.deepEqual(agent.session.snapshotEvents(), before, 'upgrading writes no conversation events')
  assert.ok((await RecoveryState.open(f.config.statePath)).value.sessions.existing)

  await f.ctx.plugin(second.plugin, f.config)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.ctx.get('superCodeSessionRecovery'), current, 'same generation is not installed twice')
  f.removePreset()
  await f.registry.mount(agent.ctx, 'owned')
  assert.deepEqual(f.mounts, ['standard'])
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'command/done').length, 1)
  assert.match(JSON.stringify(events), /GENERATION_second/)
  assert.doesNotMatch(JSON.stringify(events), /GENERATION_first/)
})

test('a retired generation cannot overwrite records after its document read completes late', async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!
  await f.ctx.plugin(first.plugin, f.config)
  const previous = await f.waitFor(first.url)
  await previous.remember(f.agent('before-upgrade'))
  const read = f.registry.readDocument, entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  t.after(() => gate.resolve())
  f.registry.readDocument = async id => { entered.resolve(); await gate.promise; return read.call(f.registry, id) }
  const late = previous.remember(f.agent('retired-late-write'))
  await entered.promise
  await f.ctx.plugin(second.plugin, f.config)
  const current = await f.waitFor(second.url)
  f.registry.readDocument = read
  await current.remember(f.agent('after-upgrade'))
  gate.resolve(); await late
  const saved = await RecoveryState.open(f.config.statePath)
  assert.deepEqual(Object.keys(saved.value.sessions).sort(), ['after-upgrade', 'before-upgrade'])
})

test('runtime replacement does not retire a recovery service owned by a different profile', async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!
  await f.ctx.plugin(first.plugin, f.config)
  const current = await f.waitFor(first.url)
  await f.ctx.plugin(second.plugin, { ...f.config, statePath: join(f.directory, 'unrelated.json') })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(f.ctx.get('superCodeSessionRecovery'), current)
  await current.remember(f.agent('still-owned'))
  assert.ok((await RecoveryState.open(f.config.statePath)).value.sessions['still-owned'])
})

test('a skipped duplicate cannot revive an older generation when host services reload', async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!
  await f.ctx.plugin(first.plugin, f.config)
  await f.waitFor(first.url)
  await f.ctx.plugin(first.plugin, f.config)
  await new Promise(resolve => setTimeout(resolve, 30))
  await f.ctx.plugin(second.plugin, f.config)
  await f.waitFor(second.url)
  await f.reloadRegistry()
  await f.waitFor(second.url)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.ctx.get('superCodeSessionRecovery')?.lifetime?.source, second.url)
})

for (const failure of ['corrupt', 'missing'] as const) test(`a ${failure} replacement state does not tear down the working recovery service`, async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!, agent = f.agent('registered')
  await f.ctx.plugin(first.plugin, f.config)
  const current = await f.waitFor(first.url)
  await current.remember(agent)
  const original = await readFile(f.config.statePath, 'utf8')
  if (failure === 'missing') await rm(f.config.statePath)
  else await writeFile(f.config.statePath, '{temporarily invalid')
  await f.ctx.plugin(second.plugin, f.config)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(f.ctx.get('superCodeSessionRecovery'), current, 'failed upgrade retains the current service')
  await writeFile(f.config.statePath, original)
  f.removePreset()
  await f.registry.mount(agent.ctx, 'owned')
  assert.deepEqual(f.mounts, ['standard'])
})

test('a failed candidate cannot replace a later successful generation after services reload', async t => {
  const f = await fixture(t), first = f.modules[0]!, second = f.modules[1]!, third = f.modules[2]!
  await f.ctx.plugin(first.plugin, f.config)
  await f.waitFor(first.url)
  const original = await readFile(f.config.statePath, 'utf8')
  await writeFile(f.config.statePath, '{temporarily invalid')
  await f.ctx.plugin(second.plugin, f.config)
  await new Promise(resolve => setTimeout(resolve, 50))
  await writeFile(f.config.statePath, original)
  await f.ctx.plugin(third.plugin, f.config)
  await f.waitFor(third.url)
  await f.reloadRegistry()
  await f.waitFor(third.url)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.ctx.get('superCodeSessionRecovery')?.lifetime?.source, third.url)
})
