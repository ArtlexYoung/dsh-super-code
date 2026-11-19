import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ToolSettings } from '../../src/dsh/tool-settings.js'
import { builtinToolProfiles, defaultToolConfiguration, maximumToolConfigurationBytes, toolNames } from '../../src/dsh/tool-profiles.js'
import schema from '@deepseek-ai/schemastery'

class MemorySettings extends SettingsProvider {
  writable = true
  fail = false
  stored: Record<string, unknown> = {}
  protected async load(): Promise<Record<string, unknown>> { return structuredClone(this.stored) }
  protected async persist(ns: SettingsNamespace, section: object): Promise<void> {
    if (this.fail) throw new Error('disk full')
    this.stored[ns] = structuredClone(section)
  }
}
async function fixture(t: test.TestContext) {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  await ctx.inject(['settings'], () => {})
  const scope = settings.register('super-code-tools', schema.object({ version: schema.number(), activeId: schema.string(), custom: schema.array(schema.any()) }), { base: defaultToolConfiguration })
  const source = new ToolSettings(settings, () => scope.get())
  const expected = () => { const value = source.read(); return `${value.revision}:${value.generation}` }
  return { settings, source, expected, scope }
}
test('independent tool document saves, restores, rejects stale/restarted clients and retains stored data on failures', async t => {
  const { settings, source, expected, scope } = await fixture(t)
  const revision = expected()
  assert.equal((await source.save(JSON.stringify({ ...defaultToolConfiguration, activeId: 'builtin:minimal' }), revision)).ok, true)
  assert.equal(source.get().activeId, 'builtin:minimal')
  assert.equal((settings.stored['super-code-tools'] as any).activeId, 'builtin:minimal')
  assert.deepEqual(await source.save(JSON.stringify(defaultToolConfiguration), revision), { ok: false, error: 'conflict' })
  const restarted = new ToolSettings(settings, () => scope.get())
  assert.equal(restarted.get().activeId, 'builtin:minimal')
  assert.deepEqual(await restarted.save(JSON.stringify(defaultToolConfiguration), expected()), { ok: false, error: 'conflict' })
  settings.fail = true
  assert.deepEqual(await source.save(JSON.stringify(defaultToolConfiguration), expected()), { ok: false, error: 'save-failed' })
  assert.equal(source.get().activeId, 'builtin:minimal')
  settings.writable = false
  assert.deepEqual(await source.copy('builtin:standard', expected()), { ok: false, error: 'read-only' })
})
test('copy creates stable custom ids and the full 30-profile document fits without the old 4096-character ceiling', async t => {
  const { source, expected } = await fixture(t)
  for (let index = 0; index < 25; index++) assert.equal((await source.copy('builtin:create', expected())).ok, true)
  const content = JSON.stringify(source.get())
  assert(content.length > 4096)
  assert(Buffer.byteLength(content) < maximumToolConfigurationBytes)
  assert.equal(new Set(source.get().custom.map(profile => profile.id)).size, 25)
  assert.deepEqual(source.get().custom[0]!.tools, builtinToolProfiles.find(profile => profile.id === 'builtin:create')!.tools)
  assert.deepEqual(await source.copy('', expected()), { ok: false, error: 'limit' })
  assert.deepEqual(await source.save(' '.repeat(maximumToolConfigurationBytes + 1), expected()), { ok: false, error: 'invalid' })
  assert.deepEqual(await source.save('{', expected()), { ok: false, error: 'invalid' })
})
test('external exclusions survive saves and copying a custom profile while builtins default to enabled', async t => {
  const { source, expected } = await fixture(t)
  await source.copy('builtin:super-code', expected())
  const config = source.get(), profile = config.custom[0]!
  assert.deepEqual(profile.disabledExternalTools ?? [], [])
  profile.disabledExternalTools = ['third_party']
  config.activeId = profile.id
  assert.equal((await source.save(JSON.stringify(config), expected())).ok, true)
  assert.deepEqual(source.profile().disabledExternalTools, ['third_party'])
  assert.equal((await source.copy(profile.id, expected())).ok, true)
  assert.deepEqual(source.get().custom[1]!.disabledExternalTools, ['third_party'])
})
test('tools remain configurable before any conversation and availability follows active provider lifetimes', async t => {
  const { source } = await fixture(t)
  assert.deepEqual(source.read().catalog.map(tool => tool.name), toolNames)
  assert(source.read().catalog.every(tool => !tool.available && tool.reason === 'not-loaded'))
  const release = source.attach({ status: () => [], catalog: () => [{ name: 'ask_user_question', group: 'questions', available: true }] })
  assert.equal(source.read().catalog.find(tool => tool.name === 'ask_user_question')!.available, true)
  release()
  assert.equal(source.read().catalog.find(tool => tool.name === 'ask_user_question')!.reason, 'not-loaded')
})
test('copying a maximum-length custom name leaves room for the copy suffix', async t => {
  const { source, expected } = await fixture(t)
  await source.copy('builtin:ptc', expected())
  const configuration = source.get(), original = configuration.custom[0]!
  original.name = '长'.repeat(60)
  assert.equal((await source.save(JSON.stringify(configuration), expected())).ok, true)
  const result = await source.copy(original.id, expected())
  assert.equal(result.ok, true)
  const copied = source.get().custom[1]!
  assert.equal(copied.name.length, 60)
  assert(copied.name.endsWith(' (2)'))
  assert.notEqual(copied.id, original.id)
})
