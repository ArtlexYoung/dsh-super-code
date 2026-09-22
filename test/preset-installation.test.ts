import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverPresets, type PresetRoot } from '@deepseek-ai/dsh-agent-presets'
import { PresetInstaller } from '../src/dsh/preset-installation.js'

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
