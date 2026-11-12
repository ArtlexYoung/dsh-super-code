import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { ConnectionStore } from '../../src/connection/store.js'

const source = new URL('../../src/connection/store.ts', import.meta.url).href
async function fixture(t: test.TestContext) {
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(join(scratch, 'lock-crash-'))
  const exited = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
  assert.equal(exited.status, 0)
  await writeFile(join(directory, 'owner.lock'), `${exited.pid}:dead`)
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
function child(directory: string, crash = false) {
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    if (${crash}) {
      const original = fs.link;
      fs.link = async (from, to) => { await original(from, to);
        if (to.includes('recovery')) { process.send('guard'); await new Promise(()=>{}); }
      }; syncBuiltinESMExports();
    }
    const {ConnectionStore} = await import(${JSON.stringify(source)});
    const store = new ConnectionStore(process.argv[1]);
    try { await store.initialize(); process.send('claimed'); }
    catch (error) { process.send(String(error.message)); process.exit(0); }
    process.on('message', async () => { await store.close(); process.exit(0); });
  `, directory], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
}

test('crashed recovery owners can be recovered across generations and competing processes', { timeout: 20000 }, async t => {
  const directory = await fixture(t)
  for (let generation = 0; generation < 2; generation++) {
    const process = child(directory, true)
    t.after(() => { if (process.exitCode === null && !process.signalCode) process.kill('SIGKILL') })
    const [message] = await once(process, 'message')
    assert.equal(message, 'guard')
    const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited
  }
  const processes = Array.from({ length: 6 }, () => child(directory))
  t.after(() => { for (const process of processes) if (process.exitCode === null && !process.signalCode) process.kill('SIGKILL') })
  const replies = await Promise.all(processes.map(process => once(process, 'message')))
  assert.equal(replies.filter(([message]) => message === 'claimed').length, 1, JSON.stringify(replies))
  assert.equal(replies.filter(([message]) => message === 'profile-busy').length, 5, JSON.stringify(replies))
  const winner = processes[replies.findIndex(([message]) => message === 'claimed')]!
  const exit = once(winner, 'exit'); winner.send('release'); await exit
  const store = new ConnectionStore(directory)
  await store.initialize(); await store.saveTasks([]); await store.close()
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8')), [])
})

test('a contender claiming the released owner path is reported as profile-busy and retains its lock', async t => {
  const directory = await fixture(t), path = join(directory, 'owner.lock'), contender = `${process.pid}:competing`
  const original = fs.link
  let ownerClaims = 0
  t.mock.method(fs, 'link', async (from, to) => {
    if (to === path && ownerClaims++ === 1) await writeFile(path, contender, { flag: 'wx' })
    return original(from, to)
  })
  syncBuiltinESMExports()
  try { await assert.rejects(new ConnectionStore(directory).initialize(), { message: 'profile-busy' }) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(ownerClaims, 2)
  assert.equal(await readFile(path, 'utf8'), contender)
  assert.deepEqual(await readdir(directory), ['owner.lock'])
})

test('ambiguous empty legacy recovery guards are preserved instead of stolen', { timeout: 5000 }, async t => {
  const directory = await fixture(t)
  await writeFile(join(directory, 'recovery.lock'), '')
  const original = await readFile(join(directory, 'owner.lock'), 'utf8')
  await assert.rejects(new ConnectionStore(directory).initialize(), /profile-busy/)
  assert.equal(await readFile(join(directory, 'owner.lock'), 'utf8'), original)
  assert.equal(await readFile(join(directory, 'recovery.lock'), 'utf8'), '')
  assert.ok(!(await readdir(directory)).some(name => name.endsWith('.tmp')))
})

test('unsupported atomic lock publication fails without stale claims and can retry', async t => {
  const directory = await fixture(t), original = await readFile(join(directory, 'owner.lock'), 'utf8')
  const link = fs.link, failure = Object.assign(new Error('Hard links are unavailable'), { code: 'ENOTSUP' })
  t.mock.method(fs, 'link', async () => { throw failure })
  syncBuiltinESMExports()
  try { await assert.rejects(new ConnectionStore(directory).initialize(), error => error === failure) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  assert.equal(await readFile(join(directory, 'owner.lock'), 'utf8'), original)
  assert.deepEqual(await readdir(directory), ['owner.lock'])
  const store = new ConnectionStore(directory)
  await store.initialize(); await store.saveTasks([]); await store.close()
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8')), [])
})
