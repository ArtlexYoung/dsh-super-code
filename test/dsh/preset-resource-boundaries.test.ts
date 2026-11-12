import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import { PresetInstaller } from '../../src/dsh/preset-installation.js'
import { copyBundledPreset } from '../../src/dsh/preset-files.js'

const composition = '- name: dsh-super-code/skills\n  config:\n    layout: builtin\n'

async function fixture(t: test.TestContext) {
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, '资源 边界-')), source = join(root, 'presets'), user = join(root, 'user')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(source, 'super-code'), { recursive: true })
  await mkdir(user)
  await mkdir(join(root, 'node_modules'))
  await symlink(fileURLToPath(new URL('../../', import.meta.url)), join(root, 'node_modules/dsh-super-code'), 'junction')
  await writeFile(join(source, 'super-code/agent.cordis.yml'), composition)
  const roots = [{ path: user, trust: 'user' as const }]
  const roster = { roots, list: () => discoverPresets(roots, pathToFileURL(join(root, 'package.json')).href) }
  let stored = { checked: false, installedId: '' }
  const settings = { get: () => structuredClone(stored), update: async (patch: object) => { stored = { ...stored, ...patch } },
    watch: () => () => {}, replace: async () => {} }
  const installer = new PresetInstaller(roster, settings, source)
  const resources = join(root, 'builtin/skills')
  const createResources = async () => {
    await mkdir(join(resources, 'oil-ui'), { recursive: true })
    await writeFile(join(resources, 'oil-ui/SKILL.md'), '---\nname: oil-ui\ndescription: Fixture skill\n---\nOriginal body\n')
  }
  return { root, source, user, resources, settings, installer, createResources, roster }
}

for (const [name, content] of [['mapping', 'plugins: []\n'], ['scalar', '"[]"\n'], ['null', 'null\n'], ['empty', '']] as const) {
  test(`a ${name} composition is rejected before a preset or installation record is published`, async t => {
    const f = await fixture(t)
    await f.createResources()
    await writeFile(join(f.source, 'super-code/agent.cordis.yml'), content)
    const before = f.settings.get()
    const result = await f.installer.install('copy')
    assert.equal(result.ok, false)
    assert.equal(result.error, 'install-failed')
    assert.equal(result.status.state, 'missing')
    assert.deepEqual(f.settings.get(), before)
    assert.deepEqual(await readdir(f.user), [], 'failed staging must be cleaned up')
  })
}

for (const kind of ['file', 'directory'] as const) test(`a symbolic link to an external ${kind} rejects copying without changing its target`, async t => {
  const f = await fixture(t)
  await f.createResources()
  const external = join(f.root, 'external'), file = kind === 'file' ? external : join(external, 'keep.txt')
  if (kind === 'directory') await mkdir(external)
  await writeFile(file, 'External content must remain unchanged', { mode: 0o644 })
  const before = await lstat(file)
  await symlink(external, join(f.resources, 'external-link'), kind === 'directory' ? 'junction' : 'file')
  await assert.rejects(copyBundledPreset(f.source, join(f.root, 'direct-stage'), 'copy', 'Copy'), /symbolic link/)
  const settings = f.settings.get()
  assert.equal((await f.installer.install('copy')).error, 'install-failed')
  assert.deepEqual(f.settings.get(), settings)
  assert.deepEqual(await readdir(f.user), [])
  assert.equal(await readFile(file, 'utf8'), 'External content must remain unchanged')
  assert.equal((await lstat(file)).mode, before.mode, 'permission hardening must not follow the link')
})

for (const nextId of ['original', 'renamed']) test(`missing builtin resources roll back reinstallation as ${nextId} and allow a later retry`, async t => {
  const f = await fixture(t)
  await f.createResources()
  assert.equal((await f.installer.install('original', 'Super Code 我的模式')).ok, true)
  assert.equal((await f.installer.status()).state, 'installed', JSON.stringify(await f.roster.list()))
  const directory = join(f.user, 'original')
  await writeFile(join(directory, 'custom.txt'), 'Keep my customized preset')
  const marker = await readFile(join(directory, '.super-code-installation.json'), 'utf8')
  const body = await readFile(join(directory, 'builtin/skills/oil-ui/SKILL.md'), 'utf8')
  const before = f.settings.get()
  await rm(f.resources, { recursive: true })
  const result = await f.installer.reinstall('original', nextId, 'New display name')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'install-failed')
  assert.equal(result.status.state, 'installed')
  assert.deepEqual(f.settings.get(), before)
  assert.deepEqual(await readdir(f.user), ['original'])
  assert.equal(await readFile(join(directory, 'custom.txt'), 'utf8'), 'Keep my customized preset')
  assert.equal(await readFile(join(directory, '.super-code-installation.json'), 'utf8'), marker)
  assert.equal(await readFile(join(directory, 'builtin/skills/oil-ui/SKILL.md'), 'utf8'), body)
  await f.createResources()
  assert.equal((await f.installer.reinstall('original', nextId, 'Retry')).ok, true)
  const backup = (await readdir(f.user)).find(name => name.startsWith('.super-code-backup-'))!
  assert.equal(await readFile(join(f.user, backup, 'original/custom.txt'), 'utf8'), 'Keep my customized preset')
})
