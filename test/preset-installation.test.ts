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
  const oldMarker = await readFile(join(f.user, 'original', '.super-code-installation.json'), 'utf8')
  assert.equal((await installer.reinstall('original', 'renamed', '新的 Super Code 模式')).ok, true)
  assert.equal((await installer.status()).name, '新的 Super Code 模式')
  const rows = await f.roster.list()
  assert.equal(rows.some(row => row.id === 'original'), false)
  assert.equal(rows.find(row => row.id === 'renamed')?.name, '新的 Super Code 模式')
  assert.notEqual(await readFile(join(f.user, 'renamed', '.super-code-installation.json'), 'utf8'), oldMarker)
  const backup = (await readdir(f.user)).find(name => name.startsWith('.super-code-backup-'))!
  assert.equal(await readFile(join(f.user, backup, 'original', 'custom.txt'), 'utf8'), 'recover me')
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
