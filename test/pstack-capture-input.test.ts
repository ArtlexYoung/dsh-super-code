import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureCommand, verifyCapture } from '../runtime/skills/pstack/overrides/scripts/capture.mjs'

const scratch = fileURLToPath(new URL('../../source/validation/dsh-super-code/pstack-remediation-20261111/completion-6/unit/', import.meta.url))
async function workspace() {
  await mkdir(scratch, { recursive: true })
  return mkdtemp(join(scratch, 'argv-'))
}

test('capture rejects sparse argv before starting a command or writing evidence', async () => {
  const cwd = await workspace()
  const argv = [process.execPath, '-e', 'console.log("must not execute")', , 'tail']
  await assert.rejects(captureCommand(argv, cwd), /argv/)
  assert.deepEqual(await readdir(cwd), [])
})

test('capture snapshots caller argv before its first await for recording and execution', async () => {
  const cwd = await workspace()
  const argv = [process.execPath, '-e', 'console.log(process.argv[1])', 'original 中文; $()']
  const expected = [...argv]
  const running = captureCommand(argv, cwd)
  argv[3] = 'mutated after submission'
  argv.push('unexpected extra argument')
  const result = await running
  const command = JSON.parse(await readFile(join(cwd, result.directory, 'command.json'), 'utf8'))
  assert.deepEqual(command.argv, expected)
  assert.equal(await readFile(join(cwd, result.directory, 'stdout.txt'), 'utf8'), 'original 中文; $()\n')
  assert.deepEqual(result.outcome, { kind: 'exit', code: 0 })
  assert.equal((await verifyCapture(result.directory, cwd)).verified, true)
})
