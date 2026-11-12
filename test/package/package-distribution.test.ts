import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('npm ships every runtime resource once and retains public exports and third-party notices', { timeout: 90000 }, async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const cli = process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : false
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts']
  const packed = spawnSync(cli ? process.execPath : 'npm', cli ? [cli, ...args] : args, {
    cwd: root, encoding: 'utf8', timeout: 80000, maxBuffer: 4 * 1024 * 1024,
    shell: !cli && process.platform === 'win32',
  })
  assert.equal(packed.status, 0, packed.stderr || String(packed.error))
  const files = new Set<string>(JSON.parse(packed.stdout)[0].files.map((row: { path: string }) => row.path))
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  for (const target of Object.values(pkg.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value as object))) {
    if (!(target as string).includes('*')) assert.ok(files.has((target as string).replace(/^\.\//, '')), String(target))
  }
  for (const target of Object.values(pkg.bin)) assert.ok(files.has(target as string), String(target))
  assert.ok(files.has('builtin/README.md'))
  assert.ok(files.has('builtin/skills/oil-ui/SKILL.md'))
  assert.ok(files.has('builtin/skills/oil-ui/LICENSE'))
  assert.ok(![...files].some(path => /^presets\/super-code\/(skills|skill-packs)\//.test(path)), 'Builtin resources are not duplicated in presets')
  for (const pack of ['openspec', 'mattpocock']) {
    const prefix = `builtin/skills/${pack}/`
    const distribution = JSON.parse(await readFile(new URL(`../../${prefix}distribution.json`, import.meta.url), 'utf8'))
    for (const { path } of Object.values(distribution.files) as { path: string }[]) assert.ok(files.has(prefix + path), pack + '/' + path)
    for (const name of ['LICENSE', 'UPSTREAM.md', 'distribution.json']) assert.ok(files.has(prefix + name), pack + '/' + name)
  }
  const prefix = 'builtin/skills/pstack/'
  const manifest = JSON.parse(await readFile(new URL(`../../${prefix}dsh/adaptation.json`, import.meta.url), 'utf8'))
  for (const path of [...Object.keys(manifest.files), 'adaptation.json']) assert.ok(files.has(prefix + 'dsh/' + path), path)
  assert.equal([...files].filter(path => path.startsWith(prefix + 'dsh/skills/') && path.endsWith('/SKILL.md')).length, 58)
  assert.ok(files.has(prefix + 'LICENSE'))
  assert.ok(files.has(prefix + 'UPSTREAM.md'))
  assert.ok(files.has(prefix + 'distribution.json'))
  assert.ok(![...files].some(path => /^builtin\/skills\/pstack\/(agents|assets|docs|skills)\//.test(path)), 'Unadapted PStack originals duplicate the DSH distribution')
  assert.ok(![...files].some(path => path.startsWith('runtime/skills/pstack/')), 'Build-time adapters stay in Git')
  for (const shim of ['openspec', 'openspec.cmd']) assert.ok(files.has('runtime/skills/openspec/bin/' + shim))
  assert.equal(pkg.dependencies['@fission-ai/openspec'], '1.17.0', 'the CLI matches the pinned Skill distribution')
  const windows = JSON.parse(await readFile(new URL('../../runtime/windows/manifest.json', import.meta.url), 'utf8'))
  for (const file of windows.files) assert.ok(files.has('runtime/windows/' + file.asset), file.asset)
  assert.ok([...files].some(path => path.startsWith('runtime/windows/sources/')))
  assert.ok(files.has('runtime/windows/licenses/BusyBox-LICENSE.txt'))
})
