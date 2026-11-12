import { validationRoot as scratch } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ConnectionStore } from '../../src/connection/store.js'
import { DelegatedTasks } from '../../src/connection/tasks.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import { connectionSessionFacts } from '../../src/dsh/connection-host.js'

async function fixture(t: test.TestContext, followUps = ['follow-B', 'follow-C']) {
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'queued-')), store = new ConnectionStore(join(root, 'profile'))
  let events: SessionEvent[] = []
  const requests: string[] = []
  const append = (type: string, data: object) => events.push({ type, data, seq: events.length, time: Date.now() } as SessionEvent)
  const start = (request: string) => {
    append('turn/start', { turn: requests.indexOf(request) + 1 })
    append('user/message', { source: { kind: 'user', rpcId: request } })
  }
  let status = 'running', cancellations = 0, observations = 0
  const host = {
    preset: async () => 'super-code', create: async () => {}, cancel: async () => { cancellations++; status = 'idle' },
    prompt: async (_id: string, request: string) => { requests.push(request); if (requests.length === 1) start(request) },
    observe: async (_id: string, request: string, cancelling = false) => {
      observations++
      const latestRequestId = (events.findLast(event => event.type === 'user/message')?.data as { source?: { rpcId?: string } })?.source?.rpcId
      return { ...connectionSessionFacts(events, status, request, cancelling), latestRequestId, detail: 'Observed native event layout' }
    },
  }
  const config = { ...defaultConnectionConfig, enabled: true, allowCallerApproval: true, allowedDirectories: [root] }
  await store.initialize()
  const tasks = new DelegatedTasks(store, host, () => config)
  await tasks.initialize()
  const restoredTasks: DelegatedTasks[] = []
  t.after(async () => { for (const task of restoredTasks) await task.close(); await tasks.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const first = await tasks.run({ cwd: root, requestId: 'initial', prompt: 'A' })
  for (const requestId of followUps) await tasks.send({ taskId: first.taskId, requestId, prompt: requestId })
  return { root, store, tasks, first, requests, start, append, config, host, restoredTasks, cancellations: () => cancellations, observations: () => observations }
}

test('middle queued turns retain their status, caller approval and retry identity', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  f.append('turn/end', { reason: { kind: 'completed' } })
  f.start(f.requests[1]!)
  f.append('approval/asked', { id: 'middle-approval' })
  const waiting = await f.tasks.wait(f.first.taskId, 0, 0)
  assert.equal(waiting.status, 'waiting_confirmation')
  const answer = f.tasks.requestApproval({ sessionId: f.first.sessionId, toolName: 'bash', arguments: '{"command":"git status"}', reason: 'User confirmation' },
    [{ sessionId: f.first.sessionId, requestIds: [f.requests[1]!] }])
  let pending = f.tasks.approvals.pending(f.first.taskId)
  for (let i = 0; !pending.length && i < 50; i++) {
    await new Promise(resolve => setTimeout(resolve, 1)); pending = f.tasks.approvals.pending(f.first.taskId)
  }
  assert.equal(pending.length, 1)
  await f.tasks.approve(f.first.taskId, pending[0]!.id, 'reject')
  assert.equal(await answer, 'rejected')
  // Retry of C must not enqueue it again, even while B is waiting.
  await f.tasks.send({ taskId: f.first.taskId, requestId: 'follow-C', prompt: 'follow-C' })
  assert.equal(f.requests.length, 3)
  f.append('approval/decided', { id: 'middle-approval' })
  f.append('turn/end', { reason: { kind: 'completed' } })
  f.start(f.requests[2]!)
  await f.tasks.wait(f.first.taskId, waiting.cursor, 0)
  assert.deepEqual((await f.store.tasks())[0]!.pendingRequests, [])
})

test('legacy single-fallback task records load into the pending request queue without replay', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const path = join(f.store.directory, 'tasks.json')
  const saved = JSON.parse(await readFile(path, 'utf8'))
  delete saved[0].pendingRequests
  saved[0].previousRequest = f.requests[0]
  await writeFile(path, JSON.stringify(saved))
  const rows = await f.store.tasks()
  assert.deepEqual(rows[0]!.pendingRequests, [f.requests[0]])
  assert.equal(Object.hasOwn(rows[0]!, 'previousRequest'), false)
  assert.equal(f.requests.length, 3)
})

test('queued middle turns remain observable after service restart without replay', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  await f.tasks.close()
  const restored = new DelegatedTasks(f.store, f.host, () => f.config)
  f.restoredTasks.push(restored)
  await restored.initialize()
  assert.equal(f.requests.length, 3)
  f.append('turn/end', { reason: { kind: 'completed' } })
  f.start(f.requests[1]!)
  f.append('assistant/message', { content: [{ type: 'text', text: 'middle turn output' }] })
  f.append('approval/asked', { id: 'restored-middle' })
  const waiting = await restored.view(f.first.taskId, 0)
  assert.equal(waiting.status, 'waiting_confirmation')
  assert.equal(waiting.output, 'middle turn output')
  assert.deepEqual((await f.store.tasks())[0]!.pendingRequests, [f.requests[1]])
  assert.equal(f.requests.length, 3)
})

test('cancelling queued continuations never replays a request or delegates later approval', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const cancelled = await f.tasks.cancel(f.first.taskId)
  assert.equal(cancelled.status, 'cancelled')
  assert.ok(f.cancellations() > 0)
  assert.equal(f.requests.length, 3)
  assert.equal(await f.tasks.requestApproval({ sessionId: f.first.sessionId, toolName: 'bash', arguments: '{}', reason: 'late approval' },
    [{ sessionId: f.first.sessionId, requestIds: [f.requests[1]!] }]), 'host')
  assert.deepEqual(f.tasks.approvals.pending(f.first.taskId), [])
})

test('a full continuation queue needs only two observations of the native journal', { timeout: 30000 }, async t => {
  const f = await fixture(t, Array.from({ length: 128 }, (_, index) => `queued-${index}`))
  f.append('turn/end', { reason: { kind: 'completed' } })
  f.start(f.requests[64]!)
  f.append('approval/asked', { id: 'large-queue-approval' })
  const before = f.observations()
  assert.equal((await f.tasks.view(f.first.taskId, 0)).status, 'waiting_confirmation')
  assert.equal(f.observations() - before, 2)
  assert.equal((await f.store.tasks())[0]!.pendingRequests!.length, 64)
  assert.equal(f.requests.length, 129)
  await assert.rejects(f.tasks.send({ taskId: f.first.taskId, requestId: 'overflow', prompt: 'must not send' }), /task-operation-limit/)
  assert.equal(f.requests.length, 129)
})
