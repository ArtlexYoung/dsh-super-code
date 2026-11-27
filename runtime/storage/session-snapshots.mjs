/** Native independent snapshots for new evaluation releases; original evidence stays readable. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
const run = promisify(execFile)

export async function copySessionSnapshot(source, output) {
  if (resolve(source) === resolve(output)) throw new Error('Snapshot source and destination must differ')
  const before = await lstat(source, { bigint: true })
  if (!before.isFile()) throw new Error('Snapshot source must be an ordinary file')
  const expected = sha(await readFile(source))
  const temporary = join(dirname(output), '.session-clone-' + randomUUID())
  try {
    // FORCE rejects unsupported filesystems instead of silently making another full copy.
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE)
    } catch (error) {
      if (process.platform !== 'darwin' || error.code !== 'ENOSYS') throw error
      // Some macOS Node builds lack libuv clone support; call clonefile itself.
      await run('/usr/bin/python3', ['-B', fileURLToPath(new URL('./clone-file.py', import.meta.url)), source, temporary])
    }
    const cloned = await lstat(temporary, { bigint: true })
    if (!cloned.isFile() || cloned.ino === before.ino || cloned.nlink !== 1n) {
      throw new Error('Session snapshot is not an independent ordinary file')
    }
    if (sha(await readFile(temporary)) !== expected || identity(await lstat(source, { bigint: true })) !== identity(before)) {
      throw new Error('Session changed during snapshot; previous destination preserved')
    }
    await rename(temporary, output)
    return { method: 'native-clone-required', sha256: expected, bytes: Number(before.size), independentInode: true }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function files(root, prefix = '') {
  const found = []
  try {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = join(prefix, entry.name)
      if (entry.isDirectory()) found.push(...await files(root, path))
      else if (entry.isFile()) found.push(path)
      else throw new Error('Unexpected session symlink: ' + path)
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return found
}

export async function createRuntimeHome(localRoot, runDir) {
  const home = join(localRoot, process.env.DSH_EVAL_BOOT_ONLY === '1' ? 'preflight-home' : 'task-home')
  await mkdir(home, { recursive: true })
  const hashes = {}
  for (const name of await files(join(home, 'sessions'))) hashes[name] = sha(await readFile(join(home, 'sessions', name)))
  await writeFile(join(runDir, 'runtime-home.json'), JSON.stringify({ home,
    sessionsBefore: Object.keys(hashes), sessionHashesBefore: hashes,
    sessionArchive: join(runDir, 'dsh-home-rpc/sessions'), inherited: false, sharedWithinTaskOnly: true,
    retainedForRecovery: true }, null, 2) + '\n')
  return home
}

export async function archiveRuntimeSessions(home, runDir) {
  const receipt = JSON.parse(await readFile(join(runDir, 'runtime-home.json'), 'utf8'))
  const hashes = {}, destination = join(runDir, 'dsh-home-rpc/sessions')
  for (const name of await files(join(home, 'sessions'))) {
    if (!name.endsWith('.zstd')) continue
    const source = join(home, 'sessions', name), digest = sha(await readFile(source))
    if (receipt.sessionHashesBefore[name] === digest && receipt.sessionsBefore.includes(name)) continue
    const output = join(destination, name)
    await mkdir(dirname(output), { recursive: true })
    const copied = await copySessionSnapshot(source, output)
    if (copied.sha256 !== digest) throw new Error('Session changed before archival')
    hashes[name] = digest
  }
  const result = { archived: Object.keys(hashes).length > 0, destination, files: hashes,
    sourceRetained: true, inherited: false, sharedWithinTaskOnly: true, modifiedSessionFilesIncluded: true,
    storage: 'native-independent-clone-required' }
  await writeFile(join(runDir, 'session-archive.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

export async function mergeResumeWire(runDir, previous) {
  return { merged: false, runDir, previous: previous ?? false, scope: 'invocation-local-wire/whole-task-native-sessions' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[2] !== 'copy-snapshot') throw new Error('Usage: runtime-storage.mjs copy-snapshot SOURCE OUTPUT')
  await copySessionSnapshot(process.argv[3], process.argv[4])
}
