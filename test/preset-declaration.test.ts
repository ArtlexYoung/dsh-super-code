import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { DeclarationStateFile, DeclaredPresetInstaller, declarationSchema, type DeclarationConfig, type DeclarationSettings } from '../src/dsh/preset-declaration.js'
import { pluginVersion } from '../src/dsh/preset-version.js'
import { displayCopy } from '../src/dsh/preset-metadata.js'

const encode = (value: unknown) => yaml.dump(value, { schema: declarationSchema })
async function fixture(t: TestContext, bundled = true) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-declaration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const patchPath = join(root, 'cordis.patch.yml'), bundlePath = join(root, 'bundle.yml')
  const raw = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  await writeFile(bundlePath, raw)
  const template = (yaml.load(raw, { schema: declarationSchema }) as any[])[0].insert[0]
  const base = bundled ? [template] : []
  let entries = base, stored: DeclarationSettings = {}, fail = false, persistenceFailure = false
  await writeFile(patchPath, '# User configuration is preserved\n[]\n')
  const registry = {
    list: async () => entries.filter((row: any) => row.name === '@deepseek-ai/dsh-agent-preset' && row.disabled !== true)
      .map((row: any) => ({ id: row.config.id, name: row.config.name })),
    readDocument: async (id: string) => {
      const row = entries.find((row: any) => row.config.id === id)
      if (!row) throw new Error('Not found')
      return { agentPreset: id, content: encode(row.config.plugins) }
    },
  }
  let tail = Promise.resolve<unknown>(undefined)
  const host = {
    patchPath,
    entries: () => entries.map((options: any) => ({ id: options.id, options })),
    reload: async () => {
      const patches = yaml.load(await readFile(patchPath, 'utf8'), { schema: declarationSchema }) as any[]
      entries = applyEntryPatches(base, patches)
      if (fail && patches.some(row => row.config?.id === 'new-code')) { fail = false; throw new Error('Activation failed') }
    },
    exclusive: <T>(run: () => Promise<T>) => { const next = tail.then(run); tail = next.catch(() => {}); return next },
  }
  const settings = { get: () => ({ ...stored }), watch: () => () => {}, replace: async () => {}, update: async (patch: object) => {
    if (persistenceFailure) throw new Error('Persistence failed')
    stored = { ...stored, ...patch }
  } }
  const create = () => new DeclaredPresetInstaller(registry, settings, host, bundlePath)
  return { root, patchPath, bundlePath, base, host, settings, registry, create,
    fail: () => { fail = true }, failPersistence: () => { persistenceFailure = true },
    current: () => entries as any[] }
}

test('declarative installation persists a marked preset, follows language and survives recreation', async t => {
  const f = await fixture(t, false), installer = f.create()
  assert.equal((await installer.status()).state, 'missing')
  assert.equal((await installer.status()).authorable, true)
  const result = await installer.install('my-code', 'Super Code 我的模式')
  assert.equal(result.ok, true)
  assert.equal(result.status.state, 'installed')
  assert.equal(result.status.presetVersion, pluginVersion)
  assert.equal(result.status.name, 'Super Code 我的模式')
  await f.host.reload()
  assert.equal((await f.create().status()).id, 'my-code')
  await installer.synchronize('zh')
  assert.equal((await installer.status()).name, 'Super Code 我的模式')
  assert.equal(f.current()[0].config.description, displayCopy('zh').description)
  const patch = await readFile(f.patchPath, 'utf8')
  assert.ok(patch.startsWith('# User configuration is preserved'))
  assert.match(patch, /!!js/)
  assert.match(f.settings.get().declaration!.token, /^[0-9a-f-]{36}$/)
})

test('marked bundled presets support confirmed renamed reinstallation and recovery backup', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.status()).reinstallable, true)
  const result = await installer.reinstall('super-code', 'new-code', 'Super Code 新模式')
  assert.equal(result.ok, true)
  assert.equal(result.status.id, 'new-code')
  assert.equal(result.status.name, 'Super Code 新模式')
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['new-code'])
  const backup = (await readdir(f.root)).find(name => name.startsWith('.super-code-backup-'))!
  const old = yaml.load(await readFile(join(f.root, backup, 'preset.yml'), 'utf8'), { schema: declarationSchema }) as DeclarationConfig
  assert.equal(old.id, 'super-code')
  assert.equal(old.plugins[0]?.config?.presetInstallation, 'bundle:dsh-super-code')
  await f.host.reload()
  assert.equal((await f.create().status()).reinstallable, true)
  assert.equal((await installer.reinstall('new-code', 'new-code', '同名重装')).ok, true)
})

test('missing disabled bundle declaration can be installed and then reinstalled', async t => {
  const f = await fixture(t)
  f.base[0].disabled = true
  await f.host.reload()
  const installer = f.create()
  assert.equal((await installer.status()).state, 'missing')
  assert.equal((await installer.install('super-code')).ok, true)
  assert.equal((await installer.reinstall('super-code', 'new-code')).ok, true)
})

test('declaration upgrades preserve old composition versions and custom display fields until reinstallation', async t => {
  const f = await fixture(t), installer = f.create()
  f.base[0].config.plugins[0].config.presetVersion = '0.3.0'
  await installer.synchronize('zh')
  assert.equal((await installer.status()).presetVersion, '0.3.0')
  assert.equal((await installer.status()).name, displayCopy('zh').name)
  const patches = yaml.load(await readFile(f.patchPath, 'utf8'), { schema: declarationSchema }) as any[]
  patches.at(-1).config.name = '用户的名字'
  await writeFile(f.patchPath, encode(patches))
  await f.host.reload()
  await installer.synchronize('en')
  assert.equal((await installer.status()).name, '用户的名字')
  assert.equal(f.current()[0].config.description, displayCopy('en').description)
  assert.equal((await installer.status()).presetVersion, '0.3.0')
  assert.equal((await installer.reinstall('super-code', 'super-code')).status.presetVersion, pluginVersion)
})

test('same-name unrelated and unmarked legacy declarations are not deleted or adopted', async t => {
  const f = await fixture(t)
  delete f.base[0].config.plugins[0].config.presetInstallation
  const installer = f.create(), original = await readFile(f.patchPath, 'utf8')
  assert.equal((await installer.status()).state, 'conflict')
  assert.equal((await installer.status()).reinstallable, false)
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'ownership-unverified')
  assert.equal((await installer.install('super-code')).error, 'name-taken')
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
  assert.equal((await installer.install('my-code')).ok, true)
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['super-code', 'my-code'])
})

test('changed UUIDs and wrong previous identities refuse declarative reinstallation', async t => {
  const f = await fixture(t, false), installer = f.create()
  await installer.install('owned')
  const original = await readFile(f.patchPath, 'utf8')
  assert.equal((await installer.reinstall('another', 'new-code')).error, 'ownership-unverified')
  f.settings.get().declaration!.token = 'substituted'
  assert.equal((await installer.reinstall('owned', 'new-code')).error, 'ownership-unverified')
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
})

test('reinstallation conflict, invalid inputs and failed activation retain the old declaration', async t => {
  const f = await fixture(t), installer = f.create()
  f.base.push({ ...f.base[0], id: 'other-row', config: { ...f.base[0].config, id: 'other' } })
  const original = await readFile(f.patchPath, 'utf8')
  assert.equal((await installer.reinstall('super-code', 'other')).error, 'name-taken')
  assert.equal((await installer.install('../escape')).error, 'invalid-name')
  assert.equal((await installer.install('valid', ' ')).error, 'invalid-display-name')
  assert.equal((await installer.install('valid', 'a'.repeat(121))).error, 'invalid-display-name')
  f.fail()
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
  assert.equal((await installer.status()).id, 'super-code')
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['super-code', 'other'])
})

test('malformed patch files and symlinks are not overwritten; failed persistence restores the file', async t => {
  const f = await fixture(t), installer = f.create()
  await writeFile(f.patchPath, '{broken')
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), '{broken')
  await rm(f.patchPath)
  await writeFile(join(f.root, 'external.yml'), '[]\n')
  await symlink(join(f.root, 'external.yml'), f.patchPath)
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  assert.equal(await readFile(join(f.root, 'external.yml'), 'utf8'), '[]\n')
  await rm(f.patchPath)
  await writeFile(f.patchPath, '[]\n')
  f.failPersistence()
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), '[]\n')
})

test('declarative double clicks serialize and cannot create duplicates', async t => {
  const f = await fixture(t, false), installer = f.create()
  const results = await Promise.all([installer.install('duplicate'), installer.install('duplicate')])
  assert.deepEqual(results.map(result => result.ok), [true, false])
  assert.equal(results[1]?.error, 'name-taken')
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['duplicate'])
})

test('declarative ownership records survive restart and reject unsafe or foreign files', async t => {
  const f = await fixture(t, false), path = join(f.root, '.super-code-presets.json')
  const state = await DeclarationStateFile.open(path)
  const installer = new DeclaredPresetInstaller(f.registry, state, f.host, f.bundlePath)
  assert.equal((await installer.install('persistent', 'Super Code 持久预设')).ok, true)
  const reopened = await DeclarationStateFile.open(path)
  assert.equal((await new DeclaredPresetInstaller(f.registry, reopened, f.host, f.bundlePath).status()).reinstallable, true)
  const copy = reopened.get(); copy.declaration!.token = 'changed'
  assert.notEqual(reopened.get().declaration!.token, 'changed')
  const original = await readFile(path, 'utf8')
  await writeFile(path, JSON.stringify({ plugin: 'another-plugin', format: 1 }))
  await assert.rejects(DeclarationStateFile.open(path), /Unknown installation record/)
  await rm(path)
  await writeFile(join(f.root, 'foreign.json'), original)
  await symlink(join(f.root, 'foreign.json'), path)
  await assert.rejects(DeclarationStateFile.open(path), /Unsafe installation record/)
  await assert.rejects(reopened.update({ declarationDisplay: {} }), /Unsafe installation record/)
  assert.equal(await readFile(join(f.root, 'foreign.json'), 'utf8'), original)
})

test('a disabled owned declaration cannot claim an unrelated active preset with the same id', async t => {
  const f = await fixture(t)
  f.base[0].disabled = true
  f.base.push({ ...f.base[0], id: 'foreign-row', disabled: false,
    config: { ...f.base[0].config, plugins: [{ name: 'other-plugin' }] } })
  await f.host.reload()
  // The host document belongs to the active registry entry, not the disabled row.
  f.registry.readDocument = async id => ({ agentPreset: id, content: '- name: other-plugin\n' })
  const installer = f.create(), original = await readFile(f.patchPath, 'utf8')
  assert.equal((await installer.status()).reinstallable, false)
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'ownership-unverified')
  assert.deepEqual(await installer.synchronize('zh'), { changed: false })
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
})

test('early declarative hosts without a document reader require a unique enabled declaration', async t => {
  const f = await fixture(t)
  const registry = { list: f.registry.list }
  const installer = new DeclaredPresetInstaller(registry, f.settings, f.host, f.bundlePath)
  assert.equal((await installer.status()).presetVersion, pluginVersion)
  assert.equal((await installer.status()).reinstallable, true)
  assert.equal((await installer.reinstall('super-code', 'new-code')).ok, true)
  f.base.push({ ...f.base[0], id: 'foreign', config: { ...f.base[0].config, id: 'new-code', plugins: [{ name: 'other' }] } })
  await f.host.reload()
  assert.equal((await installer.status()).reinstallable, false)
  assert.equal((await installer.reinstall('new-code', 'another')).error, 'ownership-unverified')
})

test('early hosts reject disabled ownership and malformed plugin lists without throwing', async t => {
  const f = await fixture(t)
  f.base[0].disabled = true
  f.base.push({ ...f.base[0], id: 'foreign', disabled: false,
    config: { ...f.base[0].config, plugins: [null, { name: 'other' }] } })
  await f.host.reload()
  const installer = new DeclaredPresetInstaller({ list: f.registry.list }, f.settings, f.host, f.bundlePath)
  assert.equal((await installer.status()).reinstallable, false)
  f.base[0].config.plugins = {}
  assert.equal((await installer.status()).reinstallable, false)
})

test('installation records reject missing id and malformed ownership objects', async t => {
  const f = await fixture(t), path = join(f.root, 'record.json')
  for (const declaration of [null, [], { entryId: 'entry', token: '00000000-0000-0000-0000-000000000000' }]) {
    await writeFile(path, JSON.stringify({ plugin: 'dsh-super-code', format: 1, declaration }))
    await assert.rejects(DeclarationStateFile.open(path), /Invalid installation record/)
  }
})

test('a host-reported broken activation restores the previous preset and ownership record', async t => {
  const f = await fixture(t), list = f.registry.list
  f.registry.list = async () => (await list()).map(row => row.id === 'new-code' ? { ...row, broken: 'Missing dependency' } : row)
  const installer = f.create(), original = await readFile(f.patchPath, 'utf8')
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
  assert.equal((await installer.status()).id, 'super-code')
  assert.equal((await installer.status()).reinstallable, true)
  assert.equal(f.settings.get().declaration, undefined)
})
