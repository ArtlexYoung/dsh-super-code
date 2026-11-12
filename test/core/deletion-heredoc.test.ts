import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile, chmod } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { deletionCommand } from '../../src/core/deletion-command.js'

const cases = [
  ['quoted apostrophe', "cat <<'EOF'\nit's safe\nEOF\nrm victim.txt"],
  ['unquoted apostrophe', "cat <<EOF\nit's safe\nEOF\nrm victim.txt"],
  ['literal backtick', "cat <<'EOF'\n`not a command\nEOF\nrm victim.txt"],
  ['double-quoted delimiter', 'cat <<"EOF"\n"literal quote\nEOF\nrm victim.txt'],
  ['literal backslash in double-quoted delimiter', 'cat <<"E\\OF"\nit\'s safe\nE\\OF\nrm victim.txt'],
  ['escaped delimiter', "cat <<\\EOF\nit's safe\nEOF\nrm victim.txt"],
  ['continued delimiter', "cat <<E\\\nOF\nit's safe\nEOF\nrm victim.txt"],
  ['continued delimiter still expands body', 'cat <<E\\\nOF\n$(rm victim.txt)\nEOF'],
  ['tab-stripped body', "cat <<-'EOF'\n\tit's safe\n\tEOF\nrm victim.txt"],
  ['two documents', "cat <<'ONE' <<'TWO'\nit's safe\nONE\n\"also safe\nTWO\nrm victim.txt"],
  ['attached file descriptor', "cat 3<<'EOF'\nit's safe\nEOF\nrm victim.txt"],
  ['leading redirect', "3<<'EOF' cat\nit's safe\nEOF\nrm victim.txt"],
  ['substitution inside literal quotes', "cat <<EOF\nit's $(rm victim.txt)\nEOF"],
  ['backticks in unquoted body', "cat <<EOF\nit's `rm victim.txt`\nEOF"],
  ['shell reads stdin', "bash <<'EOF'\nprintf '%s' \"it's safe\"\nrm victim.txt\nEOF"],
  ['body hash is literal', 'cat <<EOF\n# $(rm victim.txt)\nEOF'],
  ['last stdin document wins', "bash <<'ONE' <<'TWO'\nprintf safe\nONE\nrm victim.txt\nTWO"],
  ['shell stdin with positional arguments', "bash -s -- data <<'EOF'\nrm victim.txt\nEOF"],
  ['direct pipe to shell', "cat <<'EOF' | bash\nrm victim.txt\nEOF"],
  ['pipe has its own input', "cat <<'ONE' | bash <<'TWO'\nprintf safe\nONE\nrm victim.txt\nTWO"],
] as const

for (const [name, input] of cases) test(`here-doc deletion is detected: ${name}`, () => {
  assert.equal(deletionCommand(input), true, input)
})

test('quoted prose, escaped expansions and here-strings do not execute deletion commands', () => {
  for (const input of ["cat <<'EOF'\nit's $(rm victim.txt)\nEOF", 'cat <<EOF\n\\$(rm victim.txt)\nEOF',
    "cat <<'EOF'\n`rm victim.txt`\nEOF", "cat <<'EOF'\nit's safe\nEOF\nprintf 'rm victim.txt'",
    "cat <<<\"it's safe\"; printf 'rm victim.txt'", "bash 3<<'EOF'\nrm victim.txt\nEOF",
    "bash <<'ONE' <<'TWO'\nrm victim.txt\nONE\nprintf safe\nTWO",
    "cat <<'ONE' | bash <<'TWO'\nrm victim.txt\nONE\nprintf safe\nTWO",
    "cat <<'EOF' | printf 'safe' | bash\nrm victim.txt\nEOF",
    "bash '<script' -c 'rm victim.txt'", "bash '0'<<'EOF'\nrm victim.txt\nEOF"]) assert.equal(deletionCommand(input), false, input)
})

test('here-doc recognition agrees with real Bash using only a recording rm executable', { skip: process.platform === 'win32' }, async t => {
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'heredoc-')), marker = join(root, 'invoked'), bin = join(root, 'bin')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(bin)
  await writeFile(join(bin, 'rm'), '#!/bin/sh\nprintf called >> "$SC_MARKER"\n')
  await chmod(join(bin, 'rm'), 0o700)
  const exec = promisify(execFile), env = { ...process.env, PATH: bin + ':/usr/bin:/bin', SC_MARKER: marker }
  await exec('/bin/bash', ['--noprofile', '--norc', '-c', '"$1"', 'check', join(bin, 'rm')], { cwd: root, env })
  assert.equal(await readFile(marker, 'utf8'), 'called')
  for (const [name, input] of cases) {
    await unlink(marker)
    const running = exec('/bin/bash', ['--noprofile', '--norc', '-c', input], { cwd: root, env, timeout: 10_000 })
    running.child.stdin!.end()
    await running
    assert.equal(await readFile(marker, 'utf8'), 'called', name)
    assert.equal(deletionCommand(input), true, name)
  }
})
