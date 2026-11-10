import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { declarationSchema } from '../src/dsh/preset-declaration.js'
import { PresetInstaller } from '../src/dsh/preset-installation.js'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'

const presetRoot = fileURLToPath(new URL('../presets/', import.meta.url))
const skillName = 'oil-ui'
const validationRoot = fileURLToPath(new URL('../../source/validation/dsh-super-code/preset-skills-20261110/tmp/', import.meta.url))
async function temporary(prefix: string) {
  await mkdir(validationRoot, { recursive: true })
  return mkdtemp(join(validationRoot, prefix))
}
type Row = { id: string; name: string; config?: Record<string, unknown> }
const parse = (content: string) => yaml.load(content, { schema: declarationSchema }) as Row[]

function bundledConfig(rows: Row[], baseUrl: string): Record<string, unknown> {
  const original = rows.find(row => row.id === 'skill-filesystem')!
  assert.equal(original.name, '@deepseek-ai/dsh-skill-filesystem')
  assert.equal(original.config, undefined, 'existing project/user discovery is preserved')
  const bundled = rows.find(row => row.id === 'skill-super-code-bundled')!
  assert.equal(bundled.name, 'dsh-super-code/skills')
  const config = interpolate({ baseUrl }, bundled.config) as Record<string, unknown>
  assert.deepEqual(Object.keys(config), ['bundledSkillDir'])
  return config
}

async function resourceSnapshot(directory: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    assert.equal(entry.isSymbolicLink(), false, path)
    if (entry.isDirectory()) Object.assign(files, await resourceSnapshot(directory, path))
    else files[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex')
  }
  return files
}

async function verifySkillResources(root: string): Promise<Record<string, string>> {
  assert.equal((await readdir(root)).includes('super-code-frontend'), false, 'legacy skill is retired')
  const directory = join(root, skillName)
  const content = await readFile(join(directory, 'SKILL.md'), 'utf8')
  const frontmatter = yaml.load(content.split('---')[1]!) as {
    name: string; description: string; metadata: { version: string }
  }
  assert.equal(frontmatter.name, skillName)
  assert.ok(frontmatter.description.length > 0)
  assert.equal(frontmatter.metadata.version, '0.32.0')
  const files = await resourceSnapshot(directory)
  for (const path of ['LICENSE', 'UPSTREAM.md', 'assets/style-explorer.html', 'assets/logo.png',
    'assets/fonts/instrument-serif/InstrumentSerif-Regular.ttf', 'assets/fonts/instrument-serif/OFL.txt',
    'scripts/build_explorer.py', 'scripts/shoot.mjs', 'scripts/chrome.mjs']) assert.ok(files[path], path)
  assert.equal(files['scripts/check_update.py'], undefined, 'bundled skills update with the plugin')
  assert.equal(files['scripts/check_update.sh'], undefined)
  // Resolve references transitively, including ../ links from references and script imports.
  for (const path of Object.keys(files)) {
    if (!/\.(md|mjs)$/.test(path)) continue
    const text = await readFile(join(directory, path), 'utf8')
    const links = path.endsWith('.md') ? [...text.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]!)
      : [...text.matchAll(/from ["'](\.[^"']+)["']/g)].map(match => match[1]!)
    for (const link of links) {
      if (/^(?:[a-z]+:|#)/i.test(link)) continue
      const target = resolve(directory, dirname(path), link.split('#')[0]!)
      assert.ok((await readFile(target)).byteLength > 0, `${path}: ${link}`)
    }
  }
  for (const pack of ['mattpocock', 'openspec']) {
    const base = resolve(root, '../skill-packs', pack)
    const distribution = JSON.parse(await readFile(join(base, 'distribution.json'), 'utf8'))
    assert.equal(distribution.skills.length, pack === 'mattpocock' ? 27 : 12)
    assert.ok((await readFile(join(base, 'LICENSE'), 'utf8')).includes('MIT License'))
    const resources = await resourceSnapshot(base)
    for (const entry of Object.values(distribution.files) as Array<{path: string; sha256: string}>) {
      assert.equal(resources[entry.path], entry.sha256, `${pack}/${entry.path}`)
    }
    for (const name of distribution.skills) assert.ok(resources[`skills/${name}/SKILL.md`], name)
    for (const [name, hash] of Object.entries(resources)) files[`../skill-packs/${pack}/${name}`] = hash
  }
  return files
}

test('directory install and renamed reinstall carry loadable skill resources with the preset', async t => {
  const root = await temporary('super-code-skills-')
  t.after(() => rm(root, { recursive: true, force: true }))
  const user = join(root, 'user'), roots = [{ path: user, trust: 'user' as const }]
  const roster = { roots, list: () => discoverPresets(roots, pathToFileURL(join(root, 'package.json')).href) }
  let stored = { checked: false, installedId: '' }
  const settings = { get: () => ({ ...stored }), watch: () => () => {}, replace: async () => {},
    update: async (patch: object) => { stored = { ...stored, ...patch } } }
  const installer = new PresetInstaller(roster, settings, presetRoot)
  assert.equal((await installer.install('frontend-copy')).ok, true)
  for (const id of ['frontend-copy', 'frontend-renamed']) {
    const directory = join(user, id)
    const rows = parse(await readFile(join(directory, 'agent.cordis.yml'), 'utf8'))
    const config = bundledConfig(rows, pathToFileURL(directory + '/').href)
    assert.equal(config.bundledSkillDir, join(directory, 'skills/'))
    assert.deepEqual(await verifySkillResources(config.bundledSkillDir as string),
      await verifySkillResources(join(presetRoot, 'super-code', 'skills')))
    const loader = rows.find(row => row.id === 'skill-super-code-bundled')!
    await writeFile(join(directory, 'agent.cordis.yml'), yaml.dump(rows.map(row => row === loader ? { ...row, disabled: true } : row), { schema: declarationSchema }))
    assert.equal((await installer.status()).skillPacks, undefined, 'directory status follows the disabled loader')
    await writeFile(join(directory, 'agent.cordis.yml'), yaml.dump(rows, { schema: declarationSchema }))
    assert.equal((await installer.status()).skillPacks, true)
    if (id === 'frontend-copy') {
      const legacy = join(directory, 'skills/super-code-frontend')
      await mkdir(legacy)
      await writeFile(join(legacy, 'SKILL.md'), 'Legacy skill with user customizations')
      assert.equal((await installer.reinstall(id, 'frontend-renamed')).ok, true)
      const backup = (await readdir(user)).find(name => name.startsWith('.super-code-backup-'))!
      assert.equal(await readFile(join(user, backup, id, 'skills/super-code-frontend/SKILL.md'), 'utf8'),
        'Legacy skill with user customizations', 'reinstallation preserves a recovery copy')
    }
  }
})

test('declarative skills resolve from the installed package after persistence in a relocated profile', async t => {
  const root = await temporary('super-code-skill-declaration-')
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = join(root, 'unrelated-profile'), packageRoot = join(profile, 'node_modules/dsh-super-code')
  await mkdir(packageRoot, { recursive: true })
  await cp(new URL('../package.json', import.meta.url), join(packageRoot, 'package.json'))
  await cp(presetRoot, join(packageRoot, 'presets'), { recursive: true })
  const bundle = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'),
    { schema: declarationSchema }) as Array<{ insert?: Array<{ config: { plugins: Row[] } }> }>
  const rows = bundle[0]!.insert![0]!.config.plugins
  const persisted = parse(yaml.dump(rows, { schema: declarationSchema }))
  const config = bundledConfig(persisted, pathToFileURL(profile + '/').href)
  assert.equal(config.bundledSkillDir, await realpath(join(packageRoot, 'presets/super-code/skills')))
  await verifySkillResources(config.bundledSkillDir as string)
})
