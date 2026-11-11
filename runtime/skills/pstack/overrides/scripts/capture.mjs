#!/usr/bin/env node
import { mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

async function inside(root, path) {
  const actual = await realpath(path), local = relative(root, actual)
  if (local === '..' || local.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(local)) throw new Error('Evidence path is outside the workspace')
  return actual
}
async function digest(path) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length }
  return { bytes, sha256: hash.digest('hex') }
}
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })

/** Execute argv once, without a shell, and retain evidence in a unique project directory. */
export async function captureCommand(argv, cwd = process.cwd()) {
  // Own the submitted arguments before I/O; spreading also exposes sparse holes.
  if (Array.isArray(argv)) argv = [...argv]
  if (!Array.isArray(argv) || !argv.length || !argv[0] || argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('Expected nonempty string argv')
  const root = await realpath(cwd), scratch = join(root, 'scratch')
  await mkdir(scratch, { recursive: true })
  await inside(root, scratch)
  const directory = await mkdtemp(join(scratch, 'pstack-evidence-')), temporary = join(directory, 'tmp')
  await mkdir(temporary, { mode: 0o700 })
  await save(join(directory, 'command.json'), { version: 1, cwd: root, argv })
  const stdout = await open(join(directory, 'stdout.txt'), 'wx', 0o600)
  const stderr = await open(join(directory, 'stderr.txt'), 'wx', 0o600)
  let outcome
  try {
    outcome = await new Promise((resolveRun, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: root, env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
        stdio: ['ignore', stdout.fd, stderr.fd], windowsHide: true,
      })
      let failure
      const interrupt = signal => { child.kill(signal) }
      const onTerm = () => interrupt('SIGTERM'), onInt = () => interrupt('SIGINT')
      process.on('SIGTERM', onTerm); process.on('SIGINT', onInt)
      child.once('error', error => { failure = { kind: 'spawn-error', code: error.code ?? 'UNKNOWN', message: error.message } })
      child.once('close', (code, signal) => {
        process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt)
        if (failure) resolveRun(failure)
        else if (signal) resolveRun({ kind: 'signal', signal })
        else if (Number.isInteger(code)) resolveRun({ kind: 'exit', code })
        else reject(new Error('Command ended without an exit status'))
      })
    })
  } finally { await stdout.close(); await stderr.close() }
  const result = { version: 1, outcome, command: await digest(join(directory, 'command.json')), stdout: await digest(join(directory, 'stdout.txt')), stderr: await digest(join(directory, 'stderr.txt')) }
  await save(join(directory, 'result.json'), result)
  return { directory: relative(root, directory), ...result }
}

/** Verify retained bytes; command success and truth of an audit claim are separate. */
export async function verifyCapture(directory, cwd = process.cwd()) {
  const root = await realpath(cwd), target = await inside(root, resolve(root, directory))
  const result = JSON.parse(await readFile(await inside(root, join(target, 'result.json')), 'utf8'))
  if (result.version !== 1 || !result.outcome) throw new Error('Invalid evidence result')
  for (const [key, file] of [['command', 'command.json'], ['stdout', 'stdout.txt'], ['stderr', 'stderr.txt']]) {
    const actual = await digest(await inside(root, join(target, file)))
    if (actual.sha256 !== result[key]?.sha256 || actual.bytes !== result[key]?.bytes) throw new Error('Evidence changed: ' + file)
  }
  return { ...result, directory: relative(root, target), verified: true }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2)
    if (argv[0] === '--verify' && argv.length !== 2) throw new Error('Usage: capture.mjs --verify DIRECTORY')
    const result = argv[0] === '--verify' ? await verifyCapture(argv[1]) : await captureCommand(argv)
    console.log(JSON.stringify(result))
    if (!result.verified) process.exitCode = result.outcome.kind === 'exit' ? result.outcome.code : result.outcome.kind === 'signal' && result.outcome.signal === 'SIGINT' ? 130 : result.outcome.kind === 'signal' && result.outcome.signal === 'SIGTERM' ? 143 : 1
  } catch (error) { console.error(error.message); process.exitCode = 2 }
}
