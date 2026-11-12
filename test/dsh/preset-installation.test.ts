import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir, rename, cp, lstat } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverPresets, type PresetRoot } from '@deepseek-ai/dsh-agent-presets'
import { DeclaredPresetStatus, PresetInstaller } from '../../src/dsh/preset-installation.js'
import { compositionVersion, pluginVersion } from '../../src/dsh/preset-version.js'
import { displayCopy } from '../../src/dsh/preset-metadata.js'

test('declarative host reports its own preset without editing the profile', async () => {
  const available = new DeclaredPresetStatus({ list: async () => [{ id: 'super-code', name: 'Super Code' }] })
  assert.deepEqual(await available.status(), { id: 'super-code', name: 'Super Code', authorable: false,
    userConflict: false, state: 'available', delivery: 'declaration', pluginVersion })
  assert.deepEqual(await available.synchronize('zh-CN'), { changed: false })
  assert.equal((await available.install('copy')).error, 'management-unavailable')
  assert.equal((await available.reinstall('super-code', 'copy')).error, 'management-unavailable')

  const broken = new DeclaredPresetStatus({ list: async () => [{ id: 'super-code', broken: 'missing tool' }] })
  assert.equal((await broken.status()).state, 'broken')
  const missing = new DeclaredPresetStatus({ list: async () => [] })
  assert.equal((await missing.status()).state, 'missing')
})

const versionedComposition = (version: string) => `- id: super-code\n  name: dsh-super-code/super-code\n  config:\n    presetVersion: ${version}\n`

test('declarative status reads the actual declaration version, including stale and broken presets', async () => {
  let version = pluginVersion, broken = ''
  const registry = new DeclaredPresetStatus({
    list: async () => [{ id: 'super-code', broken }],
    readDocument: async id => ({ agentPreset: id, content: versionedComposition(version) }),
  })
  assert.equal((await registry.status()).presetVersion, pluginVersion)
  version = '0.3.0'
  assert.equal((await registry.status()).presetVersion, '0.3.0')
  await registry.synchronize('zh')
  assert.equal((await registry.status()).presetVersion, '0.3.0', 'language synchronization cannot upgrade a composition')
  broken = 'missing tool'
  assert.equal((await registry.status()).state, 'broken')
  assert.equal((await registry.status()).presetVersion, '0.3.0')
})

test('unknown, unreadable, unrelated and missing declarations never borrow the plugin version', async () => {
  for (const content of ['[]', versionedComposition('invalid'), versionedComposition(pluginVersion).replace('dsh-super-code/super-code', 'another-plugin')]) {
    const controller = new DeclaredPresetStatus({ list: async () => [{ id: 'super-code' }],
      readDocument: async id => ({ agentPreset: id, content }) })
    assert.equal((await controller.status()).presetVersion, undefined)
  }
  const unreadable = new DeclaredPresetStatus({ list: async () => [{ id: 'super-code' }],
    readDocument: async () => { throw new Error('unavailable') } })
  assert.equal((await unreadable.status()).presetVersion, undefined)
  const wrongDocument = new DeclaredPresetStatus({ list: async () => [{ id: 'super-code' }],
    readDocument: async () => ({ agentPreset: 'another-preset', content: versionedComposition(pluginVersion) }) })
  assert.equal((await wrongDocument.status()).presetVersion, undefined)
  const missing = new DeclaredPresetStatus({ list: async () => [], readDocument: async () => { throw new Error('must not read missing preset') } })
  assert.equal((await missing.status()).state, 'missing')
  assert.equal((await missing.status()).presetVersion, undefined)
})

test('version metadata tolerates host expressions without executing them and rejects ambiguous compositions', () => {
  const expression = '!!js (() => { throw new Error("must not execute") })()'
  assert.deepEqual(compositionVersion(versionedComposition('0.2.1-alpha.1') + `- name: host-tool\n  disabled: ${expression}\n`),
    { presetVersion: '0.2.1-alpha.1' })
  for (const content of [versionedComposition(expression), versionedComposition('0.3.1') + versionedComposition('0.3.0'),
    '- name: [invalid', '{}', versionedComposition('0.3.1<script>'), versionedComposition('0.3.1').replace('config:', `config: ${expression}\n  ignored:`)]) {
    assert.deepEqual(compositionVersion(content), {})
  }
})

async function fixture(t: TestContext, options: { bundled?: boolean; writable?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-install-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'bundled'), user = join(root, 'user')
  await mkdir(join(source, 'super-code'), { recursive: true })
  await writeFile(join(source, 'super-code', 'agent.cordis.yml'), '[]\n')
  const roots: PresetRoot[] = [
    ...(options.bundled ? [{ path: source, trust: 'system' as const }] : []),
    ...(options.writable === false ? [] : [{ path: user, trust: 'user' as const }]),
  ]
  const roster = { roots, list: () => discoverPresets(roots, pathToFileURL(resolve('package.json')).href) }
  let stored = { checked: false, installedId: '' }
  let failWrites = false
  const settings = { get: () => ({ ...stored }), watch: () => () => {}, replace: async () => {},
    update: async (patch: object) => { if (failWrites) throw new Error('readonly'); stored = { ...stored, ...patch } } }
  return { root, source, user, roster, settings, create: () => new PresetInstaller(roster, settings, source), failWrites: () => { failWrites = true } }
}

test('directory installation preserves the shipped version across plugin upgrades until confirmed reinstallation', async t => {
  const f = await fixture(t), installer = f.create()
  const source = join(f.source, 'super-code', 'agent.cordis.yml')
  await writeFile(source, versionedComposition('0.3.0'))
  const installed = await installer.install('my-code', '我的模式')
  assert.equal(installed.status.pluginVersion, pluginVersion)
  assert.equal(installed.status.presetVersion, '0.3.0')
  await writeFile(source, versionedComposition(pluginVersion))
  await f.create().initialize()
  await installer.synchronize('zh')
  assert.equal((await installer.status()).presetVersion, '0.3.0')
  const reinstalled = await installer.reinstall('my-code', 'new-code', '新模式')
  assert.equal(reinstalled.ok, true)
  assert.equal(reinstalled.status.presetVersion, pluginVersion)
  assert.equal((await f.create().status()).presetVersion, pluginVersion)
  const backup = (await readdir(f.user)).find(name => name.startsWith('.super-code-backup-'))!
  assert.equal(await readFile(join(f.user, backup, 'my-code', 'agent.cordis.yml'), 'utf8'), versionedComposition('0.3.0'))
})

test('directory status reads bundled metadata but reports absent legacy versions as unknown', async t => {
  const f = await fixture(t, { bundled: true }), installer = f.create()
  assert.equal((await installer.status()).presetVersion, undefined)
  await writeFile(join(f.source, 'super-code', 'agent.cordis.yml'), versionedComposition(pluginVersion))
  assert.equal((await installer.status()).presetVersion, pluginVersion)
  assert.equal((await installer.status()).delivery, 'directory')
  await rm(f.source, { recursive: true })
  assert.equal((await installer.status()).state, 'missing')
  assert.equal((await installer.status()).presetVersion, undefined)
})

test('installs once, survives recreation, and respects user deletion until manual reinstall', async t => {
  const f = await fixture(t), installer = f.create()
  await installer.initialize()
  assert.equal((await installer.status()).state, 'installed')
  assert.equal(await readFile(join(f.user, 'super-code', 'agent.cordis.yml'), 'utf8'), '[]\n')
  await rm(join(f.user, 'super-code'), { recursive: true })
  await f.create().initialize()
  assert.equal((await installer.status()).state, 'missing')
  assert.equal((await installer.install('super-code')).ok, true)
})

test('normal web discovery needs no duplicate; same-name user preset is visible as a warning', async t => {
  const f = await fixture(t, { bundled: true }), installer = f.create()
  await installer.initialize()
  assert.equal((await installer.status()).state, 'available')
  assert.equal(f.settings.get().installedId, '')
  await mkdir(join(f.user, 'super-code'), { recursive: true })
  await writeFile(join(f.user, 'super-code', 'agent.cordis.yml'), '# user\n[]')
  assert.equal((await installer.status()).userConflict, true)
  assert.equal((await installer.install('super-code')).error, 'name-taken')
  assert.equal((await installer.install('my-super-code')).ok, true)
  assert.equal(await readFile(join(f.user, 'super-code', 'agent.cordis.yml'), 'utf8'), '# user\n[]')
})

test('existing and malformed directories and dangling symlinks are never overwritten', async t => {
  const f = await fixture(t), installer = f.create()
  await mkdir(join(f.user, 'super-code'), { recursive: true })
  await writeFile(join(f.user, 'super-code', 'notes'), 'keep')
  await installer.initialize()
  assert.equal((await installer.status()).state, 'broken')
  assert.equal((await installer.install('super-code')).error, 'name-taken')
  await symlink(join(f.root, 'absent'), join(f.user, 'linked'))
  assert.equal((await installer.install('linked')).error, 'name-taken')
  assert.equal((await installer.install('my-code')).ok, true)
  assert.equal(await readFile(join(f.user, 'super-code', 'notes'), 'utf8'), 'keep')
})

test('rejects invalid names and unavailable user roots without filesystem writes', async t => {
  const f = await fixture(t, { writable: false }), installer = f.create()
  for (const id of ['../escape', '/absolute', '', 'UPPER', 'a'.repeat(65), null, {}]) {
    assert.equal((await installer.install(id)).error, 'invalid-name')
  }
  assert.equal((await installer.install('valid')).error, 'no-user-root')
  await installer.initialize()
  assert.equal((await installer.status()).authorable, false)
  await f.settings.update({ installedId: '../../outside' })
  assert.equal((await installer.status()).id, 'super-code')
})

test('double installation has one winner; failed persistence cleans only the newly claimed copy', async t => {
  const f = await fixture(t), installer = f.create()
  const outcomes = await Promise.all([installer.install('duplicate'), installer.install('duplicate')])
  assert.deepEqual(outcomes.map(result => result.ok), [true, false])
  assert.equal(outcomes[1]?.error, 'name-taken')
  f.failWrites()
  assert.equal((await installer.install('failed')).error, 'install-failed')
  assert.deepEqual(await readdir(f.user), ['duplicate'])
})

for (const replacement of ['directory', 'symlink'] as const) test(`failed installation preserves a substituted ${replacement} during settings persistence`, async t => {
  const f = await fixture(t), target = join(f.user, 'replaced'), saved = join(f.root, 'saved-installation')
  f.settings.update = async () => {
    await rename(target, saved)
    if (replacement === 'symlink') {
      const external = join(f.root, 'external')
      await mkdir(external)
      await symlink(external, target)
    } else await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'User replacement must survive')
    throw new Error('Persistence failed after replacement')
  }
  assert.equal((await f.create().install('replaced')).error, 'install-failed')
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'User replacement must survive')
  assert.equal(await readFile(join(saved, 'agent.cordis.yml'), 'utf8'), '[]\n')
  assert.equal((await lstat(target)).isSymbolicLink(), replacement === 'symlink')
})

for (const substitution of ['missing-marker', 'wrong-token', 'copied-directory', 'symlink-marker'] as const) {
  test(`stale directory ownership cannot migrate metadata or report installed after ${substitution}`, async t => {
    const f = await fixture(t), installer = f.create()
    await writeFile(join(f.source, 'super-code', 'preset.yml'), 'name: Super Code\ndescription: A faster, more efficient, smarter coding mode.\n')
    assert.equal((await installer.install('owned')).ok, true)
    const directory = join(f.user, 'owned'), path = join(directory, 'preset.yml')
    const original = await readFile(path, 'utf8'), marker = join(directory, '.super-code-installation.json')
    if (substitution === 'missing-marker') await rm(marker)
    else if (substitution === 'wrong-token') await writeFile(marker, JSON.stringify({ plugin: 'dsh-super-code', id: 'owned', token: 'another-token' }))
    else if (substitution === 'symlink-marker') {
      await rename(marker, join(f.root, 'external-marker.json'))
      await symlink(join(f.root, 'external-marker.json'), marker)
    }
    else {
      await rename(directory, join(f.root, 'original-directory'))
      await cp(join(f.root, 'original-directory'), directory, { recursive: true })
    }
    assert.deepEqual(await installer.synchronize('zh'), { changed: false })
    assert.equal(await readFile(path, 'utf8'), original)
    assert.equal((await installer.status()).state, 'conflict')
    assert.equal((await installer.status()).userConflict, true)
  })
}

test('metadata migration revalidates ownership after asynchronous settings persistence', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.install('owned')).ok, true)
  const path = join(f.user, 'owned', 'preset.yml'), original = await readFile(path, 'utf8')
  const marker = join(f.user, 'owned', '.super-code-installation.json'), content = await readFile(marker, 'utf8')
  const update = f.settings.update
  f.settings.update = async patch => {
    if ('pendingDisplay' in patch && !('display' in patch)) await writeFile(marker, '{}')
    await update(patch)
  }
  await assert.rejects(installer.synchronize('zh'), /ownership changed/)
  assert.equal(await readFile(path, 'utf8'), original)
  f.settings.update = update
  await writeFile(marker, content)
  assert.deepEqual(await f.create().synchronize('zh'), { changed: true })
})

test('language synchronization preserves metadata replaced by a symlink during persistence', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.install('owned')).ok, true)
  const path = join(f.user, 'owned', 'preset.yml'), external = join(f.root, 'user-metadata.yml')
  const original = await readFile(path, 'utf8'), update = f.settings.update
  f.settings.update = async patch => {
    if ('pendingDisplay' in patch && !('display' in patch)) {
      await rename(path, external)
      await symlink(external, path)
    }
    await update(patch)
  }
  await assert.rejects(installer.synchronize('zh'), /metadata changed/)
  assert.equal((await lstat(path)).isSymbolicLink(), true)
  assert.equal(await readFile(external, 'utf8'), original)
  assert.equal(await readFile(path, 'utf8'), original)
  f.settings.update = update
  assert.deepEqual(await installer.synchronize('zh'), { changed: false })
  assert.equal((await lstat(path)).isSymbolicLink(), true)
  await rm(path)
  await rename(external, path)
  assert.deepEqual(await f.create().synchronize('zh'), { changed: true })
})

test('legacy identity records remain valid but a display baseline alone never establishes ownership', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.install('legacy')).ok, true)
  await f.settings.update({ installations: undefined })
  assert.equal((await f.create().status()).state, 'installed')
  assert.deepEqual(await f.create().synchronize('zh'), { changed: true })
  await f.settings.update({ installation: undefined })
  const path = join(f.user, 'legacy', 'preset.yml'), content = await readFile(path, 'utf8')
  assert.deepEqual(await f.create().synchronize('en'), { changed: false })
  assert.equal(await readFile(path, 'utf8'), content)
  assert.equal((await f.create().status()).state, 'conflict')
})

test('a substituted older copy is preserved while other recorded copies still follow language after restart', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.install('first')).ok, true)
  assert.equal((await installer.install('second')).ok, true)
  const path = join(f.user, 'first', 'preset.yml'), content = await readFile(path, 'utf8')
  await rename(join(f.user, 'first'), join(f.root, 'original-first'))
  await cp(join(f.root, 'original-first'), join(f.user, 'first'), { recursive: true })
  assert.deepEqual(await f.create().synchronize('zh'), { changed: true })
  assert.equal(await readFile(path, 'utf8'), content)
  assert.match(await readFile(join(f.user, 'second', 'preset.yml'), 'utf8'), /Super Code 模式/)
})

test('ownership supports canonical user-root aliases and ignores unavailable unrelated roots', async t => {
  const f = await fixture(t), alias = join(f.root, 'user-alias')
  await mkdir(f.user)
  await symlink(f.user, alias)
  f.roster.roots.splice(0, 1, { path: alias, trust: 'user' })
  assert.equal((await f.create().install('aliased')).ok, true)
  f.roster.roots.push({ path: join(f.root, 'missing-root'), trust: 'user' })
  assert.equal((await f.create().status()).state, 'installed')
  assert.equal((await f.create().reinstall('aliased', 'renamed')).ok, true)
  assert.equal((await f.create().status()).id, 'renamed')
})

test('a broken bundled source never creates a user copy and first-check failure does not retry', async t => {
  const f = await fixture(t), installer = f.create()
  await rm(f.source, { recursive: true })
  await installer.initialize()
  assert.equal((await installer.status()).state, 'missing')
  assert.equal(f.settings.get().checked, true)
  assert.equal((await installer.install('manual')).error, 'install-failed')
})


test('real bundled composition resolves against the host URL rather than a directory string', async t => {
  const f = await fixture(t)
  // Dependency availability belongs to the host; the tiny source keeps this
  // test standalone while still exercising a package row's URL resolution.
  await writeFile(join(f.source, 'super-code', 'agent.cordis.yml'), '- id: zod\n  name: zod\n')
  const standalone = new PresetInstaller(f.roster, f.settings, f.source, pathToFileURL(resolve('package.json')).href)
  assert.equal((await standalone.install('url-check')).ok, true)
})

test('independent installers racing for a name preserve the winning copy', async t => {
  const f = await fixture(t)
  const results = await Promise.all([f.create().install('race'), f.create().install('race')])
  assert.equal(results.filter(result => result.ok).length, 1)
  assert.equal(results.find(result => !result.ok)?.error, 'name-taken')
  assert.equal(await readFile(join(f.user, 'race', 'agent.cordis.yml'), 'utf8'), '[]\n')
  assert.deepEqual(await readdir(f.user), ['race'])
})

test('upgrades legacy fields independently and follows language without resetting user edits', async t => {
  const f = await fixture(t), installer = f.create()
  await installer.install('super-code')
  const path = join(f.user, 'super-code', 'preset.yml')
  await writeFile(path, 'name: super-code\ndescription: Coding with on-demand research, design, development, testing and optimization expertise.\norder: 17\n# keep comment\nextra: custom\n')
  await f.settings.update({ display: {} })
  assert.equal((await installer.synchronize('zh-CN')).changed, true)
  const first = await readFile(path, 'utf8')
  assert.match(first, /Super Code 模式/)
  assert.match(first, /更快、更省、更聪明的编码模式。/)
  assert.match(first, /order: 17\n# keep comment\nextra: custom/)
  assert.equal((await f.create().synchronize('zh')).changed, false)
  await writeFile(path, first.replace('Super Code 模式', 'My team'))
  await installer.synchronize('en')
  const second = await readFile(path, 'utf8')
  assert.match(second, /My team/)
  assert.match(second, /A faster, more efficient, smarter coding mode/)
  await writeFile(path, second.replace('A faster, more efficient, smarter coding mode.', 'Custom description'))
  assert.equal((await installer.synchronize('zh')).changed, false)
  assert.match(await readFile(path, 'utf8'), /My team/)
  await rm(path)
  assert.equal((await installer.synchronize('en')).changed, false)
})

const metadataLayouts = [
  { label: 'plain keys', bom: '', name: 'name: ', description: 'description: ', descriptionFirst: false },
  { label: 'BOM before name', bom: '\uFEFF', name: 'name: ', description: 'description: ', descriptionFirst: false },
  { label: 'BOM before description', bom: '\uFEFF', name: 'name: ', description: 'description: ', descriptionFirst: true },
  { label: 'quoted keys', bom: '', name: '"name": ', description: "'description': ", descriptionFirst: false },
  { label: 'spaced keys', bom: '', name: 'name \t: ', description: 'description  : ', descriptionFirst: false },
  { label: 'BOM with quoted spaced keys', bom: '\uFEFF', name: "'name' : ", description: '"description"\t: ', descriptionFirst: false },
] as const

for (const layout of metadataLayouts) for (const newline of ['\n', '\r\n']) {
  test(`directory metadata syntax: ${layout.label}, ${newline === '\n' ? 'LF' : 'CRLF'}`, async t => {
    const f = await fixture(t)
    const en = displayCopy('en'), zh = displayCopy('zh')
    await writeFile(join(f.source, 'super-code', 'preset.yml'), `name: ${en.name}\ndescription: ${en.description}\n`)
    assert.equal((await f.create().install('local-code')).ok, true)
    const path = join(f.user, 'local-code', 'preset.yml')
    const suffix = newline + 'order: 17' + newline + '# Keep custom settings' + newline
      + 'notes: |' + newline + '  name: Super Code' + newline + '  description: User text' + newline
    const content = (name: string, description: string) => layout.bom + (layout.descriptionFirst
      ? layout.description + JSON.stringify(description) + ' # Description comment' + newline + layout.name + JSON.stringify(name) + ' # Name comment'
      : layout.name + JSON.stringify(name) + ' # Name comment' + newline + layout.description + JSON.stringify(description) + ' # Description comment') + suffix
    await writeFile(path, content(en.name, en.description))
    assert.deepEqual(await f.create().synchronize('zh-CN'), { changed: true })
    assert.equal(await readFile(path, 'utf8'), content(zh.name, zh.description), 'syntax, comments and unrelated values survive')
    const row = (await f.roster.list()).find(row => row.id === 'local-code')!
    assert.equal(row.name, zh.name)
    assert.equal(row.description, zh.description)
    assert.deepEqual(await f.create().synchronize('zh'), { changed: false })
    await writeFile(path, content('My team', zh.description))
    assert.deepEqual(await f.create().synchronize('en'), { changed: true })
    assert.equal(await readFile(path, 'utf8'), content('My team', en.description))
    await writeFile(path, content('My team', 'Custom description'))
    assert.deepEqual(await f.create().synchronize('zh'), { changed: false })
    assert.equal(await readFile(path, 'utf8'), content('My team', 'Custom description'))
  })
}

const continuedMetadata = [
  ['tagged folded name', 'name: !!str >-\n  Super Code\n'],
  ['tagged literal quoted key', '"name": !!str |-\n  Super Code\n'],
  ['double-quoted continued name', 'name: "Super\n  Code"\n'],
  ['single-quoted continued name', "name: 'Super\n  Code'\n"],
  ['plain continued name', 'name: Super\n  Code\n'],
  ['value on the next line', 'name:\n  Super Code\n'],
  ['anchor', 'name: &display Super Code\n'],
  ['alias', 'template: &display Super Code\nname: *display\n'],
  ['tagged continued description', 'name: Custom\ndescription: !!str |-\n  A faster, more efficient, smarter coding mode.\n'],
] as const

for (const [label, content] of continuedMetadata) test(`directory metadata continuation: ${label}`, async t => {
  const f = await fixture(t)
  const en = displayCopy('en')
  await writeFile(join(f.source, 'super-code', 'preset.yml'), `name: ${en.name}\ndescription: ${en.description}\n`)
  assert.equal((await f.create().install('local-code')).ok, true)
  const path = join(f.user, 'local-code', 'preset.yml')
  const before = content.includes('description:') ? content : content + 'description: Custom\n'
  await writeFile(path, before)
  const row = (await f.roster.list()).find(row => row.id === 'local-code')!
  assert.equal(row.broken, undefined, 'the original file is valid metadata')
  assert.equal(content.includes('description:') ? row.description : row.name, content.includes('description:') ? en.description : en.name)
  const result = await f.create().synchronize('zh')
  assert.equal(await readFile(path, 'utf8'), before, 'multiline scalar bodies and shared aliases must remain untouched')
  assert.deepEqual(result, { changed: false })
})

for (const field of ['name', 'description'] as const) for (const layout of ['flow', 'explicit-key', 'ordinary-key']) {
  for (const quote of ["'", '"']) test(`directory metadata structural boundary: ${field}, ${layout}, ${quote === "'" ? 'single' : 'double'} quoted notes`, async t => {
    const f = await fixture(t), en = displayCopy('en')
    await writeFile(join(f.source, 'super-code', 'preset.yml'), `name: ${en.name}\ndescription: ${en.description}\n`)
    assert.equal((await f.create().install('local-code')).ok, true)
    const value = en[field], other = field === 'name' ? 'description' : 'name'
    const notes = `notes: ${quote}User-owned notes\n${field}: ${value}\nKeep this text${quote}`
    const before = layout === 'flow' ? `{${field}: ${JSON.stringify(value)}, ${other}: Custom, ${notes}}\n`
      : `${layout === 'explicit-key' ? `? ${field}\n: ` : field + ': '}${JSON.stringify(value)}\n${other}: Custom\n${notes}\n`
    const path = join(f.user, 'local-code', 'preset.yml')
    await writeFile(path, before)
    const row = (await f.roster.list()).find(row => row.id === 'local-code')!
    assert.equal(row[field], value, 'host discovery reads the real root field')
    assert.equal(row.broken, undefined)
    const result = await f.create().synchronize('zh')
    assert.equal(await readFile(path, 'utf8'), before, 'never treat prose inside a multiline value as a root key')
    assert.deepEqual(result, { changed: false })
    assert.equal((await f.roster.list()).find(row => row.id === 'local-code')?.[field], value)
  })
}

for (const field of ['name', 'description'] as const) for (const style of ['continued', 'shared-anchor']) {
  test(`directory metadata independent fields: ${field}, ${style}`, async t => {
    const f = await fixture(t), en = displayCopy('en'), zh = displayCopy('zh')
    await writeFile(join(f.source, 'super-code', 'preset.yml'), `name: ${en.name}\ndescription: ${en.description}\n`)
    assert.equal((await f.create().install('local-code')).ok, true)
    const other = field === 'name' ? 'description' : 'name'
    const protectedText = style === 'continued'
      ? `${field}: "${en[field].replace(' ', '\n  ')}"\n`
      : `${field}: !!str &display ${en[field]}\nnotes: *display\n`
    const content = (copy: string) => protectedText + `${other}: ${JSON.stringify(copy)} # Keep comment\norder: 17\n`
    const path = join(f.user, 'local-code', 'preset.yml')
    await writeFile(path, content(en[other]))
    for (const [language, copy] of [['zh', zh], ['en', en]] as const) {
      assert.deepEqual(await f.create().synchronize(language), { changed: true })
      assert.equal(await readFile(path, 'utf8'), content(copy[other]))
      const row = (await f.roster.list()).find(row => row.id === 'local-code')!
      assert.equal(row.broken, undefined)
      assert.equal(row[field], en[field], 'protected field stays intact while its sibling follows language')
      assert.equal(row[other], copy[other])
      assert.deepEqual(await f.create().synchronize(language), { changed: false })
    }
  })
}

test('custom install name stays custom and earlier owned copies remain managed', async t => {
  const f = await fixture(t), installer = f.create()
  await writeFile(join(f.source, 'super-code', 'preset.yml'), 'name: Super Code\ndescription: A faster, more efficient, smarter coding mode.\n')
  await installer.install('first', 'My team')
  await installer.install('second')
  await installer.synchronize('zh')
  assert.match(await readFile(join(f.user, 'first', 'preset.yml'), 'utf8'), /My team/)
  assert.match(await readFile(join(f.user, 'first', 'preset.yml'), 'utf8'), /更快、更省、更聪明/)
  assert.match(await readFile(join(f.user, 'second', 'preset.yml'), 'utf8'), /Super Code 模式/)
})

test('unowned presets and symbolic metadata are not migrated', async t => {
  const f = await fixture(t), installer = f.create()
  await mkdir(join(f.user, 'super-code'), { recursive: true })
  await writeFile(join(f.user, 'super-code', 'agent.cordis.yml'), '[]\n')
  const external = join(f.root, 'external.yml')
  await writeFile(external, 'name: super-code\n')
  await symlink(external, join(f.user, 'super-code', 'preset.yml'))
  assert.equal((await installer.synchronize('zh')).changed, false)
  await f.settings.update({ installedId: 'super-code' })
  assert.equal((await installer.synchronize('zh')).changed, false)
  assert.equal(await readFile(external, 'utf8'), 'name: super-code\n')
})

test('migration persistence failure leaves metadata unchanged and interrupted finalization recovers', async t => {
  const f = await fixture(t), installer = f.create()
  await writeFile(join(f.source, 'super-code', 'preset.yml'), 'name: Super Code\ndescription: A faster, more efficient, smarter coding mode.\n')
  await installer.install('super-code')
  const path = join(f.user, 'super-code', 'preset.yml'), before = await readFile(path, 'utf8')
  const update = f.settings.update
  f.settings.update = async patch => { if ('pendingDisplay' in patch && !('display' in patch)) throw new Error('disk full'); await update(patch) }
  await assert.rejects(installer.synchronize('zh'), /disk full/)
  assert.equal(await readFile(path, 'utf8'), before)
  f.settings.update = async patch => { if ('display' in patch) throw new Error('finalization failed'); await update(patch) }
  await assert.rejects(installer.synchronize('zh'), /finalization failed/)
  assert.match(await readFile(path, 'utf8'), /Super Code 模式/)
  f.settings.update = update
  await f.create().synchronize('en')
  assert.match(await readFile(path, 'utf8'), /A faster, more efficient, smarter coding mode/)
  await installer.synchronize('zh')
  assert.match(await readFile(path, 'utf8'), /Super Code 模式/)
})

test('bundled presets synchronize without a writable user root or host locale patches', async t => {
  const f = await fixture(t, { bundled: true, writable: false })
  const path = join(f.source, 'super-code', 'preset.yml')
  await writeFile(path, 'name: Super Code\ndescription: A faster, more efficient, smarter coding mode.\n')
  await f.create().initialize()
  assert.equal((await f.create().synchronize('zh')).changed, true)
  const row = (await f.roster.list()).find(preset => preset.id === 'super-code')!
  assert.equal(row.name, 'Super Code 模式')
  assert.equal(row.description, '更快、更省、更聪明的编码模式。')
  assert.equal((await f.create().synchronize('zh')).changed, false)
  assert.equal((await f.create().synchronize('en')).changed, true)
})


test('display names accept Chinese and spaces independently of directory identifiers', async t => {
  const f = await fixture(t), installer = f.create()
  for (const [id, name] of [['chinese', 'Super Code 模式'], ['spaces', 'My coding mode'], ['limit', '中'.repeat(120)]]) {
    assert.equal((await installer.install(id, name)).ok, true)
    assert.equal((await f.roster.list()).find(row => row.id === id)?.name, name)
  }
  await installer.synchronize('en')
  assert.equal((await f.roster.list()).find(row => row.id === 'chinese')?.name, 'Super Code 模式')
  for (const name of ['', '   ', '中'.repeat(121)]) {
    assert.equal((await installer.install('invalid-display', name)).error, 'invalid-display-name')
  }
  assert.equal((await installer.install('Super Code 模式', 'Valid display')).error, 'invalid-name')
  assert.deepEqual((await readdir(f.user)).sort(), ['chinese', 'limit', 'spaces'])
})

test('reinstall verifies ownership, replaces the old preset under the new name and keeps recovery data', async t => {
  const f = await fixture(t), installer = f.create()
  assert.equal((await installer.install('original')).ok, true)
  await writeFile(join(f.user, 'original', 'custom.txt'), 'recover me')
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) await writeFile(join(f.user, 'original', name), 'OS metadata')
  const oldMarker = await readFile(join(f.user, 'original', '.super-code-installation.json'), 'utf8')
  assert.equal((await installer.reinstall('original', 'renamed', '新的 Super Code 模式')).ok, true)
  assert.equal((await installer.status()).name, '新的 Super Code 模式')
  const rows = await f.roster.list()
  assert.equal(rows.some(row => row.id === 'original'), false)
  assert.equal(rows.find(row => row.id === 'renamed')?.name, '新的 Super Code 模式')
  assert.notEqual(await readFile(join(f.user, 'renamed', '.super-code-installation.json'), 'utf8'), oldMarker)
  const backup = (await readdir(f.user)).find(name => name.startsWith('.super-code-backup-'))!
  assert.equal(await readFile(join(f.user, backup, 'original', 'custom.txt'), 'utf8'), 'recover me')
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) assert.equal(await readFile(join(f.user, backup, 'original', name), 'utf8'), 'OS metadata')
  assert.equal((await installer.reinstall('original', 'stale')).error, 'ownership-unverified')
  assert.equal((await installer.reinstall('renamed', 'renamed', '同一标识符新名称')).ok, true)
  assert.equal((await f.roster.list()).find(row => row.id === 'renamed')?.name, '同一标识符新名称')
})

test('reinstall refuses legacy ownership, changed markers and substituted directories', async t => {
  const f = await fixture(t), installer = f.create()
  await mkdir(join(f.user, 'legacy'), { recursive: true })
  await writeFile(join(f.user, 'legacy', 'agent.cordis.yml'), '[]')
  await f.settings.update({ installedId: 'legacy' })
  assert.equal((await installer.reinstall('legacy', 'new')).error, 'ownership-unverified')
  assert.equal((await installer.install('owned')).ok, true)
  const marker = join(f.user, 'owned', '.super-code-installation.json')
  const content = await readFile(marker, 'utf8')
  await writeFile(marker, '{}')
  assert.equal((await installer.reinstall('owned', 'new')).error, 'ownership-unverified')
  await writeFile(marker, content)
  // Copying the UUID to a different directory must not establish ownership.
  const { rename, cp } = await import('node:fs/promises')
  await rename(join(f.user, 'owned'), join(f.root, 'saved'))
  await cp(join(f.root, 'saved'), join(f.user, 'owned'), { recursive: true })
  assert.equal((await installer.reinstall('owned', 'new')).error, 'ownership-unverified')
  await rm(join(f.user, 'owned'), { recursive: true })
  await symlink(join(f.root, 'saved'), join(f.user, 'owned'))
  assert.equal((await installer.reinstall('owned', 'new')).error, 'ownership-unverified')
  assert.equal(await readFile(join(f.root, 'saved', 'agent.cordis.yml'), 'utf8'), '[]\n')
})

test('reinstall preserves the old preset on conflicts and rolls back failed persistence', async t => {
  const f = await fixture(t), installer = f.create()
  await installer.install('original')
  await mkdir(join(f.user, 'other'))
  await writeFile(join(f.user, 'other', 'agent.cordis.yml'), '[]')
  assert.equal((await installer.reinstall('original', 'other')).error, 'name-taken')
  assert.equal((await installer.reinstall('original', '../escape')).error, 'invalid-name')
  assert.equal((await installer.reinstall('original', 'new', '  ')).error, 'invalid-display-name')
  f.failWrites()
  assert.equal((await installer.reinstall('original', 'new')).error, 'install-failed')
  assert.equal(f.settings.get().installedId, 'original')
  assert.equal((await installer.status()).state, 'installed')
  assert.deepEqual((await readdir(f.user)).sort(), ['original', 'other'])
  assert.equal((await installer.reinstall('original', 'original')).error, 'install-failed')
  assert.equal(await readFile(join(f.user, 'original', 'agent.cordis.yml'), 'utf8'), '[]\n')
})

for (const id of ['original', 'renamed']) test(`failed backup verification restores the old preset before reinstalling as ${id}`, async t => {
  const f = await fixture(t), installer = f.create(), original = join(f.user, 'original')
  assert.equal((await installer.install('original')).ok, true)
  await writeFile(join(original, 'custom.txt'), 'Keep user changes')
  const identity = await lstat(original), marker = await readFile(join(original, '.super-code-installation.json'), 'utf8')
  const settings = structuredClone(f.settings.get()), inspect = fs.lstat
  let injected = false
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof inspect>) => {
    if (!injected && basename(String(args[0])) === 'original' && basename(dirname(String(args[0]))).startsWith('.super-code-backup-')) {
      injected = true
      throw new Error('Fixture: backup metadata temporarily unavailable')
    }
    return inspect(...args)
  })
  syncBuiltinESMExports()
  let result
  try { result = await installer.reinstall('original', id) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.ok(injected)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'ownership-unverified')
  assert.equal(result.status.state, 'installed')
  assert.deepEqual(f.settings.get(), settings)
  assert.equal((await lstat(original)).ino, identity.ino)
  assert.equal(await readFile(join(original, '.super-code-installation.json'), 'utf8'), marker)
  assert.equal(await readFile(join(original, 'custom.txt'), 'utf8'), 'Keep user changes')
  assert.deepEqual(await readdir(f.user), ['original'])
  assert.equal((await f.create().reinstall('original', id)).ok, true)
})

for (const replacement of ['directory', 'symlink'] as const) test(`failed backup verification preserves a replacement ${replacement} and the old recovery copy`, async t => {
  const f = await fixture(t), installer = f.create(), original = join(f.user, 'original')
  assert.equal((await installer.install('original')).ok, true)
  await writeFile(join(original, 'custom.txt'), 'Keep old preset')
  const settings = structuredClone(f.settings.get()), inspect = fs.lstat
  let injected = false
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof inspect>) => {
    if (!injected && basename(String(args[0])) === 'original' && basename(dirname(String(args[0]))).startsWith('.super-code-backup-')) {
      injected = true
      if (replacement === 'directory') await mkdir(original)
      else {
        const external = join(f.root, 'external')
        await mkdir(external)
        await symlink(external, original)
      }
      await writeFile(join(original, 'keep.txt'), 'Keep replacement')
      throw new Error('Fixture: backup verification failed after replacement')
    }
    return inspect(...args)
  })
  syncBuiltinESMExports()
  try { assert.equal((await installer.reinstall('original', 'renamed')).error, 'ownership-unverified') }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.ok(injected)
  assert.deepEqual(f.settings.get(), settings)
  assert.equal(await readFile(join(original, 'keep.txt'), 'utf8'), 'Keep replacement')
  assert.equal((await lstat(original)).isSymbolicLink(), replacement === 'symlink')
  const backup = (await readdir(f.user)).find(name => name.startsWith('.super-code-backup-'))!
  assert.equal(await readFile(join(f.user, backup, 'original', 'custom.txt'), 'utf8'), 'Keep old preset')
  assert.equal((await installer.status()).userConflict, true)
})
