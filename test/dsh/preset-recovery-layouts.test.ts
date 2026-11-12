import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { declarationSchema } from '../../src/dsh/preset-declaration.js'
import { prepareRecovery } from '../../src/dsh/preset-recovery.js'

const user = { insert: [{ id: 'user-entry', name: 'user-plugin', config: {
  note: 'Keep my configuration', deferred: { __jsExpr: 'env.USER_VALUE' },
} }] }
const encode = (value: unknown) => yaml.dump(value, { schema: declarationSchema, noRefs: true, lineWidth: -1 })
const scalarPatch = '- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        date: 2026-11-11\n        timestamp: 2026-11-11T22:30:00+08:00\n        <<: {label: literal}\n        nested: [{date: 2026-11-11}]\n        deferred: !!js env.USER_VALUE\n'
const layouts = [
  { label: 'anchored block list with host scalar strings', content: '&profile\n' + scalarPatch },
  { label: 'ordinary block list with host scalar strings', content: scalarPatch },
  { label: 'flow list with host scalar strings', content: '[{insert: [{id: user-entry, name: user-plugin, config: {date: 2026-11-11, timestamp: 2026-11-11T22:30:00+08:00, <<: {label: literal}, nested: [{date: 2026-11-11}], deferred: !!js env.USER_VALUE}}]}]\n' },
  { label: 'spaced empty list', content: '# Before\n[ ]\n# After\n' },
  { label: 'multiline empty list', content: '# Before\n[\n  # Empty\n]\n# After\n' },
  { label: 'empty document with end marker', content: '# Before\n---\n[]\n... # End\n# After\n' },
  { label: 'block document with end marker', content: '# Before\n---\n' + encode([user]) + '# Keep block comment\n... # End\n# After\n' },
  { label: 'flow list with a quoted line starting with hyphen', content: '# Before\n[{insert: [{id: user-entry, name: user-plugin, config: {note: "Keep\n- this text"}}]}]\n# After\n' },
  { label: 'ordinary block list', content: '# Before\n' + encode([user]) + '# Keep block comment\n# After\n' },
  { label: 'nonempty flow list', content: '# Before\n' + yaml.dump([user], { schema: declarationSchema, flowLevel: 0 }) + '# After\n' },
  { label: 'inline document header', content: '# Before\n--- [ ]\n... # End\n# After\n' },
  { label: 'indented block list', content: '# Before\n' + encode([user]).replace(/^(?=.)/gm, '  ') + '# Keep block comment\n# After\n' },
  { label: 'anchored block document', content: '# Before\n---\n&patch\n' + encode([user]) + '... # End\n# After\n' },
  { label: 'BOM-prefixed CRLF document', content: '\uFEFF# Before\r\n---\r\n' + encode([user]).replace(/\n/g, '\r\n') + '... # End\r\n# After\r\n' },
  { label: 'BOM-prefixed empty list', content: '\uFEFF# Before\r\n[ ] # After\r\n' },
  { label: 'BOM-prefixed list without final whitespace', content: '\uFEFF[]' },
  { label: 'BOM-prefixed blank file', content: '\uFEFF  \r\n' },
  { label: 'BOM-prefixed first-line block list', content: '\uFEFF' + encode([user]) },
  { label: 'BOM-prefixed first-line block list without final newline', content: '\uFEFF' + encode([user]).trimEnd() },
  { label: 'BOM-prefixed indented first-line CRLF block list', content: '\uFEFF' + encode([user]).replace(/^(?=.)/gm, '  ').replace(/\n/g, '\r\n') },
  { label: 'YAML directives', content: '# Before\n%YAML 1.2\n---\n' + encode([user]) + '... # End\n# After\n' },
  { label: 'inline trailing comment', content: '# Before\n[ ] # After\n' },
  { label: 'literal scalar with trailing blank lines', content: '# Before\n- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        note: |+\n          Keep trailing blank lines\n\n\n' },
  { label: 'literal scalar with final spaces', content: '# Before\n- insert:\n    - id: user-entry\n      name: user-plugin\n      config:\n        note: |-\n          Keep final spaces   ' },
]

for (const layout of layouts) test(`recovery setup and upgrade preserve ${layout.label}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-recovery-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'cordis.patch.yml'), packagePath = join(root, 'package.json')
  const originalRows = layout.content.trim() ? yaml.load(layout.content, { schema: declarationSchema }) as unknown[] : []
  await writeFile(path, layout.content)
  const source = 'export const name = "fixture";'
  const first = await prepareRecovery(path, packagePath, source)
  const installed = await readFile(path, 'utf8')
  assert.equal(await readFile(first.modulePath, 'utf8'), source)
  const assertPatch = (content: string, modulePath: string, addedRows: number) => {
    if (layout.content.startsWith('\uFEFF-') || layout.content.startsWith('\uFEFF  -')) assert.equal(content.split('\uFEFF').length, 2, 'only the original file header contains BOM')
    const rows = yaml.load(content, { schema: declarationSchema }) as any[]
    assert.deepEqual(rows.slice(0, originalRows.length), originalRows, 'unrelated configuration retains its meaning')
    const nativeBefore = layout.content.trim() ? yaml.load(layout.content, { schema: entryListSchema }) as unknown[] : []
    assert.deepEqual((yaml.load(content, { schema: entryListSchema }) as unknown[]).slice(0, nativeBefore.length), nativeBefore, 'preserve the host YAML values, including date strings and literal merge keys')
    assert.equal(rows.length, originalRows.length + addedRows)
    const entry = rows.at(-1).insert?.[0] ?? rows.at(-1)
    assert.equal(entry.id, 'super-code-session-recovery-' + basename(modulePath, '.mjs').slice('recovery-'.length))
    assert.equal(entry.name, pathToFileURL(modulePath).href)
    assert.deepEqual(entry.config, { owner: 'dsh-super-code', statePath: first.config.statePath, packagePath })
    for (const comment of ['# Before', '# After', '# Keep block comment', '... # End', '%YAML 1.2']) {
      if (layout.content.includes(comment)) assert.ok(content.includes(comment), `preserves ${comment}`)
    }
  }
  assertPatch(installed, first.modulePath, 1)
  await prepareRecovery(path, packagePath, source)
  assert.equal(await readFile(path, 'utf8'), installed, 'a same-generation retry writes no patch')
  const second = await prepareRecovery(path, packagePath, 'export const name = "updated";')
  const upgraded = await readFile(path, 'utf8')
  assertPatch(upgraded, second.modulePath, 3)
  await prepareRecovery(path, packagePath, 'export const name = "updated";')
  assert.equal(await readFile(path, 'utf8'), upgraded)
  const downgraded = await prepareRecovery(path, packagePath, source)
  assert.equal(downgraded.modulePath, first.modulePath, 'an existing immutable runtime can be reactivated')
  const restored = await readFile(path, 'utf8')
  assertPatch(restored, first.modulePath, 5)
  await prepareRecovery(path, packagePath, source)
  assert.equal(await readFile(path, 'utf8'), restored)
  const directory = dirname(first.modulePath)
  const backups = await Promise.all((await readdir(directory)).filter(name => name.startsWith('patch-before-')).map(name => readFile(join(directory, name), 'utf8')))
  assert.equal(backups.length, 3)
  assert.ok(backups.includes(layout.content), 'the original file has an exact recovery copy')
  assert.ok(backups.includes(installed), 'the prior runtime generation has an exact recovery copy')
  assert.ok(backups.includes(upgraded))
})
