import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { deletionCommand } from '../../src/core/deletion-command.js'

const executableCases = [
  ['redirect between the inline option and program', `bash -c>output.txt 'rm victim.txt'`],
  ['attached output redirection', 'rm>output.txt victim.txt'],
  ['attached append redirection', 'rm>>output.txt victim.txt'],
  ['attached input redirection', 'rm</dev/null victim.txt'],
  ['attached clobber redirection', 'rm>|output.txt victim.txt'],
  ['separate descriptor and attached command redirection', '2>stderr.txt rm>output.txt victim.txt'],
  ['redirected environment wrapper', 'env X=value>output.txt rm victim.txt'],
  ['redirected inline shell', `bash>output.txt -c 'rm victim.txt'`],
  ['clobber redirect before inline shell options', `bash>|output.txt -c 'rm victim.txt'`],
  ['exec changes argv0', 'exec -a cleaner rm victim.txt'],
  ['xargs end marker', 'printf "victim.txt\\n" | xargs -E STOP rm'],
  ['second find action', 'find . -name victim.txt -exec printf "%s\\n" {} \\; -exec rm -- {} \\;'],
  ['third find action', 'find . -name victim.txt -exec printf ok \\; -exec printf done \\; -exec rm -- {} +'],
  ['nested shell in later find action', 'find . -name victim.txt -exec printf ok \\; -exec sh -c \'rm -- "$1"\' sh {} \\;'],
] as const
const dataCases = [
  ['redirect after a plain argument', `printf '%s' rm>output.txt`],
  ['leading redirect leaves the executable unchanged', `>output.txt printf '%s' rm`],
  ['redirect filename is data', `printf '%s' >rm 'data'`],
  ['Bash combined output redirect keeps later arguments literal', `printf '%s' &>output.txt rm victim.txt`],
  ['quoted output redirect is data', `printf '%s' 'rm>output.txt'`],
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

const envSplitCases = [
  ['attached short option', 'env -S"rm victim.txt"', true],
  ['long option with equals', 'env --split-string="rm victim.txt"', true],
  ['separate long option', 'env --split-string "rm victim.txt"', true],
  ['another wrapper', 'nice env -S"rm victim.txt"', true],
  ['nested split options', 'env -S"-S \'rm victim.txt\'"', true],
  ['split options followed by executable argv', 'env -S "-u SC_ENV_SAMPLE" "rm" victim.txt', true],
  ['a later shell command', 'env -S"printf ok"; rm victim.txt', true],
  ['plain subsequent arguments', 'env -S "printf %s" rm victim.txt', false],
  ['attached option with plain arguments', 'env -S"printf %s" rm victim.txt', false],
  ['long option with plain arguments', 'env --split-string="printf %s" rm victim.txt', false],
  ['literal semicolon argument', 'env -S "printf %s" \'text; rm victim.txt\'', false],
  ['literal quote argument', 'env -S "printf %s" "text\'quoted; rm victim.txt"', false],
  ['literal newline argument', 'env -S "printf %s" \'line\nrm victim.txt\'', false],
  ['literal operator in the split string', 'env -S "printf %s;" rm victim.txt', false],
  ['literal command-substitution argument', 'env -S "printf %s" \'$(rm victim.txt)\'', false],
  ['underscore escape separates argv', "env -S 'rm\\_victim.txt'", true],
  ['stop escape keeps subsequent argv', "env -S '\\c printf ok' rm victim.txt", true],
  ['comment keeps subsequent argv', "env -S '# ignored\nprintf ok' rm victim.txt", true],
  ['empty split keeps subsequent argv', 'env -S "" rm victim.txt', true],
  ['underscore inside quotes is data', `env -S 'printf "%s\\_rm"' victim.txt`, false],
  ['literal substitution in the split string', `env -S "printf %s '\\$(rm victim.txt)'"`, false],
  ['literal backticks in the split string', "env -S 'printf %s `rm victim.txt`'", false],
  ['single-quoted escape stays literal', `env -S "printf '%s\\_rm'" victim.txt`, false],
] as const

for (const [name, script, expected] of envSplitCases) test(`env split-string argv: ${name}`, () => assert.equal(deletionCommand(script), expected, script))

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
  // macOS env supports -S; GNU long options are covered by the Linux process probe.
  const envCases = envSplitCases.filter(([, script]) => process.platform === 'linux' || !script.includes('--split-string'))
  const safeCases = [...executableCases, ...dataCases.filter(([name]) => name !== 'find printf format is data'), ...envCases]
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
