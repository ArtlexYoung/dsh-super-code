import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { apply } from '../src/dsh/bundled-skills.js'
import type { Configuration } from '../src/dsh/budgets.js'
import { settingsConfigurationSchema } from '../src/dsh/budgets.js'

const resourceRoot = fileURLToPath(new URL('../presets/super-code/', import.meta.url))
const validationRoot = fileURLToPath(new URL('../../source/validation/dsh-super-code/preset-skills-20261110/tmp/', import.meta.url))

async function fixture(t: test.TestContext) {
  const ctx = new Context()
  let configuration: Configuration = {}
  ctx.provide('superCodeConfiguration', { get: () => configuration })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: join(resourceRoot, 'skills') })
  t.after(() => ctx.fiber.dispose())
  return { ctx, registry, change(next: Configuration) {
    configuration = next
    ctx.emit('settings/document-updated', 'super-code-budgets' as never, 1)
  } }
}

test('PStack includes its pinned Skill bodies and companion resources without rewriting upstream files', async () => {
  const root = join(resourceRoot, 'skill-packs/pstack')
  const distribution = JSON.parse(await readFile(join(root, 'distribution.json'), 'utf8'))
  assert.equal(distribution.skills.length, 58)
  for (const file of Object.values(distribution.files) as { path: string; sha256: string }[]) {
    assert.equal(createHash('sha256').update(await readFile(join(root, file.path))).digest('hex'), file.sha256, file.path)
  }
  assert.ok(distribution.files['skills/statechart/scripts/worker.ts'])
  assert.ok(distribution.files['skills/poteto-mode/scripts/bun.lock'])
  assert.ok(distribution.files['agents/poteto-agent.md'])
  assert.ok(distribution.files.LICENSE)
})

test('whole-package switches change the native catalog and invalidate warmed caches', async t => {
  const { registry, change } = await fixture(t)
  assert.deepEqual((await registry.list()).map(row => row.name), ['oil-ui'])
  assert.equal(await registry.get('grilling'), undefined)
  assert.equal(await registry.get('openspec-propose'), undefined)
  for (const [key, packageName, count] of [['openspecSkills', 'openspec', 12], ['mattpocockSkills', 'mattpocock', 27], ['pstackSkills', 'pstack', 58]] as const) {
    change({ oilUiSkill: false, [key]: true })
    const distribution = JSON.parse(await readFile(join(resourceRoot, 'skill-packs', packageName, 'distribution.json'), 'utf8'))
    const catalog = await registry.list()
    assert.equal(catalog.length, count)
    assert.deepEqual(catalog.map(row => row.name).sort(), distribution.skills.sort())
    for (const row of catalog) {
      const skill = await registry.get(row.name)
      assert.ok(skill?.content.trim(), row.name)
      assert.equal(skill.resourceBase?.kind, 'directory')
      assert.equal(skill.source, 'bundled')
      assert.equal(skill.content.startsWith('---'), false, 'host strips frontmatter')
    }
    if (packageName === 'mattpocock') {
      assert.equal(catalog.find(row => row.name === 'grill-me')?.invocation.modelInvocable, false)
      assert.equal(catalog.find(row => row.name === 'grill-me')?.invocation.userInvocable, true)
      assert.equal(catalog.find(row => row.name === 'tdd')?.invocation.modelInvocable, true)
    }
    if (packageName === 'pstack') {
      assert.equal(catalog.filter(row => row.invocation.modelInvocable).length, 1)
      assert.equal(catalog.find(row => row.name === 'setup-pstack')?.invocation.modelInvocable, true)
      assert.ok(catalog.every(row => row.invocation.userInvocable), 'all PStack Skills remain available to native slash invocation')
      assert.match((await registry.get('poteto-mode'))!.content, /# Poteto mode/)
    }
    change({ oilUiSkill: false })
    assert.deepEqual(await registry.list(), [])
    assert.equal(await registry.get(distribution.skills[0]), undefined, 'disabled package cannot load cached bodies')
  }
  change({ oilUiSkill: true, openspecSkills: true, mattpocockSkills: true, pstackSkills: true })
  assert.equal((await registry.list()).length, 96, 'native registry deduplicates tdd and teach')
  assert.equal((await registry.get('tdd'))?.provider, 'super-code-bundled-mattpocock')
  assert.equal((await registry.get('teach'))?.provider, 'super-code-bundled-mattpocock')
  change({ pstackSkills: true })
  assert.equal((await registry.get('tdd'))?.provider, 'super-code-bundled-pstack')
  change({})
  assert.deepEqual((await registry.list()).map(row => row.name), ['oil-ui'])
})

test('project Skills keep precedence and are not disabled by bundled-package switches', async t => {
  const { ctx, registry, change } = await fixture(t)
  await mkdir(validationRoot, { recursive: true })
  const cwd = await mkdtemp(join(validationRoot, 'skill-priority-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const directory = join(cwd, '.dsh/skills/oil-ui')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), '---\nname: oil-ui\ndescription: Project override\n---\nProject instructions')
  let provider: FileSystemSkillProvider
  registry.registerProvider(control => provider = new FileSystemSkillProvider(ctx, control, {
    providerName: 'project', watch: false, dshHome: join(cwd, 'home'), agentsHome: join(cwd, 'agents'),
  }))
  t.after(() => provider.dispose())
  change({ oilUiSkill: true, mattpocockSkills: true })
  assert.equal((await registry.get('oil-ui', { cwd }))?.content.trim(), 'Project instructions')
  change({ oilUiSkill: false })
  assert.equal((await registry.get('oil-ui', { cwd }))?.content.trim(), 'Project instructions')
  assert.equal(await registry.get('tdd', { cwd }), undefined)
})

test('provider disposal removes packages and their settings listeners', async t => {
  const { ctx, registry, change } = await fixture(t)
  change({ mattpocockSkills: true })
  assert.equal((await registry.list()).length, 28)
  await ctx.fiber.dispose()
  change({ openspecSkills: true })
  assert.deepEqual(await registry.list(), [])
})

for (const boundary of ['disable', 'dispose']) test(`an in-flight Skill body cannot escape after its package ${boundary}`, async t => {
  const { ctx, registry, change } = await fixture(t)
  await registry.list()
  const original = FileSystemSkillProvider.prototype.get
  let entered!: () => void, release!: () => void
  const reading = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  FileSystemSkillProvider.prototype.get = async function (candidate, options) {
    const body = await original.call(this, candidate, options)
    entered(); await held
    return body
  }
  try {
    const loading = registry.get('oil-ui')
    await reading
    if (boundary === 'disable') change({ oilUiSkill: false })
    else await ctx.fiber.dispose()
    release()
    assert.equal(await loading, undefined, 'a retired provider must not deliver its previously selected instructions')
    assert.deepEqual(await registry.list(), [])
  } finally {
    release()
    FileSystemSkillProvider.prototype.get = original
  }
})

test('legacy persisted settings invalidate a warm catalog after committing resolved values', async t => {
  class MemorySettings extends SettingsProvider {
    writable = true
    protected async load(): Promise<Record<string, unknown>> { return {} }
    protected async persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {}
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  await ctx.inject(['settings'], () => {})
  const scope = settings.register('super-code-budgets', settingsConfigurationSchema)
  ctx.provide('superCodeConfiguration', { get: () => scope.get() })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: join(resourceRoot, 'skills') })
  assert.deepEqual((await registry.list()).map(row => row.name), ['oil-ui'])
  await settings.replace('super-code-budgets', { oilUiSkill: false, mattpocockSkills: true, openspecSkills: true })
  assert.equal((await registry.list()).length, 39)
  assert.ok((await registry.get('tdd'))?.content)
  await settings.replace('super-code-budgets', { oilUiSkill: false })
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('tdd'), undefined)
})

for (const [key, pack, skill, other, count] of [
  ['oilUiSkill', 'oil-ui', 'oil-ui', 'openspecSkills', 12],
  ['openspecSkills', 'openspec', 'openspec-propose', 'mattpocockSkills', 27],
  ['mattpocockSkills', 'mattpocock', 'tdd', 'openspecSkills', 12],
  ['pstackSkills', 'pstack', 'poteto-mode', 'openspecSkills', 12],
] as const) test(`the ${pack} package disabled during retried discovery cannot advertise its stale catalog`, async t => {
  const { registry, change } = await fixture(t)
  change({ oilUiSkill: false, [key]: true })
  const original = FileSystemSkillProvider.prototype.list
  const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  const released = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let scans = 0
  FileSystemSkillProvider.prototype.list = async function (options) {
    const catalog = await original.call(this, options)
    if (this.name === `super-code-bundled-${pack}` && scans < 2) {
      const index = scans++
      entered[index]!.resolve()
      await released[index]!.promise
    }
    return catalog
  }
  try {
    const loading = registry.list()
    await entered[0]!.promise
    change({ oilUiSkill: false, [key]: true, [other]: true })
    released[0]!.resolve()
    await entered[1]!.promise
    change({ oilUiSkill: false, [other]: true, [key]: false })
    released[1]!.resolve()
    const catalog = await loading
    assert.equal(catalog.some(row => row.name === skill), false,
      'a disabled package must not remain advertised when the host exhausts its discovery retries')
    assert.equal(catalog.length, count, 'the other enabled package remains available')
    assert.equal(await registry.get(skill), undefined)
    assert.equal((await registry.list()).length, count)
  } finally {
    for (const gate of released) gate.resolve()
    FileSystemSkillProvider.prototype.list = original
  }
})
