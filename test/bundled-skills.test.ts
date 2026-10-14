import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { declarationSchema } from '../src/dsh/preset-declaration.js'
import { PresetInstaller } from '../src/dsh/preset-installation.js'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'

const presetRoot = fileURLToPath(new URL('../presets/', import.meta.url))
const skillName = 'super-code-frontend'
type Row = { id: string; name: string; config?: Record<string, unknown> }
const parse = (content: string) => yaml.load(content, { schema: declarationSchema }) as Row[]

function bundledConfig(rows: Row[], baseUrl: string): Record<string, unknown> {
  const original = rows.find(row => row.id === 'skill-filesystem')!
  assert.equal(original.name, '@deepseek-ai/dsh-skill-filesystem')
  assert.equal(original.config, undefined, 'existing project/user discovery is preserved')
  const bundled = rows.find(row => row.id === 'skill-super-code-bundled')!
  const config = interpolate({ baseUrl }, bundled.config) as Record<string, unknown>
  assert.equal(config.providerName, 'super-code-bundled')
  assert.equal(config.includeDefaultRoots, false)
  assert.equal(config.watch, false)
  return config
}

async function verifySkillResources(root: string): Promise<string> {
  const directory = join(root, skillName)
  const content = await readFile(join(directory, 'SKILL.md'), 'utf8')
  const frontmatter = yaml.load(content.split('---')[1]!) as { name: string; description: string }
  assert.equal(frontmatter.name, skillName)
  assert.ok(frontmatter.description.length > 0)
  const references = [...content.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]!)
  assert.equal(new Set(references).size, 3)
  for (const reference of references) assert.ok((await readFile(join(directory, reference), 'utf8')).length > 0)
  return content
}

test('directory install and renamed reinstall carry loadable skill resources with the preset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-skills-'))
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
    assert.equal(await verifySkillResources(config.bundledSkillDir as string),
      await verifySkillResources(join(presetRoot, 'super-code', 'skills')))
    if (id === 'frontend-copy') assert.equal((await installer.reinstall(id, 'frontend-renamed')).ok, true)
  }
})

test('declarative skills resolve from the installed package after persistence in a relocated profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-skill-declaration-'))
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
