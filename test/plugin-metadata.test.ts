import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { displayCopy } from '../src/dsh/preset-metadata.js'

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
