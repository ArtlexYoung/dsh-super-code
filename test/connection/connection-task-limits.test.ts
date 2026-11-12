import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { DelegatedTask, HostObservation } from '../../src/connection/types.js'

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'super-code-task-limits-')))
  const cwd = join(root, '中文 workspace'); await mkdir(cwd)
  const store = new ConnectionStore(join(root, 'profile')); await store.initialize()
  const effects = { create: 0, prompt: 0, cancel: 0 }
  let observation: HostObservation = { status: 'finished', output: '原始结果 🧪', detail: 'Completed' }
  const host = {
    preset: async () => 'super-code',
    create: async () => { effects.create++ },
    prompt: async () => { effects.prompt++ },
    cancel: async () => { effects.cancel++ },
    observe: async () => observation,
  }
  const config = { ...defaultConnectionConfig, enabled: true, allowedDirectories: [cwd] }
  let tasks = new DelegatedTasks(store, host, () => config); await tasks.initialize()
  t.after(async () => {
    try { await tasks.close(); await store.close() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const first = await tasks.run({ requestId: 'template', cwd, prompt: 'Create one real persisted task' })
  const template = (await store.tasks())[0]!
  const install = async (rows: DelegatedTask[]) => {
    await tasks.close(); await store.saveTasks(rows)
    tasks = new DelegatedTasks(store, host, () => config); await tasks.initialize()
  }
  const rows = (count: number) => Array.from({ length: count }, (_, index) => {
    const id = `sc-${randomUUID()}`
    return { ...structuredClone(template), id, sessionId: id, requestId: `history-${index}`, createdAt: index + 1, updatedAt: index + 1 }
  })
  return { root, cwd, store, effects, first, rows, install, get tasks() { return tasks },
    observe: (next: HostObservation) => { observation = next } }
}

test('the 200-task history boundary rejects only new work and preserves idempotent retries across restart', async t => {
  const f = await fixture(t), rows = f.rows(199)
  await f.install(rows)
  const before = { ...f.effects }
  const input = { requestId: 'last-slot', cwd: f.cwd, prompt: 'Fill the final history slot' }
  const last = await f.tasks.run(input)
  assert.equal(last.status, 'finished')
  assert.equal((await f.store.tasks()).length, 200)
  assert.deepEqual(f.effects, { ...before, create: before.create + 1, prompt: before.prompt + 1 })
  const full = await readFile(join(f.store.directory, 'tasks.json'))
  await assert.rejects(f.tasks.run({ ...input, requestId: 'overflow' }), /task-history-full/)
  assert.deepEqual(await readFile(join(f.store.directory, 'tasks.json')), full)
  assert.equal((await f.tasks.run(input)).taskId, last.taskId)
  await assert.rejects(f.tasks.run({ ...input, prompt: 'Conflicting retry' }), /request-conflict/)
  assert.deepEqual(f.effects, { ...before, create: before.create + 1, prompt: before.prompt + 1 })
  await f.install(await f.store.tasks())
  assert.equal((await f.tasks.run(input)).taskId, last.taskId)
  await assert.rejects(f.tasks.run({ ...input, requestId: 'overflow-after-restart' }), /task-history-full/)
  assert.deepEqual(f.effects, { ...before, create: before.create + 1, prompt: before.prompt + 1 })
})

test('all 200 retained tasks can be paged without duplicates, missing rows or host side effects', async t => {
  const f = await fixture(t), rows = f.rows(200)
  await f.install(rows)
  const before = await readFile(join(f.store.directory, 'tasks.json')), effects = { ...f.effects }
  const readAll = async () => {
    const ids: string[] = []
    let cursor = 0
    for (let page = 0; page < 8; page++) {
      const result = await f.tasks.list(cursor)
      assert.equal(result.tasks.length, 25)
      ids.push(...result.tasks.map(row => row.taskId))
      if (page === 7) assert.equal(result.nextCursor, false)
      else { assert.equal(result.nextCursor, cursor + 25); cursor = result.nextCursor as number }
    }
    assert.deepEqual(ids, rows.map(row => row.id).reverse())
    assert.equal(new Set(ids).size, 200)
    assert.deepEqual(await f.tasks.list(200), { tasks: [], nextCursor: false })
    assert.deepEqual(await f.tasks.list(Number.MAX_SAFE_INTEGER), { tasks: [], nextCursor: false })
  }
  await readAll(); await f.install(await f.store.tasks()); await readAll()
  assert.deepEqual(f.effects, effects)
  assert.deepEqual(await readFile(join(f.store.directory, 'tasks.json')), before)
})

test('event eviction preserves exact cursor boundaries, atomic failure recovery and cold restart', async t => {
  const f = await fixture(t)
  const row = (await f.store.tasks())[0]!
  row.status = 'running'
  await f.install([row])
  const initialCursor = (await f.store.tasks())[0]!.sequence
  for (let index = 0; index < 205; index++) {
    f.observe({ status: 'running', output: `进度 ${index} 🧪`, detail: 'Observed progress',
      observation: { lastEventSeq: index, lastEventType: 'assistant/message', outputTruncated: false } })
    await f.tasks.tick()
  }
  const retained = (await f.store.tasks())[0]!
  assert.equal(retained.sequence, initialCursor + 205)
  assert.equal(retained.events.length, 200)
  assert.deepEqual(retained.events.map(event => event.cursor), Array.from({ length: 200 }, (_, i) => retained.sequence - 199 + i))
  const boundary = retained.events[0]!.cursor - 1
  const older = await f.tasks.view(row.id, boundary - 1), exact = await f.tasks.view(row.id, boundary)
  assert.equal(older.eventsTruncated, true); assert.equal(exact.eventsTruncated, false)
  assert.deepEqual(older.events, retained.events); assert.deepEqual(exact.events, retained.events)
  const tail = await f.tasks.view(row.id, retained.sequence - 1)
  assert.equal(tail.eventsTruncated, false); assert.deepEqual(tail.events, retained.events.slice(-1))
  const current = await f.tasks.view(row.id, retained.sequence)
  assert.equal(current.eventsTruncated, false); assert.deepEqual(current.events, [])

  f.observe({ status: 'finished', output: '最终结果 🧪', detail: 'Finished after event eviction',
    observation: { lastEventSeq: 205, lastEventType: 'turn/end', outputTruncated: false } })
  const save = f.store.saveTasks.bind(f.store), disk = await readFile(join(f.store.directory, 'tasks.json'))
  f.store.saveTasks = async () => { throw new Error('fixture final checkpoint failed') }
  try { await assert.rejects(f.tasks.tick(), /final checkpoint failed/) }
  finally { f.store.saveTasks = save }
  assert.equal(f.tasks.overview()[0]!.status, 'running')
  assert.deepEqual(await readFile(join(f.store.directory, 'tasks.json')), disk)
  await f.tasks.tick()
  const finished = await f.tasks.view(row.id, retained.sequence)
  assert.equal(finished.status, 'finished'); assert.equal(finished.output, '最终结果 🧪')
  assert.equal(finished.cursor, retained.sequence + 1); assert.equal(finished.events.length, 1)
  assert.equal(finished.events[0]!.cursor, retained.sequence + 1)
  assert.equal((await f.store.tasks())[0]!.events.length, 200)
  await f.install(await f.store.tasks())
  assert.deepEqual(await f.tasks.view(row.id, retained.sequence), finished)
  assert.deepEqual(f.effects, { create: 1, prompt: 1, cancel: 0 })
})
