import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { archiveRuntimeSessions, copySessionSnapshot, createRuntimeHome } from './session-snapshots.mjs'

test('cumulative snapshots keep original bytes and independent write semantics', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-native-snapshot-'))
  try {
    const source = join(base, 'source.zstd'), old = join(base, 'old.zstd'), latest = join(base, 'latest.zstd')
    const original = randomBytes(300000), added = randomBytes(10000)
    await writeFile(source, original)
    assert.equal((await copySessionSnapshot(source, old)).method, 'native-clone-required')
    await appendFile(source, added)
    await copySessionSnapshot(source, latest)
    assert.deepEqual(await readFile(old), original)
    assert.deepEqual(await readFile(latest), Buffer.concat([original, added]))
    assert.notEqual((await lstat(source)).ino, (await lstat(old)).ino)
    assert.equal((await lstat(old)).nlink, 1)
    await writeFile(old, 'independent change')
    assert.deepEqual(await readFile(source), Buffer.concat([original, added]))
    await rm(source)
    assert.deepEqual(await readFile(latest), Buffer.concat([original, added]))
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('same-task recovery, changed sessions and cross-task isolation retain receipt semantics', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-native-homes-'))
  try {
    const run = join(base, 'task-a/attempt-1')
    await mkdir(run, { recursive: true })
    const home = await createRuntimeHome(join(base, 'task-a/runtime-homes'), run)
    await mkdir(join(home, 'sessions/current'), { recursive: true })
    const source = join(home, 'sessions/current/session.v4.jsonl.zstd')
    await writeFile(source, 'first')
    const receipt = await archiveRuntimeSessions(home, run)
    assert.deepEqual(Object.keys(receipt.files), ['current/session.v4.jsonl.zstd'])
    const archived = join(receipt.destination, Object.keys(receipt.files)[0])
    await writeFile(source, 'next')
    assert.equal(await readFile(archived, 'utf8'), 'first')
    const retry = join(base, 'task-a/attempt-2')
    await mkdir(retry)
    assert.equal(await createRuntimeHome(join(base, 'task-a/runtime-homes'), retry), home)
    assert.equal((await archiveRuntimeSessions(home, retry)).archived, false)
    const other = join(base, 'task-b/attempt-1')
    await mkdir(other, { recursive: true })
    const isolated = await createRuntimeHome(join(base, 'task-b/runtime-homes'), other)
    assert.notEqual(isolated, home)
    assert.deepEqual(JSON.parse(await readFile(join(other, 'runtime-home.json'), 'utf8')).sessionsBefore, [])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('invalid sources preserve existing destinations and leave no temporary snapshot', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-native-invalid-'))
  try {
    const output = join(base, 'output.zstd'), alias = join(base, 'alias')
    await writeFile(output, 'keep')
    await symlink(output, alias)
    await assert.rejects(copySessionSnapshot(alias, output), /ordinary file/)
    await assert.rejects(copySessionSnapshot(output, output), /must differ/)
    assert.equal(await readFile(output, 'utf8'), 'keep')
  } finally { await rm(base, { recursive: true, force: true }) }
})
