import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SkillDirectory, skillDirectoryCommand } from '../../src/dsh/skill-directory.js'
import { apply, registerBundledSkills } from '../../src/dsh/bundled-skills.js'
import { prepareSkillDirectory, synchronizeSkillCopy } from '../../src/dsh/skill-installation.js'
import type { Configuration } from '../../src/dsh/budgets.js'
import { validationRoot } from '../validation-root.js'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { applyBudgetSettings } from '../../src/dsh/budget-settings.js'
import { applySkillDirectory } from '../../src/dsh/skill-directory.js'

const resources = fileURLToPath(new URL('../../builtin/skills/', import.meta.url))
test('native directory commands preserve spaces, Chinese, quotes and shell-looking text as one literal path', () => {
  const path = "/temporary/中文 目录/O'Reilly/$(inert)`text`"
  for (const platform of ['darwin', 'linux'] as const) assert.deepEqual(skillDirectoryCommand(path, platform).args, [path])
  const windows = skillDirectoryCommand(path, 'win32')
  assert.equal(windows.command, 'powershell.exe')
  assert.equal(windows.args.at(-1), "Invoke-Item -LiteralPath '/temporary/中文 目录/O''Reilly/$(inert)`text`'")
  assert.throws(() => skillDirectoryCommand(path, 'freebsd'))
})
async function fixture(t: test.TestContext) {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'skill-directory-中文 空格-'))
  const ctx = new Context(), registry = new SkillRegistry(ctx)
  let configuration: Configuration = {}
  ctx.provide('superCodeConfiguration', { get: () => configuration })
  const directory = join(root, 'home/skills/dsh-super-code')
  const service = new SkillDirectory(directory, resources, () => configuration)
  ctx.provide('superCodeSkills', service)
  const sync = service.synchronize()
  registerBundledSkills(ctx, { bundledSkillDir: directory, layout: 'builtin' }, service)
  await sync
  t.after(async () => { await service.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, directory, service, ctx, registry, async change(value: Configuration) {
    configuration = value
    const ready = service.synchronize()
    ctx.emit('settings/document-updated', 'super-code-budgets' as never, 1)
    await ready
  } }
}

test('missing switches do not install Skill packages and returning to defaults removes owned copies', async t => {
  const f = await fixture(t)
  assert.equal(f.service.status().state, 'ready')
  assert.deepEqual((await readdir(f.directory)).filter(name => !name.startsWith('.')), [])
  assert.deepEqual(await f.registry.list(), [])
  await f.change({ oilUiSkill: true })
  assert.ok(await readFile(join(f.directory, 'oil-ui/SKILL.md')))
  assert.ok(await f.registry.get('oil-ui'))
  await f.change({})
  assert.deepEqual((await readdir(f.directory)).filter(name => !name.startsWith('.')), [])
  assert.deepEqual(await f.registry.list(), [])
})

test('enabled packages live in the DSH user Skill directory with complete native-loadable resources', async t => {
  const f = await fixture(t), sentinel = join(f.root, 'project/keep.txt')
  await mkdir(join(f.root, 'project')); await writeFile(sentinel, 'unchanged')
  await f.change({ oilUiSkill: true })
  assert.deepEqual((await f.registry.list()).map(row => row.name), ['oil-ui'])
  assert.match((await f.registry.get('oil-ui'))!.path!, /home[/\\]skills[/\\]dsh-super-code/)
  await f.change({ oilUiSkill: false, grillMeSkill: true })
  assert.deepEqual((await f.registry.list()).map(row => row.name).sort(), ['grill-me', 'grilling'])
  await assert.rejects(readFile(join(f.directory, 'oil-ui/SKILL.md')), { code: 'ENOENT' })
  assert.match(await readFile(join(f.directory, 'mattpocock/skills/grill-me/SKILL.md'), 'utf8'), /grilling/)
  await f.change({ oilUiSkill: true, grillMeSkill: true, mattpocockSkills: true, openspecSkills: true, pstackSkills: true })
  assert.equal((await f.registry.list()).length, 96)
  const skill = await f.registry.get('poteto-mode')
  assert.equal(skill?.resourceBase?.kind, 'directory')
  if (skill?.resourceBase?.kind !== 'directory') throw new Error('Missing resource base')
  assert.match(await readFile(resolve(skill.resourceBase.path, '../../DSH.md'), 'utf8'), /PStack on DeepSeek Harness/)
  assert.ok(await readFile(resolve(skill.resourceBase.path, '../../scripts/capture.mjs')))
  assert.ok(await readFile(resolve(skill.resourceBase.path, '../../agents/poteto-agent.md')))
  assert.equal(await readFile(sentinel, 'utf8'), 'unchanged')
  await f.change({ oilUiSkill: false })
  assert.deepEqual(await f.registry.list(), [])
  assert.deepEqual((await readdir(f.directory)).filter(name => !name.startsWith('.')), [])
  assert.equal(f.service.status().state, 'ready')
})

test('standalone and workflow switches share one copy and refresh warmed catalogs', async t => {
  const f = await fixture(t)
  await f.change({ oilUiSkill: false, grillMeSkill: true })
  const file = join(f.directory, 'mattpocock/skills/grilling/SKILL.md'), before = await readFile(file)
  assert.equal((await f.registry.list()).length, 2)
  await f.change({ oilUiSkill: false, grillMeSkill: true, mattpocockSkills: true })
  assert.equal((await f.registry.list()).length, 27)
  assert.deepEqual(await readFile(file), before)
  await f.change({ oilUiSkill: false, mattpocockSkills: true })
  assert.ok(await f.registry.get('grill-me'))
  await f.change({ oilUiSkill: false, grillMeSkill: true })
  assert.equal((await f.registry.list()).length, 2)
  await f.change({ oilUiSkill: false })
  assert.equal(await f.registry.get('grill-me'), undefined)
})

test('a native project or independently installed user Skill keeps its priority', async t => {
  const f = await fixture(t)
  const project = join(f.root, 'project/.dsh/skills/oil-ui'), own = join(f.root, 'home/skills/own')
  for (const directory of [project, own]) await mkdir(directory, { recursive: true })
  await writeFile(join(project, 'SKILL.md'), '---\nname: oil-ui\ndescription: project\n---\nProject override')
  await writeFile(join(own, 'SKILL.md'), '---\nname: own\ndescription: own\n---\nUser skill')
  f.registry.registerProvider(control => new FileSystemSkillProvider(f.ctx, control, {
    providerName: 'filesystem', watch: false, dshHome: join(f.root, 'home'), agentsHome: join(f.root, 'agents'),
  }))
  assert.equal((await f.registry.get('oil-ui', { cwd: join(f.root, 'project') }))?.content, 'Project override')
  assert.ok(await f.registry.get('own'))
  await f.change({ oilUiSkill: false })
  assert.ok(await f.registry.get('own'))
  assert.equal((await f.registry.get('oil-ui', { cwd: join(f.root, 'project') }))?.content, 'Project override')
  assert.match(await readFile(join(own, 'SKILL.md'), 'utf8'), /User skill/)
})

test('existing unowned directories and modified copies are preserved and reported', async t => {
  const f = await fixture(t)
  await f.change({ oilUiSkill: true })
  const file = join(f.directory, 'oil-ui/SKILL.md')
  await writeFile(file, '---\nname: oil-ui\ndescription: edited\n---\nUser edited')
  await f.change({ oilUiSkill: false })
  assert.equal(await f.registry.get('oil-ui'), undefined)
  assert.match(await readFile(file, 'utf8'), /User edited/)
  assert.deepEqual(f.service.status().issues, [{ id: 'oil-ui', error: 'modified' }])
  await f.change({ oilUiSkill: true })
  assert.equal((await f.registry.get('oil-ui'))?.content, 'User edited')
  const unowned = join(f.directory, 'openspec')
  await mkdir(unowned); await writeFile(join(unowned, 'keep'), 'keep')
  await f.change({ openspecSkills: true })
  assert.equal(await f.registry.get('openspec-propose'), undefined)
  assert.equal(await readFile(join(unowned, 'keep'), 'utf8'), 'keep')
  assert.ok(f.service.status().issues.some(row => row.id === 'openspec' && row.error === 'conflict'))
})

test('Finder metadata does not count as a user edit or prevent disabling a Skill', async t => {
  const f = await fixture(t)
  await f.change({ oilUiSkill: true })
  await writeFile(join(f.directory, 'oil-ui/.DS_Store'), 'Finder metadata')
  await writeFile(join(f.directory, 'oil-ui/references/.DS_Store'), 'Nested Finder metadata')
  await f.change({ oilUiSkill: false })
  assert.equal(f.service.status().state, 'ready')
  assert.deepEqual(f.service.status().issues, [])
  assert.equal(await f.registry.get('oil-ui'), undefined)
  await assert.rejects(readFile(join(f.directory, 'oil-ui/SKILL.md')), { code: 'ENOENT' })
  await f.change({ oilUiSkill: true })
  assert.match((await f.registry.get('oil-ui'))!.content, /oil-ui/)
  assert.equal(f.service.status().state, 'ready')
})

test('unmarked and symlinked roots cannot be adopted or write into another directory', async t => {
  const f = await fixture(t), unowned = join(f.root, 'unowned'), other = join(f.root, 'other')
  await mkdir(unowned); await mkdir(other); await writeFile(join(other, 'keep'), 'safe')
  await assert.rejects(prepareSkillDirectory(unowned))
  const linked = join(f.root, 'linked')
  await symlink(other, linked, 'junction')
  await assert.rejects(prepareSkillDirectory(linked))
  const service = new SkillDirectory(linked, resources, () => ({}))
  await service.synchronize()
  assert.equal(service.status().state, 'error')
  assert.deepEqual(await readdir(other), ['keep'])
  assert.equal(await readFile(join(other, 'keep'), 'utf8'), 'safe')
})

test('rapid switches serialize copies and teardown prevents further writes', async t => {
  const f = await fixture(t)
  await Promise.all([f.change({ openspecSkills: true }), f.change({ grillMeSkill: true }), f.change({ oilUiSkill: false })])
  assert.deepEqual(await f.registry.list(), [])
  assert.deepEqual((await readdir(f.directory)).filter(name => !name.startsWith('.')), [])
  await f.service.close()
  await f.change({ pstackSkills: true })
  assert.deepEqual((await readdir(f.directory)).filter(name => !name.startsWith('.')), [])
})

test('upgrades replace unchanged copies, preserve edits, and retry after the source becomes available', async t => {
  const f = await fixture(t), source = join(f.root, 'new-source'), target = join(f.root, 'new-target')
  await mkdir(source)
  let config: Configuration = { oilUiSkill: false, grillMeSkill: true }
  const service = new SkillDirectory(target, source, () => config)
  await service.synchronize()
  assert.equal(service.status().state, 'error')
  await cp(join(resources, 'mattpocock'), join(source, 'mattpocock'), { recursive: true })
  await service.synchronize()
  assert.equal(service.status().state, 'ready')
  const file = 'mattpocock/skills/grilling/SKILL.md'
  await writeFile(join(source, file), 'New upstream')
  await service.close()
  const upgrade = new SkillDirectory(target, source, () => config)
  await upgrade.synchronize()
  assert.equal(await readFile(join(target, file), 'utf8'), 'New upstream')
  await writeFile(join(target, file), 'User edited')
  config = { oilUiSkill: false }
  await upgrade.synchronize()
  assert.equal(await readFile(join(target, file), 'utf8'), 'User edited')
})

test('preset-scoped legacy loaders reuse the global library rather than registering duplicate providers', async t => {
  const f = await fixture(t), before = (await f.registry.list()).length
  await f.ctx.plugin({ apply, inject: ['skills', 'superCodeConfiguration'] }, { bundledSkillDir: resources, layout: 'builtin' })
  assert.equal((await f.registry.list()).length, before)
})

test('the real settings Remote waits for persisted switches and disk synchronization before returning', async t => {
  await mkdir(validationRoot, { recursive: true })
  const home = await mkdtemp(join(validationRoot, 'skill-settings-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context(), registry = new SkillRegistry(ctx)
  t.after(async () => {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
  class MemorySettings extends SettingsProvider {
    writable = true
    stored: Record<string, unknown> = { 'super-code-budgets': { oilUiSkill: false, grillMeSkill: true } }
    protected async load(): Promise<Record<string, unknown>> { return { 'super-code-budgets': { oilUiSkill: false, grillMeSkill: true } } }
    protected async persist(ns: SettingsNamespace, value: Record<string, unknown>): Promise<void> { this.stored[ns] = value }
  }
  await ctx.plugin(MemorySettings)
  await ctx.plugin({ apply(owner: Context) { applyBudgetSettings(owner, {}); applySkillDirectory(owner) } })
  await ctx.inject(['superCodeBudgets'], () => {})
  await ctx.superCodeSkills.synchronize()
  const remote = ctx.get('superCodeBudgets') as { readConfig(): any; saveConfig(content: string, revision: string): Promise<any>; syncSkills(): Promise<any> }
  assert.equal(remote.readConfig().configuration.grillMeSkill, true, 'the persisted namespace is ready before synchronization')
  assert.deepEqual((await registry.list()).map(row => row.name).sort(), ['grill-me', 'grilling'])
  await assert.rejects(readFile(join(home, 'skills/dsh-super-code/oil-ui/SKILL.md')), { code: 'ENOENT' })
  const initial = remote.readConfig()
  const saved = await remote.saveConfig('{"oilUiSkill":false,"openspecSkills":true}', `${initial.revision}:${initial.generation}`)
  assert.equal(saved.ok, true)
  assert.equal(saved.snapshot.skills.state, 'ready')
  assert.equal((await registry.list()).length, 12)
  assert.ok(await readFile(join(home, 'skills/dsh-super-code/openspec/skills/openspec-propose/SKILL.md')))
  const updated = await remote.syncSkills()
  assert.equal(updated.skills.state, 'ready')
})

for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini', 'THUMBS.DB', 'Desktop.INI']) {
  test(`system directory metadata ${name} permits Skill upgrades and removal`, async t => {
    const f = await fixture(t), source = join(f.root, 'source'), target = join(f.root, 'target')
    await mkdir(join(source, 'references'), { recursive: true })
    await writeFile(join(source, 'SKILL.md'), 'original')
    await prepareSkillDirectory(target)
    assert.deepEqual(await synchronizeSkillCopy(target, 'sample', source, true), { available: true })
    for (const folder of ['sample', 'sample/references']) await writeFile(join(target, folder, name), 'OS metadata')
    await writeFile(join(source, 'SKILL.md'), 'upgraded')
    assert.deepEqual(await synchronizeSkillCopy(target, 'sample', source, true), { available: true })
    assert.equal(await readFile(join(target, 'sample/SKILL.md'), 'utf8'), 'upgraded')
    await writeFile(join(target, 'sample', name), 'new metadata')
    assert.deepEqual(await synchronizeSkillCopy(target, 'sample', source, false), { available: false })
  })
}

test('metadata-looking directories and user changes remain protected', async t => {
  const f = await fixture(t), source = join(f.root, 'source'), target = join(f.root, 'target')
  await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'original'); await prepareSkillDirectory(target)
  await synchronizeSkillCopy(target, 'sample', source, true)
  await mkdir(join(target, 'sample/desktop.ini'))
  await writeFile(join(target, 'sample/desktop.ini/user.txt'), 'user content')
  assert.deepEqual(await synchronizeSkillCopy(target, 'sample', source, false), { available: false, error: 'modified' })
  assert.equal(await readFile(join(target, 'sample/desktop.ini/user.txt'), 'utf8'), 'user content')
})

test('metadata-named links cannot disguise user resources during Skill removal', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside')
  await f.change({ oilUiSkill: true })
  await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'user content')
  await symlink(outside, join(f.directory, 'oil-ui/desktop.ini'), 'junction')
  await f.change({ oilUiSkill: false })
  assert.deepEqual(f.service.status().issues, [{ id: 'oil-ui', error: 'modified' }])
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'user content')
})
