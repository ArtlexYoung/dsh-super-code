import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { captureCommand, verifyCapture } from '../runtime/skills/pstack/overrides/scripts/capture.mjs'

const scratch = new URL('../../source/validation/dsh-super-code/pstack-remediation-20261111/completion-5/unit/', import.meta.url)
async function workspace() { await mkdir(scratch, { recursive: true }); return mkdtemp(join(scratch.pathname, '中文 空格-')) }

test('captures real stdout, stderr and a failing exit without retry or shell interpretation', async () => {
  const cwd = await workspace()
  const args = [process.execPath, '-e', 'console.log(process.argv[1]); console.error("stderr 中"); process.exitCode=7', '$(never-run); 中文']
  const result = await captureCommand(args, cwd)
  assert.deepEqual(result.outcome, { kind: 'exit', code: 7 })
  assert.equal(await readFile(join(cwd, result.directory, 'stdout.txt'), 'utf8'), '$(never-run); 中文\n')
  assert.equal(await readFile(join(cwd, result.directory, 'stderr.txt'), 'utf8'), 'stderr 中\n')
  assert.deepEqual((await verifyCapture(result.directory, cwd)).outcome, result.outcome)
})

test('simultaneous captures keep distinct evidence and isolate child temporary files inside the workspace', async () => {
  const cwd = await workspace()
  const code = 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path"); const f=p.join(os.tmpdir(),"probe.txt");fs.writeFileSync(f,process.argv[1]);console.log(f)'
  const results = await Promise.all(['first', 'second'].map(value => captureCommand([process.execPath, '-e', code, value], cwd)))
  assert.notEqual(results[0].directory, results[1].directory)
  for (const [i, result] of results.entries()) {
    const path = (await readFile(join(cwd, result.directory, 'stdout.txt'), 'utf8')).trim()
    assert.ok(path.startsWith(join(cwd, result.directory, 'tmp') + '/'))
    assert.equal(await readFile(path, 'utf8'), ['first', 'second'][i])
    assert.equal((await verifyCapture(result.directory, cwd)).verified, true)
  }
})

test('records a spawn failure and preserves its evidence', async () => {
  const cwd = await workspace()
  const result = await captureCommand([join(cwd, 'missing-command')], cwd)
  assert.equal(result.outcome.kind, 'spawn-error')
  assert.equal(result.outcome.code, 'ENOENT')
  assert.equal((await verifyCapture(result.directory, cwd)).verified, true)
  assert.equal((await readdir(join(cwd, result.directory))).includes('command.json'), true)
})

test('verification detects changed stdout, changed command identity and missing evidence', async () => {
  const cwd = await workspace()
  for (const file of ['stdout.txt', 'command.json']) {
    const result = await captureCommand([process.execPath, '-e', 'console.log("original")'], cwd)
    await writeFile(join(cwd, result.directory, file), 'changed')
    await assert.rejects(verifyCapture(result.directory, cwd), /changed/)
  }
  await assert.rejects(verifyCapture('scratch/nonexistent', cwd), /ENOENT/)
})

test('rejects an external scratch symlink before writing there', async () => {
  const cwd = await workspace(), outside = await workspace()
  await symlink(outside, join(cwd, 'scratch'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(captureCommand([process.execPath, '-e', 'console.log("no")'], cwd), /outside/)
  assert.deepEqual(await readdir(outside), [])
  await assert.rejects(verifyCapture(outside, cwd), /outside/)
})

test('rejects malformed argv without creating evidence and gives commands EOF on stdin', async () => {
  const cwd = await workspace()
  for (const args of [[], [''], [process.execPath, null], [process.execPath, '\0']]) await assert.rejects(captureCommand(args, cwd), /argv/)
  assert.deepEqual(await readdir(cwd), [])
  const result = await captureCommand([process.execPath, '-e', 'process.stdin.resume();process.stdin.on("end",()=>console.log("EOF"))'], cwd)
  assert.equal(await readFile(join(cwd, result.directory, 'stdout.txt'), 'utf8'), 'EOF\n')
})

test('CLI preserves a nonzero exit and prints paths to retained evidence', async () => {
  const cwd = await workspace()
  const helper = new URL('../runtime/skills/pstack/overrides/scripts/capture.mjs', import.meta.url)
  const result = spawnSync(process.execPath, [helper.pathname, process.execPath, '-e', 'process.exitCode=9'], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 9, result.stderr)
  const captured = JSON.parse(result.stdout)
  const verified = execFileSync(process.execPath, [helper.pathname, '--verify', captured.directory], { cwd, encoding: 'utf8' })
  assert.equal(JSON.parse(verified).verified, true)
})

test('records a signal separately from a numeric exit', async () => {
  const cwd = await workspace()
  const result = await captureCommand([process.execPath, '-e', 'process.kill(process.pid,"SIGTERM")'], cwd)
  assert.deepEqual(result.outcome, { kind: 'signal', signal: 'SIGTERM' })
  assert.equal((await verifyCapture(result.directory, cwd)).verified, true)
})

test('verification rejects a replaced output symlink pointing outside the workspace', async () => {
  const cwd = await workspace(), outside = await workspace()
  await writeFile(join(outside, 'outside.txt'), 'outside')
  const result = await captureCommand([process.execPath, '-e', 'console.log("data")'], cwd)
  // Retain the original output rather than deleting it.
  const { rename } = await import('node:fs/promises')
  await rename(join(cwd, result.directory, 'stdout.txt'), join(cwd, result.directory, 'original-stdout.txt'))
  await symlink(join(outside, 'outside.txt'), join(cwd, result.directory, 'stdout.txt'))
  await assert.rejects(verifyCapture(result.directory, cwd), /outside/)
})
