import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, delimiter } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { validationRoot } from '../validation-root.js'
import { openspecProvider } from '../../src/dsh/openspec-shell.js'
import { skillPackages } from '../../src/dsh/skill-packages.js'

const run = promisify(execFile)

test('Skill package versions come from their bundled provenance', async () => {
  for (const [key, id] of Object.entries({ grillMeSkill: 'mattpocock', oilUiSkill: 'oil-ui', openspecSkills: 'openspec', mattpocockSkills: 'mattpocock', pstackSkills: 'pstack' })) {
    const source = JSON.parse(await readFile(new URL(`../../builtin/skills/${id}/distribution.json`, import.meta.url), 'utf8'))
    assert.deepEqual(skillPackages[key], { version: source.version, revision: source.revision })
  }
})

test('OpenSpec environment is live, scoped, and leaves commands, projects and host environment unchanged', async t => {
  await mkdir(validationRoot, { recursive: true })
  const cwd = await mkdtemp(join(validationRoot, 'OpenSpec 中文 空格 #%-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'keep.txt'), 'user content')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  class Host {
    readonly config = {}
    resolve(request: { command: string; env?: NodeJS.ProcessEnv }) { return { workdir: cwd, ...request } }
    argv(spec: { command: string }) { return ['host-shell', spec.command] }
  }
  let enabled = false
  const Wrapped = openspecProvider(Host, () => enabled), shell = new Wrapped(ctx, {})
  const request = { command: 'openspec --version', env: { PATH: process.env.PATH, KEEP: 'unchanged' }, sandboxPolicy: { mode: 'read-only' } }
  const originalEnv = { ...process.env }, originalRequest = structuredClone(request)
  assert.deepEqual(shell.resolve(request), new Host().resolve(request))
  enabled = true
  const prepared = shell.resolve(request)
  assert.equal(prepared.command, request.command)
  assert.deepEqual(prepared.sandboxPolicy, request.sandboxPolicy)
  assert.equal(prepared.env?.KEEP, 'unchanged')
  assert.ok(prepared.env?.PATH?.endsWith(delimiter + process.env.PATH))
  if (process.platform !== 'win32') {
    const mixedCase = shell.resolve({ command: 'true', env: { Path: 'a distinct variable' } })
    assert.equal(mixedCase.env?.Path, 'a distinct variable')
    assert.ok(mixedCase.env?.PATH?.endsWith(delimiter + process.env.PATH))
  }
  if (process.platform !== 'win32') {
    const version = await run('bash', ['--noprofile', '--norc', '-c', prepared.command], { cwd, env: { ...process.env, ...prepared.env } })
    assert.equal(version.stdout.trim(), '1.17.0')
    await assert.rejects(run('bash', ['--noprofile', '--norc', '-c', 'openspec list --json'], { cwd, env: { ...process.env, ...prepared.env } }), (error: any) => {
      const result = JSON.parse(error.stdout)
      assert.equal(result.root, null)
      return true
    })
  }
  enabled = false
  assert.deepEqual(shell.resolve(request), new Host().resolve(request))
  assert.deepEqual(await readdir(cwd), ['keep.txt'])
  assert.equal(await readFile(join(cwd, 'keep.txt'), 'utf8'), 'user content')
  assert.equal(JSON.stringify(process.env) === JSON.stringify(originalEnv), true, 'the host environment remains unchanged')
  assert.deepEqual(request, originalRequest)
})

test('the installed CLI initializes a project only when its init command is explicitly executed', { skip: process.platform === 'win32' }, async t => {
  await mkdir(validationRoot, { recursive: true })
  const cwd = await mkdtemp(join(validationRoot, 'OpenSpec explicit init-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  class Host {
    readonly config = {}
    resolve(request: { command: string }) { return request }
    argv(spec: { command: string }) { return ['bash', '-c', spec.command] }
  }
  const Shell = openspecProvider(Host, () => true), shell = new Shell(ctx, {})
  const spec = shell.resolve({ command: 'openspec init --tools none --no-animation --no-copilot-cloud' })
  assert.deepEqual(await readdir(cwd), [], 'preparing the invocation does not write the project')
  await run('bash', ['--noprofile', '--norc', '-c', spec.command], { cwd, env: { ...process.env, ...spec.env } })
  assert.ok((await readdir(cwd)).includes('openspec'))
  const kept = await readFile(join(cwd, 'openspec/config.yaml'), 'utf8')
  await run('bash', ['--noprofile', '--norc', '-c', 'openspec list --json'], { cwd, env: { ...process.env, ...spec.env } })
  assert.equal(await readFile(join(cwd, 'openspec/config.yaml'), 'utf8'), kept)
})
