import { validationRoot } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { apply } from '../../src/dsh/bundled-skills.js'
import type { Configuration } from '../../src/dsh/budgets.js'
import { settingsConfigurationSchema } from '../../src/dsh/budgets.js'

const resourceRoot = fileURLToPath(new URL('../../builtin/skills/', import.meta.url))

async function fixture(t: test.TestContext) {
  const ctx = new Context()
  let configuration: Configuration = {}
  ctx.provide('superCodeConfiguration', { get: () => configuration })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: resourceRoot, layout: 'builtin' })
  t.after(() => ctx.fiber.dispose())
  return { ctx, registry, change(next: Configuration) {
    configuration = next
    ctx.emit('settings/document-updated', 'super-code-budgets' as never, 1)
  } }
}

test('PStack includes its pinned Skill bodies and companion resources without rewriting upstream files', async () => {
  const root = join(resourceRoot, 'pstack')
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

test('missing switches expose no bundled Skills while an explicit enable still works', async t => {
  const { registry, change } = await fixture(t)
  assert.deepEqual(await registry.list(), [])
  for (const name of ['oil-ui', 'grill-me', 'openspec-propose', 'tdd', 'poteto-mode']) {
    assert.equal(await registry.get(name), undefined, name)
  }
  change({ oilUiSkill: true })
  assert.deepEqual((await registry.list()).map(row => row.name), ['oil-ui'])
  assert.ok((await registry.get('oil-ui'))?.content)
  change({})
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('oil-ui'), undefined)
})

test('whole-package switches change the native catalog and invalidate warmed caches', async t => {
  const { registry, change } = await fixture(t)
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('grilling'), undefined)
  assert.equal(await registry.get('openspec-propose'), undefined)
  for (const [key, packageName, count] of [['openspecSkills', 'openspec', 12], ['mattpocockSkills', 'mattpocock', 27], ['pstackSkills', 'pstack', 58]] as const) {
    change({ oilUiSkill: false, [key]: true })
    const distribution = JSON.parse(await readFile(join(resourceRoot, packageName, 'distribution.json'), 'utf8'))
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
  assert.deepEqual(await registry.list(), [])
})

test('grill-me works independently with its dependency and shares the complete Matt package without duplicates', async t => {
  const { registry, change } = await fixture(t)
  change({ oilUiSkill: false, grillMeSkill: true })
  assert.deepEqual((await registry.list()).map(row => row.name).sort(), ['grill-me', 'grilling'])
  assert.match((await registry.get('grill-me'))!.content, /"grilling"/)
  assert.match((await registry.get('grilling'))!.content, /Interview the user/)
  assert.equal(await registry.get('tdd'), undefined)
  change({ oilUiSkill: false, grillMeSkill: true, mattpocockSkills: true })
  assert.equal((await registry.list()).length, 27)
  change({ oilUiSkill: false, grillMeSkill: false, mattpocockSkills: true })
  assert.ok(await registry.get('grill-me'), 'the complete workflow retains its original entry')
  change({ oilUiSkill: false, grillMeSkill: true, mattpocockSkills: false })
  assert.deepEqual((await registry.list()).map(row => row.name).sort(), ['grill-me', 'grilling'])
  change({ oilUiSkill: false })
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('grill-me'), undefined)
  assert.equal(await registry.get('grilling'), undefined)
})

for (const operation of ['list', 'get'] as const) test(`an in-flight ${operation} cannot leak the full workflow when switching to grill-me only`, async t => {
  const { registry, change } = await fixture(t)
  change({ oilUiSkill: false, mattpocockSkills: true })
  if (operation === 'get') await registry.list()
  const entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  const original = FileSystemSkillProvider.prototype[operation]
  if (operation === 'list') {
    const list = FileSystemSkillProvider.prototype.list
    FileSystemSkillProvider.prototype.list = async function (options) {
      const catalog = await list.call(this, options)
      if (catalog.some(row => row.name === 'tdd')) { entered.resolve(); await gate.promise }
      return catalog
    }
  } else {
    const get = FileSystemSkillProvider.prototype.get
    FileSystemSkillProvider.prototype.get = async function (candidate, options) {
      const skill = await get.call(this, candidate, options)
      if (candidate.name === 'tdd') { entered.resolve(); await gate.promise }
      return skill
    }
  }
  try {
    const loading = operation === 'list' ? registry.list() : registry.get('tdd')
    await entered.promise
    change({ oilUiSkill: false, grillMeSkill: true })
    gate.resolve()
    const result = await loading
    if (Array.isArray(result)) assert.deepEqual(result.map(row => row.name).sort(), ['grill-me', 'grilling'])
    else assert.equal(result, undefined)
    assert.ok(await registry.get('grill-me'))
  } finally {
    gate.resolve()
    Object.assign(FileSystemSkillProvider.prototype, { [operation]: original })
  }
})

test('grill-me filtering retains incomplete native observations without exposing other workflows', async t => {
  const { registry, change } = await fixture(t)
  const list = FileSystemSkillProvider.prototype.list
  FileSystemSkillProvider.prototype.list = async function (options) {
    const observation = await list.call(this, options)
    return { candidates: Array.isArray(observation) ? observation : observation.candidates, complete: false }
  }
  try {
    change({ oilUiSkill: false, grillMeSkill: true })
    assert.deepEqual((await registry.list()).map(row => row.name).sort(), ['grill-me', 'grilling'])
    change({ oilUiSkill: false })
    assert.deepEqual(await registry.list(), [])
  } finally { FileSystemSkillProvider.prototype.list = list }
})

test('persisted user presets retain all four packages in the legacy layout', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'legacy-skill-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(resourceRoot, 'oil-ui'), join(root, 'skills/oil-ui'), { recursive: true })
  for (const pack of ['openspec', 'mattpocock', 'pstack']) {
    await cp(join(resourceRoot, pack), join(root, 'skill-packs', pack), { recursive: true })
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let configuration: Configuration = { oilUiSkill: true, openspecSkills: true, mattpocockSkills: true, pstackSkills: true }
  ctx.provide('superCodeConfiguration', { get: () => configuration })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: join(root, 'skills') })
  assert.equal((await registry.list()).length, 96)
  for (const name of ['oil-ui', 'openspec-propose', 'grill-me', 'poteto-mode']) assert.ok((await registry.get(name))?.content, name)
  configuration = { oilUiSkill: false }
  ctx.emit('settings/document-updated', 'super-code-budgets' as never, 2)
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('poteto-mode'), undefined)
})

test('old package-backed declarations follow moved resources, including package path aliases', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'legacy-package-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const preset = fileURLToPath(new URL('../../presets/super-code/', import.meta.url))
  const alias = join(root, 'package-preset')
  await symlink(preset, alias, 'junction')
  for (const directory of [preset, alias]) {
    const ctx = new Context()
    t.after(() => ctx.fiber.dispose())
    ctx.provide('superCodeConfiguration', { get: () => ({ oilUiSkill: true, openspecSkills: true, mattpocockSkills: true, pstackSkills: true }) })
    const registry = new SkillRegistry(ctx)
    await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: join(directory, 'skills') })
    assert.equal((await registry.list()).length, 96)
    assert.ok((await registry.get('poteto-mode'))?.content)
  }
})

test('a missing user Skill root is not redirected to another builtin directory', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'missing-user-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'presets/super-code'), { recursive: true })
  await cp(join(resourceRoot, 'oil-ui'), join(root, 'builtin/skills/oil-ui'), { recursive: true })
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.provide('superCodeConfiguration', { get: () => ({ oilUiSkill: true }) })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: join(root, 'presets/super-code/skills') })
  assert.deepEqual(await registry.list(), [])
  assert.equal(await registry.get('oil-ui'), undefined)
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
  change({ oilUiSkill: true, mattpocockSkills: true })
  assert.equal((await registry.list()).length, 28)
  await ctx.fiber.dispose()
  change({ openspecSkills: true })
  assert.deepEqual(await registry.list(), [])
})

for (const boundary of ['disable', 'dispose']) test(`an in-flight Skill body cannot escape after its package ${boundary}`, async t => {
  const { ctx, registry, change } = await fixture(t)
  change({ oilUiSkill: true })
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
    protected async load(): Promise<Record<string, unknown>> { return { 'super-code-budgets': { oilUiSkill: true } } }
    protected async persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {}
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(MemorySettings)
  await ctx.inject(['settings'], () => {})
  const settings = ctx.get('settings') as MemorySettings
  const scope = settings.register('super-code-budgets', settingsConfigurationSchema)
  ctx.provide('superCodeConfiguration', { get: () => scope.get() })
  const registry = new SkillRegistry(ctx)
  await ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: resourceRoot, layout: 'builtin' })
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


test('toggling and loading every bundled Skill package leaves the project unchanged', async t => {
  const { registry, change } = await fixture(t)
  await mkdir(validationRoot, { recursive: true })
  const cwd = await mkdtemp(join(validationRoot, 'skill-switch-no-effects-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const files = { 'package.json': '{"name":"user-project"}', 'README.md': 'Keep user content' }
  for (const [name, text] of Object.entries(files)) await writeFile(join(cwd, name), text)
  const { readdir } = await import('node:fs/promises')
  for (let round = 0; round < 2; round++) {
    for (const key of ['grillMeSkill', 'oilUiSkill', 'openspecSkills', 'mattpocockSkills', 'pstackSkills']) {
      change({ [key]: true })
      for (const row of await registry.list({ cwd })) assert.ok((await registry.get(row.name, { cwd }))?.content)
      change({ oilUiSkill: false })
      assert.deepEqual(await registry.list({ cwd }), [])
    }
  }
  assert.deepEqual((await readdir(cwd)).sort(), Object.keys(files).sort())
  for (const [name, text] of Object.entries(files)) assert.equal(await readFile(join(cwd, name), 'utf8'), text)
})
