import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import type { DelegatedTask, DelegationHost, HostObservation, ModelSelection } from '../../src/connection/types.js'

class Host implements DelegationHost {
  accepted = new Map<string, string>()
  created = 0; selections = 0; cancellations = 0
  finished = false; rejectPrompt = false; rejectSelection = false
  selectGate: (() => Promise<void>) | false = false
  async preset(): Promise<string> { return 'super-code' }
  async create(): Promise<void> { this.created++ }
  async selectModel(_id: string, selection: ModelSelection): Promise<ModelSelection> {
    this.selections++; if (this.selectGate) await this.selectGate()
    if (this.rejectSelection) throw new Error('fixture model unavailable')
    return selection
  }
  async prompt(_id: string, request: string, prompt: string): Promise<void> {
    if (this.rejectPrompt) throw new Error('fixture admission unknown')
    this.accepted.set(request, prompt)
  }
  async observe(_id: string, request: string): Promise<HostObservation> {
    const admitted = this.accepted.has(request)
    return { status: !admitted ? 'unavailable' : this.finished ? 'finished' : 'running', output: admitted ? this.accepted.get(request)! : '',
      detail: 'fixture request observation', observation: { lastEventSeq: admitted ? 1 : -1, lastEventType: admitted ? 'user/message' : '', outputTruncated: false } }
  }
  async cancel(): Promise<void> { this.cancellations++ }
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-persistence-')), cwd = join(root, 'workspace')
  await mkdir(cwd)
  const store = new ConnectionStore(join(root, 'profile')); await store.initialize()
  const host = new Host(), configuration = () => ({ ...defaultConnectionConfig, enabled: true, allowedDirectories: [cwd] })
  const tasks = new DelegatedTasks(store, host, configuration); await tasks.initialize()
  const cleanup: (() => Promise<void>)[] = []
  t.after(async () => {
    for (const dispose of cleanup.reverse()) await dispose()
    try { await tasks.close(); await store.close() } finally { await rm(root, { recursive: true, force: true }) }
  })
  async function restore() {
    const destination = join(root, 'restored-' + randomUUID()), snapshot = await readFile(join(store.directory, 'tasks.json'))
    const restoredStore = new ConnectionStore(destination); await restoredStore.initialize()
    await writeFile(join(destination, 'tasks.json'), snapshot)
    const restored = new DelegatedTasks(restoredStore, host, configuration); await restored.initialize()
    cleanup.push(async () => { await restored.close(); await restoredStore.close() })
    return { tasks: restored, store: restoredStore }
  }
  function failSave(at = 1) {
    const original = store.saveTasks.bind(store); let count = 0
    store.saveTasks = async rows => { if (++count === at) throw new Error('fixture disk write failed'); await original(rows) }
    const reset = () => { store.saveTasks = original }
    cleanup.push(async () => reset()); return reset
  }
  return { root, cwd, store, host, tasks, cleanup, restore, failSave }
}
const initial = (cwd: string) => ({ cwd, requestId: 'initial', prompt: 'Initial accepted request' })
const follow = (taskId: string) => ({ taskId, requestId: 'follow', prompt: 'Follow-up', modelSelection: { provider: 'fixture', model: 'fixture' } })

test('failed first intent persistence leaves no phantom task and the same request can be submitted safely', async t => {
  const f = await fixture(t), before = await readFile(join(f.store.directory, 'tasks.json')), reset = f.failSave()
  await assert.rejects(f.tasks.run(initial(f.cwd)), /fixture disk write failed/)
  assert.equal(f.host.created, 0); assert.equal(f.host.accepted.size, 0)
  assert.deepEqual(f.tasks.overview(), [])
  assert.deepEqual(await readFile(join(f.store.directory, 'tasks.json')), before)
  reset()
  assert.equal((await f.tasks.run(initial(f.cwd))).status, 'running')
  assert.equal(f.host.accepted.size, 1)
})

test('failed continuation intent persistence preserves the previous state in memory and on disk', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), before = (await f.store.tasks())[0]!, reset = f.failSave()
  await assert.rejects(f.tasks.send(follow(first.taskId)), /fixture disk write failed/)
  assert.deepEqual((await f.store.tasks())[0], before)
  reset()
  const view = await f.tasks.view(first.taskId, 0)
  assert.equal(view.status, 'running'); assert.equal(view.output, initial(f.cwd).prompt)
  assert.deepEqual((await f.store.tasks())[0], before)
  assert.equal(f.host.selections, 0); assert.equal(f.host.accepted.size, 1)
  await f.tasks.send(follow(first.taskId)); assert.equal(f.host.accepted.size, 2)
})

test('failed cancellation persistence does not leave an unrecorded automatic cancellation behind', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), before = (await f.store.tasks())[0]!, reset = f.failSave()
  await assert.rejects(f.tasks.cancel(first.taskId), /fixture disk write failed/)
  reset(); await f.tasks.tick()
  assert.equal(f.host.cancellations, 0)
  assert.equal((await f.store.tasks())[0]!.cancellationRequested, before.cancellationRequested)
  assert.equal((await f.tasks.view(first.taskId, 0)).status, 'running')
})

for (const finished of [false, true]) {
  test(`restart snapshot during model preparation retains the ${finished ? 'finished' : 'running'} accepted turn`, async t => {
    const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)); f.host.finished = finished
    await f.tasks.view(first.taskId, 0)
    const before = (await f.store.tasks())[0]!, entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
    f.cleanup.push(async () => released.resolve())
    f.host.selectGate = async () => { entered.resolve(); await released.promise }
    f.host.rejectSelection = true
    const pending = f.tasks.send(follow(first.taskId)); await entered.promise
    try {
      const restored = await f.restore(), row = (await restored.store.tasks())[0]!
      assert.equal(row.currentRequest, before.currentRequest)
      assert.equal((await restored.tasks.view(first.taskId, 0)).status, finished ? 'finished' : 'running')
      await restored.tasks.send(follow(first.taskId))
      assert.equal(f.host.selections, 1); assert.equal(f.host.accepted.size, 1, 'saved intent is never replayed')
    } finally { released.resolve(); await pending }
  })
}

test('failed prompt checkpoint leaves the accepted request intact and never automatically retries a saved operation', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), before = (await f.store.tasks())[0]!, reset = f.failSave(2)
  await assert.rejects(f.tasks.send(follow(first.taskId)), /fixture disk write failed/)
  reset()
  const row = (await f.store.tasks())[0]!
  assert.equal(row.currentRequest, before.currentRequest); assert.ok(Object.hasOwn(row.operations, 'follow'))
  assert.equal((await f.tasks.view(first.taskId, 0)).status, 'running')
  assert.equal(f.host.selections, 1); assert.equal(f.host.accepted.size, 1)
  await f.tasks.send(follow(first.taskId)); assert.equal(f.host.selections, 1); assert.equal(f.host.accepted.size, 1)
  const restored = await f.restore()
  assert.equal((await restored.tasks.view(first.taskId, 0)).status, 'running')
})

test('a crash snapshot immediately before prompt invocation retains a fallback to the active previous turn', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), before = (await f.store.tasks())[0]!
  const original = f.host.prompt.bind(f.host), entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>()
  f.cleanup.push(async () => released.resolve())
  f.host.prompt = async () => { entered.resolve(); await released.promise; throw new Error('fixture stop after crash snapshot') }
  const pending = f.tasks.send(follow(first.taskId)); await entered.promise
  try {
    const restored = await f.restore(), row = (await restored.store.tasks())[0]!
    assert.notEqual(row.currentRequest, before.currentRequest)
    const view = await restored.tasks.view(first.taskId, 0)
    assert.equal(view.status, 'running'); assert.equal(view.output, initial(f.cwd).prompt)
    await restored.tasks.send(follow(first.taskId)); assert.equal(f.host.accepted.size, 1)
  } finally { released.resolve(); await pending; f.host.prompt = original }
})

test('a finished fallback never confirms completion of an uncertain newer prompt', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)); f.host.finished = true; f.host.rejectPrompt = true
  const unknown = await f.tasks.send(follow(first.taskId))
  assert.equal(unknown.status, 'interrupted'); assert.match(unknown.events.at(-1)!.message, /admission.*not.*confirmed|admission.*unconfirmed/i)
  const restored = await f.restore()
  assert.equal((await restored.tasks.view(first.taskId, 0)).status, 'interrupted')
  assert.equal(f.host.accepted.size, 1)
})

test('late admission switches observation to the newer turn and clears the persisted fallback', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)); f.host.rejectPrompt = true
  const unknown = await f.tasks.send(follow(first.taskId))
  assert.equal(unknown.status, 'running'); assert.equal(unknown.output, initial(f.cwd).prompt)
  const row = (await f.store.tasks())[0]!
  f.host.accepted.set(row.currentRequest, 'Late accepted follow-up')
  const settled = await f.tasks.view(first.taskId, 0)
  assert.equal(settled.output, 'Late accepted follow-up')
  assert.deepEqual((await f.store.tasks())[0]!.pendingRequests, [])
  const restored = await f.restore()
  assert.equal((await restored.tasks.view(first.taskId, 0)).output, 'Late accepted follow-up')
})

test('failure after prompt acceptance never rolls back or resends the accepted turn', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), before = (await f.store.tasks())[0]!, reset = f.failSave(3)
  await assert.rejects(f.tasks.send(follow(first.taskId)), /fixture disk write failed/)
  reset()
  assert.equal(f.host.accepted.size, 2)
  const view = await f.tasks.send(follow(first.taskId))
  assert.equal(view.output, follow(first.taskId).prompt); assert.equal(f.host.accepted.size, 2)
  assert.notEqual((await f.store.tasks())[0]!.currentRequest, before.currentRequest)
  const restored = await f.restore()
  assert.equal((await restored.tasks.view(first.taskId, 0)).output, follow(first.taskId).prompt)
})

for (const reader of ['wait', 'tick'] as const) {
  test(`a failed completion write through ${reader} preserves the durable task and retries observation`, async t => {
    const f = await fixture(t), first = await f.tasks.run(initial(f.cwd))
    const before = (await f.store.tasks())[0]!, reset = f.failSave()
    f.host.finished = true
    await assert.rejects(reader === 'wait' ? f.tasks.wait(first.taskId, first.cursor, 0) : f.tasks.tick(), /fixture disk write failed/)
    assert.equal(f.tasks.overview()[0]?.status, 'running')
    assert.deepEqual((await f.store.tasks())[0], before)
    reset()
    const completed = await f.tasks.wait(first.taskId, first.cursor, 0)
    assert.equal(completed.status, 'finished')
    assert.equal(completed.events.length, 1)
    assert.equal(completed.cursor, first.cursor + 1)
    assert.equal((await f.store.tasks())[0]?.status, 'finished')
    assert.equal((await f.store.tasks())[0]?.sequence, completed.cursor)
    const restored = await f.restore()
    assert.equal((await restored.tasks.view(first.taskId, completed.cursor)).status, 'finished')
    assert.equal(f.host.accepted.size, 1)
  })
}

test('failure saving a reconnect never reports a connection that was not saved', async t => {
  const f = await fixture(t), input = initial(f.cwd)
  const first = await f.tasks.run({ ...input, connectionId: 'original' })
  const reset = f.failSave()
  await assert.rejects(f.tasks.send({ taskId: first.taskId, requestId: input.requestId, prompt: input.prompt, connectionId: 'reconnected' }), /fixture disk write failed/)
  assert.equal(f.tasks.overview()[0]?.connectionId, 'original')
  assert.equal((await f.store.tasks())[0]?.connectionId, 'original')
  reset()
  await f.tasks.run({ ...input, connectionId: 'reconnected' })
  assert.equal(f.tasks.overview()[0]?.connectionId, 'reconnected')
  assert.equal((await f.store.tasks())[0]?.connectionId, 'reconnected')
  assert.equal(f.host.created, 1)
  assert.equal(f.host.accepted.size, 1)
})

test('a temporary host observation rejection retains output and can recover without resending', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd)), observe = f.host.observe.bind(f.host)
  f.host.observe = async () => { throw new Error('fixture host temporarily unavailable') }
  await f.tasks.tick()
  const unavailable = await f.tasks.wait(first.taskId, first.cursor, 0)
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.output, initial(f.cwd).prompt)
  f.host.observe = observe
  assert.equal((await f.tasks.wait(first.taskId, unavailable.cursor, 0)).status, 'running')
  assert.equal(f.host.accepted.size, 1)
})

test('a failed observation checkpoint preserves the previous request until the new admission can be saved', async t => {
  const f = await fixture(t), first = await f.tasks.run(initial(f.cwd))
  f.host.rejectPrompt = true
  await f.tasks.send(follow(first.taskId))
  const before = (await f.store.tasks())[0]!
  assert.ok(before.pendingRequests?.length)
  f.host.accepted.set(before.currentRequest, 'Late follow-up admitted')
  const reset = f.failSave()
  await assert.rejects(f.tasks.wait(first.taskId, first.cursor, 0), /fixture disk write failed/)
  assert.deepEqual((await f.store.tasks())[0], before)
  reset()
  const view = await f.tasks.wait(first.taskId, first.cursor, 0)
  assert.equal(view.output, 'Late follow-up admitted')
  assert.deepEqual((await f.store.tasks())[0]?.pendingRequests, [])
  assert.equal(f.host.accepted.size, 2)
})

function records(template: DelegatedTask, count: number, text: string): DelegatedTask[] {
  return Array.from({ length: count }, (_, index) => {
    const id = 'sc-' + randomUUID()
    return { ...template, id, sessionId: id, requestId: 'large-' + index, sequence: 200,
      events: Array.from({ length: 200 }, (_, event) => ({ cursor: event + 1, time: 1, status: 'running', message: text })) }
  })
}

test('task history larger than the former 16 MiB cap remains readable and survives restart', async t => {
  const f = await fixture(t); await f.tasks.run(initial(f.cwd))
  const rows = records((await f.store.tasks())[0]!, 100, 'm'.repeat(1000))
  await f.store.saveTasks(rows)
  assert.ok((await stat(join(f.store.directory, 'tasks.json'))).size > 16 * 1024 * 1024)
  assert.deepEqual(await f.store.tasks(), rows)
  const restored = await f.restore(); assert.equal((await restored.tasks.list(0)).tasks.length, 25)
})

test('oversized task writes are rejected before replacing a readable history', async t => {
  const f = await fixture(t); await f.tasks.run(initial(f.cwd))
  const before = await readFile(join(f.store.directory, 'tasks.json')), template = (await f.store.tasks())[0]!
  await assert.rejects(f.store.saveTasks(records(template, 200, '界'.repeat(1000))), /task-storage-full/)
  assert.deepEqual(await readFile(join(f.store.directory, 'tasks.json')), before)
  assert.equal((await f.store.tasks()).length, 1)
})

test('an externally oversized file is rejected without reading or overwriting its content', async t => {
  const f = await fixture(t), path = join(f.store.directory, 'tasks.json'), before = await readFile(path)
  await truncate(path, 64 * 1024 * 1024 + 1)
  await assert.rejects(f.store.tasks(), /storage-unavailable/)
  assert.equal((await stat(path)).size, 64 * 1024 * 1024 + 1)
  await writeFile(path, before)
})

test('directory metadata does not affect MCP settings, tasks or lock ownership', async t => {
  const f = await fixture(t)
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) await writeFile(join(f.store.directory, name), 'OS metadata')
  const settings = await f.store.settings()
  await f.store.saveSettings(settings)
  const task = await f.tasks.run(initial(f.cwd))
  assert.equal((await f.store.tasks())[0]!.id, task.taskId)
  assert.deepEqual(await f.store.settings(), settings)
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) assert.equal(await readFile(join(f.store.directory, name), 'utf8'), 'OS metadata')
})
