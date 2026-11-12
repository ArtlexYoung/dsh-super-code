import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { DeclarationStateFile, DeclaredPresetInstaller, appendProfilePatches, declarationSchema, type DeclarationConfig, type DeclarationSettings } from '../../src/dsh/preset-declaration.js'
import { pluginVersion } from '../../src/dsh/preset-version.js'
import { displayCopy } from '../../src/dsh/preset-metadata.js'

const encode = (value: unknown) => yaml.dump(value, { schema: declarationSchema })
async function fixture(t: TestContext, bundled = true) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-declaration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const patchPath = join(root, 'cordis.patch.yml'), bundlePath = join(root, 'bundle.yml')
  const raw = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
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
      const content = await readFile(patchPath, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '[]\n'
        throw error
      })
      const patches = yaml.load(content, { schema: declarationSchema }) as any[]
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
  assert.equal(result.status.skillPacks, true)
  const skillLoader = f.current()[0].config.plugins.find((row: any) => row.name === 'dsh-super-code/skills')
  skillLoader.disabled = true
  assert.equal((await installer.status()).skillPacks, undefined, 'declaration status follows the disabled loader')
  skillLoader.disabled = false
  assert.equal((await installer.status()).skillPacks, true)
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

test('declarative installation and renamed reinstallation retain deferred bundled skill resolution', async t => {
  const f = await fixture(t, false), installer = f.create()
  assert.equal((await installer.install('frontend-code')).ok, true)
  const template = (yaml.load(await readFile(f.bundlePath, 'utf8'), { schema: declarationSchema }) as any[])[0].insert[0]
  const expected = template.config.plugins.find((row: any) => row.id === 'skill-super-code-bundled')
  assert.ok(expected.config.bundledSkillDir.__jsExpr)
  for (const id of ['frontend-code', 'renamed-frontend']) {
    await f.host.reload()
    const document = await f.registry.readDocument(id)
    const rows = yaml.load(document.content, { schema: declarationSchema }) as any[]
    assert.deepEqual(rows.find(row => row.id === expected.id), expected)
    if (id === 'frontend-code') assert.equal((await installer.reinstall(id, 'renamed-frontend')).ok, true)
  }
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

for (const change of ['foreign', 'corrupt', 'removed', 'other-writer'] as const) {
  test(`installation ownership refuses a stale write after ${change} state changes`, async t => {
    const f = await fixture(t, false), path = join(f.root, 'ownership.json')
    const state = await DeclarationStateFile.open(path)
    await state.update({ declarationDisplay: { name: 'Before' } })
    const before = state.get()
    let content: string | false
    if (change === 'removed') { await rm(path); content = false }
    else if (change === 'other-writer') {
      const other = await DeclarationStateFile.open(path)
      await other.update({ declarationDisplay: { name: 'External' } })
      content = await readFile(path, 'utf8')
    } else {
      content = change === 'foreign' ? JSON.stringify({ plugin: 'another-plugin', format: 1 }) : '{corrupt'
      await writeFile(path, content)
    }
    await assert.rejects(state.update({ declarationDisplay: { name: 'Late' } }), /changed|record/i)
    assert.deepEqual(state.get(), before)
    if (content === false) await assert.rejects(readFile(path), { code: 'ENOENT' })
    else assert.equal(await readFile(path, 'utf8'), content)
  })
}

test('concurrent ownership updates preserve both fields instead of losing a completed update', async t => {
  const f = await fixture(t, false), path = join(f.root, 'ownership.json')
  const state = await DeclarationStateFile.open(path)
  const declaration = { entryId: 'owned', id: 'owned', token: '00000000-0000-0000-0000-000000000001' }
  await Promise.all([state.update({ declaration }), state.update({ declarationDisplay: { name: 'Display' } })])
  assert.deepEqual(state.get(), { declaration, declarationDisplay: { name: 'Display' } })
  assert.deepEqual((await DeclarationStateFile.open(path)).get(), state.get())
})

test('queued ownership writes retain the submitted identity when a caller reuses its draft', async t => {
  const f = await fixture(t, false), path = join(f.root, 'ownership.json')
  const state = await DeclarationStateFile.open(path)
  const declaration = { entryId: 'owned', id: 'owned', token: '00000000-0000-0000-0000-000000000001' }
  const declarationDisplay = { name: 'Super Code 我的模式', description: 'Original description' }
  const expected = structuredClone({ declaration, declarationDisplay })
  const writes = [state.update({ declaration }), state.update({ declarationDisplay })]
  declaration.entryId = 'another-entry'; declaration.id = 'another'; declaration.token = '00000000-0000-0000-0000-000000000002'
  declarationDisplay.name = 'Later draft'; declarationDisplay.description = 'Later description'
  await Promise.all(writes)
  assert.deepEqual(state.get(), expected)
  assert.deepEqual((await DeclarationStateFile.open(path)).get(), expected)
  assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('.super-code-record-')), [])
})

test('profile patch appends preserve nested user values across YAML styles and line endings', () => {
  const patch = { insert: [{ id: 'added', name: 'added-plugin', config: { label: '中文 😀' } }] }
  const notes = ['hello', 'line one\nline two\n\n', 'trailing spaces   ', 'one\r\ntwo', '---\n...\n- after',
    'quotes: \'" # comment', '2026-11-12', '{{literal}}', '\uFEFFvalue']
  for (const note of notes) for (const flowLevel of [-1, 0, 1, 3]) for (const indent of [2, 4]) {
    const original = [{ insert: [{ id: 'user-entry', name: 'user-plugin', config: {
      note, deep: { value: note }, list: [1, false, 'text'], expression: { __jsExpr: 'env.USER_VALUE' },
    } }] }]
    for (const finalNewline of [true, false]) for (const newline of ['\n', '\r\n']) for (const envelope of ['plain', 'document', 'bom']) {
      let text = yaml.dump(original, { schema: declarationSchema, flowLevel, indent, noRefs: true, lineWidth: -1 })
      if (!finalNewline) text = text.replace(/\n$/, '')
      text = '# Before\n' + text
      if (envelope === 'document') text = '---\n' + text + (text.endsWith('\n') ? '' : '\n') + '... # End\n# After\n'
      if (envelope === 'bom') text = '\uFEFF' + text
      text = text.replaceAll('\n', newline)
      const appended = appendProfilePatches(text, [patch])
      const loaded = yaml.load(appended, { schema: entryListSchema }) as any[]
      assert.deepEqual(loaded, [...original, patch], JSON.stringify({ note, flowLevel, indent, finalNewline, newline, envelope }))
      assert.deepEqual(applyEntryPatches([], loaded), [...original[0]!.insert, ...patch.insert])
    }
  }
})

test('a stale ownership record aborts installation and restores the previous profile patch', async t => {
  const f = await fixture(t, false), path = join(f.root, 'ownership.json')
  const state = await DeclarationStateFile.open(path)
  await state.update({ declarationDisplay: {} })
  const installer = new DeclaredPresetInstaller(f.registry, state, f.host, f.bundlePath)
  const original = await readFile(f.patchPath, 'utf8'), foreign = JSON.stringify({ plugin: 'another-plugin', format: 1 })
  await writeFile(path, foreign)
  assert.equal((await installer.install('owned')).error, 'install-failed')
  assert.equal(await readFile(path, 'utf8'), foreign)
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
  assert.deepEqual(await f.registry.list(), [])
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
  const skillLoader = f.current()[0].config.plugins.find((row: any) => row.name === 'dsh-super-code/skills')
  skillLoader.disabled = true
  assert.equal((await installer.status()).skillPacks, undefined)
  skillLoader.disabled = false
  assert.equal((await installer.status()).skillPacks, true)
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

test('installation records reject malformed display baselines without modifying the profile', async t => {
  const f = await fixture(t), path = join(f.root, 'record.json')
  const original = await readFile(f.patchPath, 'utf8')
  for (const declarationDisplay of [null, false, 0, '', [], { name: false }, { description: 1 }]) {
    const content = JSON.stringify({ plugin: 'dsh-super-code', format: 1, declarationDisplay })
    await writeFile(path, content)
    await assert.rejects(DeclarationStateFile.open(path), /Invalid display record/)
    assert.equal(await readFile(path, 'utf8'), content)
    assert.equal(await readFile(f.patchPath, 'utf8'), original)
  }
  for (const declarationDisplay of [undefined, {}, { name: '', description: 'Custom description' }]) {
    await writeFile(path, JSON.stringify({ plugin: 'dsh-super-code', format: 1, declarationDisplay }))
    assert.deepEqual((await DeclarationStateFile.open(path)).get().declarationDisplay, declarationDisplay)
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

test('failed activation leaves the previous preset manageable even when an ownership rollback would fail', async t => {
  const f = await fixture(t), installer = f.create(), original = await readFile(f.patchPath, 'utf8')
  const update = f.settings.update
  let writes = 0
  f.settings.update = async patch => {
    if (++writes === 2) throw new Error('Ownership rollback failed')
    await update(patch)
  }
  f.fail()
  const result = await installer.reinstall('super-code', 'new-code')
  assert.equal(result.error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), original)
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['super-code'])
  assert.equal(result.status.id, 'super-code')
  assert.equal(result.status.reinstallable, true)
  assert.equal(writes, 0, 'a rejected activation never publishes new ownership')
})

test('a refused declarative activation does not leave a saved ownership record if the patch changes during reload', async t => {
  const f = await fixture(t), installer = f.create(), reload = f.host.reload
  const external = '# A separate edit was saved while the Loader was reloading\n[]\n'
  f.host.reload = async () => {
    await writeFile(f.patchPath, external)
    await reload()
    throw new Error('Activation failed after an external edit')
  }
  const result = await installer.reinstall('super-code', 'new-code')
  assert.equal(result.error, 'install-failed')
  assert.equal(await readFile(f.patchPath, 'utf8'), external)
  assert.equal(f.settings.get().declaration, undefined)
  assert.equal(result.status.id, 'super-code')
  assert.equal(result.status.reinstallable, true)
})

test('failed installation restores an originally absent profile patch to absence', async t => {
  const f = await fixture(t), installer = f.create()
  await rm(f.patchPath)
  f.failPersistence()
  assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
  await assert.rejects(readFile(f.patchPath), { code: 'ENOENT' })
  assert.deepEqual((await f.registry.list()).map(row => row.id), ['super-code'])
})

const userEntryPatch = { insert: [{ id: 'user-entry', name: 'user-plugin', config: {
  id: 'user-entry', note: 'Keep my configuration', deferred: { __jsExpr: 'env.USER_VALUE' },
} }] }
const scalarPatch = '- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        date: 2026-11-11\n        timestamp: 2026-11-11T22:30:00+08:00\n        <<: {label: literal}\n        nested: [{date: 2026-11-11}]\n        deferred: !!js env.USER_VALUE\n'
const patchLayouts = [
  { label: 'anchored block list with host scalar strings', content: '&profile\n' + scalarPatch },
  { label: 'ordinary block list with host scalar strings', content: scalarPatch },
  { label: 'flow list with host scalar strings', content: '[{insert: [{id: user-entry, name: user-plugin, config: {date: 2026-11-11, timestamp: 2026-11-11T22:30:00+08:00, <<: {label: literal}, nested: [{date: 2026-11-11}], deferred: !!js env.USER_VALUE}}]}]\n' },
  { label: 'spaced empty flow list', content: '# Before\n[ ]\n# After\n' },
  { label: 'multiline empty flow list', content: '# Before\n[\n  # Empty\n]\n# After\n' },
  { label: 'empty document with an end marker', content: '# Before\n---\n[]\n... # End\n# After\n' },
  { label: 'block document with an end marker', content: '# Before\n---\n' + encode([userEntryPatch]) + '# Keep block comment\n... # End\n# After\n' },
  { label: 'flow list containing a hyphen at the start of a quoted line', content: '# Before\n[{insert: [{id: user-entry, name: user-plugin, config: {id: user-entry, note: "Keep\n- this text"}}]}]\n# After\n' },
  { label: 'ordinary block list', content: '# Before\n' + encode([userEntryPatch]) + '# Keep block comment\n# After\n' },
  { label: 'nonempty flow list', content: '# Before\n' + yaml.dump([userEntryPatch], { schema: declarationSchema, flowLevel: 0 }) + '# After\n' },
  { label: 'inline document header', content: '# Before\n--- [ ]\n... # End\n# After\n' },
  { label: 'indented block list', content: '# Before\n' + encode([userEntryPatch]).replace(/^(?=.)/gm, '  ') + '# Keep block comment\n# After\n' },
  { label: 'anchored block document', content: '# Before\n---\n&patch\n' + encode([userEntryPatch]) + '... # End\n# After\n' },
  { label: 'BOM-prefixed Windows document', content: '\uFEFF# Before\r\n---\r\n' + encode([userEntryPatch]).replace(/\n/g, '\r\n') + '... # End\r\n# After\r\n' },
  { label: 'BOM-prefixed empty flow list', content: '\uFEFF# Before\r\n[ ] # After\r\n' },
  { label: 'BOM-prefixed list without trailing whitespace', content: '\uFEFF[]' },
  { label: 'BOM-prefixed blank file', content: '\uFEFF  \r\n' },
  { label: 'BOM-prefixed first-line block list', content: '\uFEFF' + encode([userEntryPatch]) },
  { label: 'BOM-prefixed first-line block list without final newline', content: '\uFEFF' + encode([userEntryPatch]).trimEnd() },
  { label: 'BOM-prefixed indented first-line CRLF block list', content: '\uFEFF' + encode([userEntryPatch]).replace(/^(?=.)/gm, '  ').replace(/\n/g, '\r\n') },
  { label: 'document with YAML directives', content: '# Before\n%YAML 1.2\n---\n' + encode([userEntryPatch]) + '... # End\n# After\n' },
  { label: 'flow list with an inline trailing comment', content: '# Before\n[ ] # After\n' },
  { label: 'literal block preserving trailing blank lines', content: '# Before\n- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        id: user-entry\n        note: |+\n          Keep trailing blank lines\n\n\n' },
  { label: 'literal block preserving final spaces', content: '# Before\n- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        id: user-entry\n        note: |-\n          Keep final spaces   ' },
]

for (const layout of patchLayouts) {
  for (const action of ['install', 'reinstall', 'synchronize'] as const) {
    test(`${action} accepts a ${layout.label} without changing other configuration`, async t => {
      const f = await fixture(t, action !== 'install')
      await writeFile(f.patchPath, layout.content)
      await f.host.reload()
      const before = structuredClone(f.current().filter(row => row.name === 'user-plugin'))
      const installer = f.create()
      if (action === 'synchronize') {
        assert.equal((await installer.synchronize('zh')).changed, true)
        assert.equal((await installer.status()).name, displayCopy('zh').name)
      } else {
        const result = action === 'install' ? await installer.install('new-code', 'Super Code 新模式')
          : await installer.reinstall('super-code', 'new-code', 'Super Code 新模式')
        assert.equal(result.ok, true, result.error)
        assert.equal(result.status.name, 'Super Code 新模式')
      }
      const content = await readFile(f.patchPath, 'utf8')
      if (layout.content.startsWith('\uFEFF-') || layout.content.startsWith('\uFEFF  -')) assert.equal(content.split('\uFEFF').length, 2, 'only the original file header contains BOM')
      const previous = layout.content.trim() ? yaml.load(layout.content, { schema: declarationSchema }) as unknown[] : []
      assert.equal((yaml.load(content, { schema: declarationSchema }) as unknown[]).length, previous.length + 1)
      const nativeBefore = layout.content.trim() ? yaml.load(layout.content, { schema: entryListSchema }) as unknown[] : []
      assert.deepEqual((yaml.load(content, { schema: entryListSchema }) as unknown[]).slice(0, nativeBefore.length), nativeBefore, 'preserve the host YAML values, including date strings and literal merge keys')
      if (layout.content.includes('# Before')) assert.ok(content.replace(/^\uFEFF/, '').startsWith('# Before'))
      if (layout.content.includes('# After')) assert.ok(content.includes('# After'))
      if (layout.content.includes('... # End')) assert.ok(content.includes('... # End'))
      if (layout.content.includes('# Keep block comment')) assert.ok(content.includes('# Keep block comment'))
      await f.host.reload()
      assert.deepEqual(f.current().filter(row => row.name === 'user-plugin'), before)
      assert.equal((await f.create().status()).state, 'installed')
      assert.equal((await f.create().status()).reinstallable, true)
      const backup = (await readdir(f.root)).find(name => name.startsWith('.super-code-backup-'))!
      assert.equal(await readFile(join(f.root, backup, 'cordis.patch.yml'), 'utf8'), layout.content)
    })
  }
}

for (const failure of ['activation', 'persistence', 'synchronize-persistence'] as const) {
  test(`a document end marker and other configuration survive ${failure} failure`, async t => {
    const f = await fixture(t), layout = patchLayouts.find(row => row.label === 'block document with an end marker')!
    await writeFile(f.patchPath, layout.content)
    await f.host.reload()
    const before = structuredClone(f.current()), installer = f.create()
    if (failure === 'activation') f.fail()
    else f.failPersistence()
    if (failure === 'synchronize-persistence') await assert.rejects(installer.synchronize('zh'), /Persistence failed/)
    else assert.equal((await installer.reinstall('super-code', 'new-code')).error, 'install-failed')
    assert.equal(await readFile(f.patchPath, 'utf8'), layout.content)
    assert.deepEqual(f.current(), before)
    assert.equal((await installer.status()).reinstallable, true)
    assert.equal(f.settings.get().declaration, undefined)
  })
}
