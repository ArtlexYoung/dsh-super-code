import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { displayCopy } from '../src/dsh/preset-metadata.js'
import { compositionVersion, pluginVersion } from '../src/dsh/preset-version.js'
import yaml from 'js-yaml'

const require = createRequire(import.meta.url)

test('host metadata resolves both languages for the root and every plugin subpath', () => {
  for (const plugin of ['dsh-super-code', 'dsh-super-code/dsh', 'dsh-super-code/super-code']) {
    for (const language of ['en', 'zh']) {
      // Hosts resolve resources without evaluating the plugin entry or importing JSON.
      const file = require.resolve(`${plugin}/locale/${language}.json`)
      const { meta } = JSON.parse(readFileSync(file, 'utf8'))
      const copy = displayCopy(language)
      assert.deepEqual(meta, { title: copy.name, description: copy.description })
    }
  }
})

test('both shipped preset mechanisms record the package version', () => {
  const directory = readFileSync(new URL('../presets/super-code/agent.cordis.yml', import.meta.url), 'utf8')
  assert.deepEqual(compositionVersion(directory), { presetVersion: pluginVersion })
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: () => ({}) }))
  const patch = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema }) as any[]
  const declaration = patch.flatMap(row => row.insert).find(row => row.id === 'preset-super-code')
  assert.deepEqual(compositionVersion(yaml.dump(declaration.config.plugins)), { presetVersion: pluginVersion })
})
