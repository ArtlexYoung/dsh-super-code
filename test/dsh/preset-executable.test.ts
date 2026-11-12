import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyBundledPreset } from '../../src/dsh/preset-files.js'

const exec = promisify(execFile)

test('installed preset skills retain executable helpers with private file permissions', { skip: process.platform === 'win32' }, async t => {
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'executable-')), bundled = join(root, 'presets')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(bundled, 'super-code'), { recursive: true })
  await writeFile(join(bundled, 'super-code/agent.cordis.yml'), '- name: dsh-super-code/skills\n  config:\n    layout: builtin\n')
  const helper = 'pstack/dsh/skills/show-me-your-work/scripts/log.sh'
  const skillRoot = join(root, 'builtin/skills')
  await mkdir(join(skillRoot, helper, '..'), { recursive: true })
  const source = fileURLToPath(new URL('../../builtin/skills/' + helper, import.meta.url))
  await cp(source, join(skillRoot, helper))
  await chmod(join(skillRoot, helper), 0o755)
  await writeFile(join(skillRoot, 'notes.txt'), 'Private ordinary resource')
  await chmod(join(skillRoot, 'notes.txt'), 0o644)

  const installed = await copyBundledPreset(bundled, join(root, 'staging'), '中文 模式', '中文模式')
  const script = join(installed.directory, 'builtin/skills', helper), output = join(root, 'decision log.tsv')
  await exec(script, [output, 'verify', 'installed helper works', 'keep executable permission', 'actual copied skill', 'passed'])
  assert.match(await readFile(output, 'utf8'), /verify\tinstalled helper works\tkeep executable permission\tactual copied skill\tpassed/)
  assert.equal((await lstat(script)).mode & 0o7777, 0o700)
  assert.equal((await lstat(join(installed.directory, 'builtin/skills/notes.txt'))).mode & 0o7777, 0o600)
  assert.equal((await lstat(join(installed.directory, 'builtin/skills'))).mode & 0o7777, 0o700)
  assert.equal(await readFile(script, 'utf8'), await readFile(source, 'utf8'))
})
