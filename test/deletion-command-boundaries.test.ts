import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { deletionCommand } from '../src/core/deletion-command.js'

const executableCases = [
  ['exec changes argv0', 'exec -a cleaner rm victim.txt'],
  ['xargs end marker', 'printf "victim.txt\\n" | xargs -E STOP rm'],
  ['second find action', 'find . -name victim.txt -exec printf "%s\\n" {} \\; -exec rm -- {} \\;'],
  ['third find action', 'find . -name victim.txt -exec printf ok \\; -exec printf done \\; -exec rm -- {} +'],
  ['nested shell in later find action', 'find . -name victim.txt -exec printf ok \\; -exec sh -c \'rm -- "$1"\' sh {} \\;'],
] as const
const dataCases = [
  ['argv0 is data', 'exec -a rm printf hello'],
  ['xargs marker is data', 'printf "victim.txt\\n" | xargs -E rm printf "%s\\n"'],
  ['shell positional text is data', `bash -c 'printf "%s" "$1"' ignored '; rm victim.txt'`],
  ['shell command name argument is data', `sh -c 'printf "%s" "$0"' '; rm victim.txt'`],
  ['find child argument is data', `find . -name victim.txt -exec printf '%s' 'x; rm victim.txt' \\;`],
  ['find matching pattern is data', `find . -name '-delete'`],
  ['find printf format is data', `find . -name victim.txt -printf '-delete'`],
  ['find executable argument is data', `find . -name victim.txt -exec printf '%s' -delete \\;`],
  ['find shell positional text is data', `find . -name victim.txt -exec sh -c 'printf "%s" "$1"' ignored 'text; rm victim.txt' \\;`],
  ['brace expansion in prose is data', 'printf "%s" {a,rm}'],
] as const

for (const [name, script] of executableCases) test(`deletion positions: ${name}`, () => assert.equal(deletionCommand(script), true, script))
for (const [name, script] of dataCases) test(`non-executable text: ${name}`, () => assert.equal(deletionCommand(script), false, script))

test('find deletion outside child commands and nested shell deletion still require consent', () => {
  for (const script of [
    `find . -name '-delete' -delete`, `find . -exec printf '%s' -delete \\; -delete`,
    `find . -name victim.txt -exec sh -c 'rm -- "$1"' ignored {} \\;`,
    `bash -c 'rm -- "$1"' ignored victim.txt`, `exec -a cleaner env rm victim.txt`,
    `{ rm victim.txt; }`, `f() { rm victim.txt; }; f`,
  ]) assert.equal(deletionCommand(script), true, script)
})

test('PowerShell startup options are not mistaken for the inline command option', () => {
  for (const script of [
    'pwsh -NonInteractive -Command "Remove-Item victim.txt"',
    'powershell -ExecutionPolicy Bypass -NoProfile -Command "Remove-Item victim.txt"',
    'pwsh -NoLogo -NonInteractive -c "rm victim.txt"',
  ]) assert.equal(deletionCommand(script), true, script)
  for (const script of [
    'pwsh -NonInteractive -Command "Write-Output rm"',
    'powershell -ExecutionPolicy Bypass -Command "Write-Output \'Remove-Item victim.txt\'"',
  ]) assert.equal(deletionCommand(script), false, script)
})

test('PowerShell encoded commands are inspected as UTF-16 scripts rather than opaque arguments', () => {
  for (const option of ['-EncodedCommand', '-enc', '-e', '-ec']) {
    for (const [script, expected] of [['Remove-Item victim.txt', true], ["Write-Output 'Remove-Item victim.txt'", false]] as const) {
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      assert.equal(deletionCommand(`powershell -NoProfile ${option} ${encoded}`), expected, option)
    }
  }
  const encoded = Buffer.from('Remove-Item victim.txt', 'utf16le').toString('base64')
  assert.equal(deletionCommand(`powershell -Command "Write-Output rm" -EncodedCommand ${encoded}`), false, 'command arguments are not new startup options')
  assert.equal(deletionCommand('powershell -File external.ps1 -Command "Remove-Item victim.txt"'), false, 'file arguments are not inline programs')
  assert.equal(deletionCommand('bash external.sh -c "rm victim.txt"'), false, 'POSIX script arguments are not inline programs')
})

test('recognition agrees with actual Bash execution when rm is a harmless recording executable', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-deletion-probe-')), bin = join(root, 'bin'), workspace = join(root, 'workspace'), marker = join(root, 'invoked')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(bin); await mkdir(workspace); await writeFile(join(workspace, 'victim.txt'), 'unchanged')
  await writeFile(join(bin, 'rm'), '#!/bin/sh\nprintf "called\\n" >> "$SC_MARKER"\n'); await chmod(join(bin, 'rm'), 0o700)
  const execute = async (name: string, script: string): Promise<void> => {
    let stderr = ''
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', script], {
        cwd: workspace, env: { ...process.env, PATH: bin + ':/usr/bin:/bin', SC_MARKER: marker, SC_RECORDING_RM: join(bin, 'rm') }, stdio: ['ignore', 'ignore', 'pipe'],
      })
      child.stderr.on('data', bytes => { stderr += bytes }); child.once('error', reject); child.once('exit', resolve)
    })
    assert.equal(code, 0, `${name}: ${stderr}`)
  }
  // A noexec fixture mount must fail before PATH can fall through to the real rm.
  await execute('recording executable preflight', 'exec "$SC_RECORDING_RM"')
  assert.equal(await readFile(marker, 'utf8'), 'called\n')
  const safeCases = [...executableCases, ...dataCases.filter(([name]) => name !== 'find printf format is data')]
  for (const [name, script] of safeCases) {
    await unlink(marker).catch(error => { if (error.code !== 'ENOENT') throw error })
    await execute(name, script)
    const invoked = await readFile(marker, 'utf8').then(value => value.includes('called'), error => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    assert.equal(deletionCommand(script), invoked, name)
    assert.equal(await readFile(join(workspace, 'victim.txt'), 'utf8'), 'unchanged')
  }
})
