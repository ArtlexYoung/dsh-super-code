import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskGraph } from '../src/core/task-graph.js'
import { Dispatcher } from '../src/core/dispatcher.js'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

test('refills capacity and accepted dependencies while a slow sibling still runs', { timeout: 2000 }, async () => {
  const graph = new TaskGraph([{ taskId: 'slow', title: 'Slow' }, { taskId: 'fast', title: 'Fast' }, { taskId: 'dependent', title: 'After fast', dependencies: ['fast'] }, { taskId: 'independent', title: 'Independent' }])
  const slow = deferred(), reached = deferred()
  const started: string[] = []
  const run = new Dispatcher(graph, { maxConcurrent: 2 }).runAvailable(() => 'owner', async task => {
    started.push(task.taskId)
    if (task.taskId === 'slow') await slow.promise
    if (task.taskId === 'dependent') reached.resolve()
    return { result: true, artifacts: [{ artifactId: task.taskId, uri: `memory:${task.taskId}` }] }
  }, { afterEach: async task => {
    if (task.taskId !== 'fast') return
    graph.submitTaskResult('fast', 'submit-fast')
    graph.recordReview('fast', { reviewId: 'r', reviewerId: 'owner', independent: false, outcome: 'passed', report: {}, findings: [], reviewedAt: new Date().toISOString() })
    graph.acceptTask('fast')
  } })
  try { await reached.promise; assert.equal(graph.get('slow').status, 'running'); assert.ok(started.includes('dependent')) }
  finally { slow.resolve() }
  const result = await run
  assert.equal(result.started.length, 4)
  assert.equal(result.completed.length, 4)
  assert.equal(graph.get('dependent').stage, 'needs_attention')
})

test('cancellation aborts running work without starting queued replacements', { timeout: 2000 }, async () => {
  const graph = new TaskGraph([{ taskId: 'a', title: 'A' }, { taskId: 'b', title: 'B' }])
  const start = deferred(), controller = new AbortController()
  const run = new Dispatcher(graph, { maxConcurrent: 1 }).runAvailable(() => 'owner', async (_task, signal) => {
    start.resolve()
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve() })
    return { result: 'must be discarded' }
  }, { signal: controller.signal })
  await start.promise; controller.abort()
  const result = await run
  assert.deepEqual(result.cancelled, ['a'])
  assert.equal(graph.get('b').status, 'created')
  assert.equal(graph.get('a').result, undefined)
})

test('unknown stop retains capacity until the executor actually settles', async () => {
  const graph = new TaskGraph([{ taskId: 'a', title: 'A' }, { taskId: 'b', title: 'B' }])
  const release = deferred()
  const dispatcher = new Dispatcher(graph, { maxConcurrent: 1, timeoutMs: 10 })
  const first = await dispatcher.runReady(() => 'owner', async () => { await release.promise; return { result: 1 } })
  assert.deepEqual(first.timedOut, ['a'])
  assert.deepEqual((await dispatcher.runReady(() => 'owner', async () => ({ result: 2 }))).started, [])
  release.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await dispatcher.runAvailable(() => 'owner', async () => ({ result: 2 }))).started, ['b'])
  assert.equal(graph.get('a').stage, 'stop_unknown')
})

test('completed work does not unlock dependent tasks until reviewed', async () => {
  const graph = new TaskGraph([{ taskId: 'a', title: 'A' }, { taskId: 'b', title: 'B', dependencies: ['a'] }])
  const result = await new Dispatcher(graph).runAvailable(() => 'owner', async () => ({ result: 1 }))
  assert.deepEqual(result.started, ['a'])
  assert.equal(graph.get('b').status, 'created')
})

test('admission remains finite even if acceptance adds work', async () => {
  const graph = new TaskGraph([{ taskId: 'a', title: 'A' }])
  const result = await new Dispatcher(graph, { maxConcurrent: 1 }).runAvailable(() => 'owner', async () => ({ result: 1 }), {
    maxStarted: 3, afterEach: async task => { graph.add({ taskId: `${task.taskId}a`, title: 'next' }) },
  })
  assert.equal(result.started.length, 3)
  assert.equal(graph.ready().length, 1)
})

test('an acceptance failure cancels its owned sibling and leaves queued work alone', { timeout: 2000 }, async () => {
  const graph = new TaskGraph([{ taskId: 'fast', title: 'Fast' }, { taskId: 'slow', title: 'Slow' }, { taskId: 'queued', title: 'Queued' }])
  let stopped = false
  await assert.rejects(new Dispatcher(graph, { maxConcurrent: 2 }).runAvailable(() => 'owner', async (task, signal) => {
    if (task.taskId === 'slow') {
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve() })
      stopped = true
    }
    return { result: true }
  }, { afterEach: async task => { if (task.taskId === 'fast') throw new Error('review failed') } }), /acceptance callback failed/)
  assert.equal(stopped, true)
  assert.equal(graph.get('slow').status, 'cancelled')
  assert.equal(graph.get('queued').status, 'created')
})
