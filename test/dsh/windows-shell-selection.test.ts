import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, mkdir, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { applyWindowsShell } from '../../src/dsh/windows-shell.js'
import { validationRoot } from '../validation-root.js'

for (const installed of [true, false]) test(`运行时服务${installed ? '优先复用 Git Bash 且不解压运行库' : '未找到 Git Bash 时离线准备内置运行库'}`, async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'shell-selection-')), ctx = new Context(), calls: string[] = []
  const previous = { platform: process.platform, appdata: process.env.LOCALAPPDATA }
  const cache = join(root, 'cache')
  process.env.LOCALAPPDATA = cache
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const exec = t.mock.method(childProcess, 'execFile', ((file: string, _args: string[], options: { env: NodeJS.ProcessEnv }, callback: (error: Error | null, stdout: string) => void) => {
    assert.equal(options.env.LC_ALL, 'C')
    calls.push(file)
    const output: Record<string, string> = installed ? {
      'where.exe': 'C:\\Program Files\\Git\\cmd\\git.exe\r\n',
      'C:\\Program Files\\Git\\cmd\\git.exe': 'git version 2.52.0.windows.1\r\n',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe': 'GNU bash, version 5.2.37(1)-release (x86_64-pc-msys)\n',
    } : {}
    callback(Object.hasOwn(output, file) ? null : Object.assign(new Error('Fixture command unavailable'), { code: 'ENOENT' }), output[file] ?? '')
  }) as unknown as typeof childProcess.execFile)
  syncBuiltinESMExports()
  t.after(async () => {
    exec.mock.restore(); syncBuiltinESMExports()
    Object.defineProperty(process, 'platform', { value: previous.platform })
    if (previous.appdata === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous.appdata
    await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  applyWindowsShell(ctx)
  const runtime = ctx.superCodeShell.prepare()
  assert.equal(ctx.superCodeShell.prepare(), runtime)
  const selected = await runtime
  assert.equal(ctx.superCodeShell.status().state, 'ready')
  assert.equal(ctx.superCodeShell.status().version, selected.version)
  if (installed) {
    assert.equal(selected.source, 'git')
    assert.equal(selected.bash, 'C:\\Program Files\\Git\\usr\\bin\\bash.exe')
    await assert.rejects(lstat(cache), { code: 'ENOENT' })
    assert.deepEqual(calls, ['where.exe', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'])
  } else {
    assert.notEqual(selected.source, 'git')
    assert.ok((await lstat(selected.bash)).isFile())
    assert.ok(selected.root.startsWith(cache))
  }
})
