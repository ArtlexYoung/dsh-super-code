import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validationRoot } from '../validation-root.js'

test('local tgz installs offline with empty cache and default peer resolution', { timeout: 180000 }, async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  await mkdir(validationRoot, { recursive: true })
  const dir = await mkdtemp(join(validationRoot, 'offline-peers-'))
  const cli = process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : false
  const npm = (args: string[], cwd: string, env = process.env) => spawnSync(
    cli ? process.execPath : 'npm', cli ? [cli, ...args] : args,
    { cwd, env, encoding: 'utf8', timeout: 80000, maxBuffer: 4 * 1024 * 1024, shell: !cli && process.platform === 'win32' },
  )
  const packed = npm(['pack', '--json', '--ignore-scripts', '--pack-destination', dir], root)
  await writeFile(join(dir, 'Pack.log'), packed.stdout + packed.stderr)
  assert.equal(packed.status, 0, packed.stderr || String(packed.error))
  const tarball = join(dir, JSON.parse(packed.stdout)[0].filename)
  const installDir = join(dir, '安装 目录')
  const cache = join(dir, 'cache')
  await mkdir(installDir)
  await mkdir(cache)
  await writeFile(join(installDir, 'package.json'), JSON.stringify({ private: true }))
  const config = join(dir, 'npmrc')
  const globalConfig = join(dir, 'global-npmrc')
  await writeFile(config, '')
  await writeFile(globalConfig, '')
  assert.deepEqual(await readdir(cache), [])
  const installed = npm([
    'install', tarball, '--offline', '--cache', cache, '--no-audit', '--no-fund',
    '--legacy-peer-deps=false', '--force=false',
  ], installDir, { ...process.env, npm_config_userconfig: config, npm_config_globalconfig: globalConfig })
  await writeFile(join(dir, 'Install.log'), installed.stdout + installed.stderr)
  assert.equal(installed.status, 0, installed.stderr || String(installed.error))
  const modules = join(installDir, 'node_modules')
  assert.ok(!(await readdir(modules)).includes('@deepseek-ai'), 'DSH provides its own modules at runtime')
  const pkg = JSON.parse(await readFile(join(modules, 'dsh-super-code', 'package.json'), 'utf8'))
  for (const name of Object.keys(pkg.dependencies)) {
    await readFile(join(modules, 'dsh-super-code', 'node_modules', name, 'package.json'), 'utf8')
  }
  assert.equal((await readFile(join(modules, 'dsh-super-code', 'lib/index.js'), 'utf8')).length > 0, true)
})
