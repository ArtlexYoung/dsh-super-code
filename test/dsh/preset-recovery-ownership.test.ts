import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { prepareRecovery } from '../../src/dsh/preset-recovery.js'

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-recovery-ownership-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'cordis.patch.yml'), packagePath = join(root, 'package.json')
  const prepare = (version = 'first') => prepareRecovery(path, packagePath, `export const name = "${version}";`)
  const first = await prepare()
  const original = yaml.load(await readFile(path, 'utf8')) as any[]
  const entry = original[0].insert[0]
  const write = async (rows: unknown[]) => {
    const content = '# Keep this profile comment\n' + yaml.dump(rows)
    await writeFile(path, content)
    return content
  }
  return { first, entry, original, path, prepare, write }
}

test('an already disabled owned recovery entry can be upgraded and reactivated without duplicate retirement', async t => {
  const f = await fixture(t)
  const original = await f.write([...f.original, { id: f.entry.id, disabled: true }])
  const updated = await f.prepare('second')
  const upgraded = await readFile(f.path, 'utf8')
  assert.ok(upgraded.startsWith(original))
  const rows = yaml.load(upgraded) as any[]
  assert.equal(rows.length, 3, 'the previous entry is already disabled')
  assert.equal(rows.at(-1).insert[0].name, pathToFileURL(updated.modulePath).href)
  assert.equal((await f.prepare()).modulePath, f.first.modulePath)
  const restored = await readFile(f.path, 'utf8')
  assert.ok(restored.startsWith(upgraded))
  const [retired, activated] = (yaml.load(restored) as any[]).slice(-2)
  assert.equal(retired.disabled, true)
  assert.deepEqual(activated, { ...f.entry, disabled: false })
  await f.prepare()
  assert.equal(await readFile(f.path, 'utf8'), restored)
})

test('a mismatching name in an override cannot change recovery ownership or enabled state', async t => {
  const f = await fixture(t)
  const original = await f.write([...f.original, { id: f.entry.id, name: 'other-plugin', disabled: true }])
  assert.equal((await f.prepare()).modulePath, f.first.modulePath)
  assert.equal(await readFile(f.path, 'utf8'), original)
})

test('an ID inside ordinary plugin configuration is data rather than a Loader entry', async t => {
  const f = await fixture(t), other = { id: 'other', name: 'other-plugin', config: [] }
  const original = await f.write([...f.original, { insert: [other] }, { id: other.id, config: [{ id: f.entry.id }] }])
  await f.prepare('second')
  assert.ok((await readFile(f.path, 'utf8')).startsWith(original))
})

for (const conflict of ['older generation replaced by another module', 'nested group entry', 'duplicate entry', 'foreign config override'] as const) {
  test(`refuses a recovery ID conflict from a ${conflict} without modifying the profile`, async t => {
    const f = await fixture(t), foreign = { ...f.entry, name: 'other-plugin' }
    const rows = conflict === 'older generation replaced by another module' ? [{ insert: [foreign] }]
      : conflict === 'nested group entry' ? [...f.original, { insert: [{ id: 'user-group', group: true, config: [foreign] }] }]
        : conflict === 'duplicate entry' ? [...f.original, { insert: [f.entry] }]
          : [...f.original, { id: f.entry.id, config: { owner: 'another-plugin', statePath: f.first.config.statePath } }]
    const original = await f.write(rows)
    await assert.rejects(f.prepare('second'), /Recovery entry conflict/)
    assert.equal(await readFile(f.path, 'utf8'), original)
  })
}
