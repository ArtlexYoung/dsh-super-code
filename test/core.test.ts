import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TaskGraph } from '../src/core/task-graph.js'
import { Dispatcher } from '../src/core/dispatcher.js'
import { createTask, transitionTask } from '../src/core/protocol.js'
import type { TaskRecord } from '../src/core/protocol.js'
import { summarizeReviews } from '../src/core/review.js'
import { ResearchLedger, normalizeUrl } from '../src/core/research.js'
import { OptimizationLedger } from '../src/core/optimization.js'
import { compactFeedback, runProgrammingWorkflow, shouldPlanSeparately } from '../src/core/programming.js'
import { resolveConfig, SuperAgentService } from '../src/dsh/index.js'
import { runConversationWorkflow } from '../src/core/conversation.js'
import { aggregateEvaluationRuns, evaluateReleaseGate } from '../src/core/evaluation.js'
import { ProtocolError, artifactDigest, validateEvent, validateTaskRecord } from '../src/core/protocol.js'

const digest = 'a'.repeat(64)

function deterministic() {
  let tick = 0
  let id = 0
  return {
    clock: () => new Date(1700000000000 + ++tick * 1_000).toISOString(),
    idFactory: () => String(++id),
  }
}

function accept(graph: TaskGraph, taskId: string, prefix: string, clock: () => string): void {
  const started = graph.startTask(taskId)
  graph.completeTask(taskId, started.attemptId!, { ok: true }, [{ artifactId: `${taskId}-artifact`, uri: `memory:${taskId}`, digest }])
  graph.submitTaskResult(taskId, `${prefix}-submit`)
  graph.recordReview(taskId, {
    reviewId: `${prefix}-review`,
    reviewerId: `${prefix}-reviewer`,
    independent: true,
    outcome: 'passed',
    report: { passed: true },
    findings: [],
    reviewedAt: clock(),
  })
  graph.acceptTask(taskId, undefined, `${prefix}-accept`)
}

describe('TaskGraph lifecycle', () => {
  it('keeps the legacy transition helper inside the canonical snapshot rules', () => {
    const now = '2023-11-14T22:13:21.000Z'
    const initial = createTask({ taskId: 'legacy', title: 'Legacy', now })
    const running = transitionTask(initial, 'running', [], now)
    assert.equal(running.attempts, 1)
    assert.doesNotThrow(() => validateTaskRecord(running))

    const waiting = transitionTask(running, 'waiting', [], now)
    assert.equal(waiting.stage, 'awaiting_review')
    assert.equal(waiting.submissions.length, 1)
    assert.doesNotThrow(() => validateTaskRecord(waiting))

    const rerun = transitionTask(waiting, 'running', [], now)
    assert.equal(rerun.attempts, 2)
    assert.equal(rerun.attemptHistory.at(-1)?.outcome, 'running')
    assert.doesNotThrow(() => validateTaskRecord(rerun))

    const failed = transitionTask(waiting, 'failed', [], now)
    assert.equal(failed.attemptHistory.at(-1)?.outcome, 'failed')
    assert.doesNotThrow(() => validateTaskRecord(failed))

    const cancelled = transitionTask(initial, 'cancelled', [], now)
    assert.equal(cancelled.cancellation?.outcome, 'confirmed')
    assert.doesNotThrow(() => validateTaskRecord(cancelled))

    const pendingCancellation = {
      ...running,
      stage: 'stopping' as const,
      cancellation: {
        requestId: 'cancel-request',
        reason: 'keep this reason',
        requestedAt: now,
        outcome: 'requested' as const,
      },
    }
    const confirmed = transitionTask(pendingCancellation, 'cancelled', [], now)
    assert.equal(confirmed.cancellation?.requestId, 'cancel-request')
    assert.equal(confirmed.cancellation?.reason, 'keep this reason')
  })

  it('requires supplied accepted records for a pending dependency', () => {
    const now = '2023-11-14T22:13:21.000Z'
    const dependency = createTask({ taskId: 'upstream', title: 'Upstream', now })
    const pending = createTask({ taskId: 'downstream', title: 'Downstream', dependencies: ['upstream'], now })
    assert.equal(pending.state, 'pending')
    assert.throws(() => transitionTask(pending, 'ready', [dependency], now), (error: unknown) => error instanceof ProtocolError && error.code === 'TASK_DEPENDENCY_BLOCKED')
  })

  it('keeps attempts, acceptance, delivery, and replay separate', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'build', title: 'Build', acceptance: ['tests pass'], now: seams.clock() }], seams)
    const started = graph.startTask('build')
    assert.equal(started.status, 'running')
    assert.equal(started.attempts, 1)
    graph.completeTask('build', started.attemptId!, { artifact: 'ok' }, [{ artifactId: 'out', uri: 'memory:out', digest }])
    assert.equal(graph.get('build').stage, 'needs_attention')
    graph.submitTaskResult('build', 'submit-1')
    assert.equal(graph.get('build').stage, 'awaiting_review')
    graph.recordReview('build', {
      reviewId: 'review-1', reviewerId: 'reviewer-1', independent: true, outcome: 'passed',
      report: { passed: true }, findings: [], reviewedAt: seams.clock(),
    })
    graph.acceptTask('build', undefined, 'accept-1')
    graph.deliverTask('build', 'delivery-1')
    assert.equal(graph.get('build').stage, 'delivered')

    const replay = TaskGraph.fromEvents(graph.eventsSince(), seams)
    assert.deepEqual(replay.get('build'), graph.get('build'))
    assert.equal(graph.toJSONL().split('\n').filter(Boolean).length, graph.version)
    assert.deepEqual(replay.eventsSince(), graph.eventsSince())
  })

  it('requires accepted dependency versions and binds them at start', () => {
    const seams = deterministic()
    const graph = new TaskGraph([
      { taskId: 'upstream', title: 'Upstream', acceptance: ['green'], now: seams.clock() },
      { taskId: 'downstream', title: 'Downstream', dependencies: ['upstream'], acceptance: ['green'], now: seams.clock() },
    ], seams)
    assert.deepEqual(graph.ready().map(task => task.taskId), ['upstream'])
    assert.throws(() => graph.startTask('downstream'), (error: unknown) => error instanceof ProtocolError && error.code === 'TASK_DEPENDENCY_BLOCKED')
    accept(graph, 'upstream', 'upstream', seams.clock)
    const started = graph.startTask('downstream')
    assert.equal(started.dependencies[0]?.acceptedSubmissionId !== undefined, true)
    assert.equal(started.dependencies[0]?.acceptedArtifactDigest !== undefined, true)
  })

  it('does not revive a failed attempt; rework creates a new attempt', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'retry', title: 'Retry', now: seams.clock() }], seams)
    const first = graph.startTask('retry')
    graph.failTask('retry', first.attemptId!, new Error('boom'))
    assert.throws(() => graph.startTask('retry'), /not pending/)
    graph.returnForRework('retry', 'fix failure')
    const second = graph.startTask('retry')
    assert.notEqual(second.attemptId, first.attemptId)
    assert.equal(second.attempts, 2)
  })

  it('keeps cancellation request distinct from confirmed stop', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'long', title: 'Long', now: seams.clock() }], seams)
    const started = graph.startTask('long')
    const stopping = graph.requestCancellation('long', 'user requested stop', 'cancel-1')
    assert.equal(stopping.stage, 'stopping')
    assert.equal(stopping.status, 'running')
    assert.equal(graph.confirmCancellation('long', { evidence: { process: 'closed' } }, 'confirm-1').stage, 'stopped')
    assert.throws(() => graph.startTask('long'), /cancelled or deleted/)
    assert.equal(graph.requestCancellation('long', 'user requested stop', 'cancel-1').stage, 'stopping')
    assert.equal(started.attemptId, graph.get('long').attemptId)
  })

  it('enforces CAS revisions and request idempotency', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'cas', title: 'CAS', now: seams.clock() }], seams)
    const initial = graph.get('cas')
    const assigned = graph.assignTask('cas', 'worker', initial.revision, 'assign-1')
    assert.deepEqual(graph.assignTask('cas', 'worker', initial.revision, 'assign-1'), assigned)
    assert.throws(() => graph.assignTask('cas', 'other', initial.revision, 'assign-1'), (error: unknown) => error instanceof ProtocolError && error.code === 'REQUEST_ID_CONFLICT')
    assert.throws(() => graph.startTask('cas', initial.revision), (error: unknown) => error instanceof ProtocolError && error.code === 'TASK_STALE_REVISION')
  })

  it('cleans failed request reservations so an id can be reused', () => {
    const graph = new TaskGraph([{ taskId: 'existing', title: 'Existing' }])
    assert.throws(() => graph.assignTask('missing', 'worker', undefined, 'reusable-request'), (error: unknown) => error instanceof ProtocolError && error.code === 'TASK_NOT_FOUND')
    const added = graph.add({ taskId: 'new', title: 'New' }, 'reusable-request')
    assert.equal(added.taskId, 'new')
  })

  it('rejects unknown and malformed event types at the protocol boundary', () => {
    const event = new TaskGraph([{ taskId: 'event', title: 'Event' }]).eventsSince()[0]!
    assert.throws(() => validateEvent({ ...event, type: 'task.future' as never }), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_EVENT')
    assert.throws(() => validateEvent({ ...event, type: ' task.created ' as never }), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_EVENT')
    assert.throws(() => validateEvent({ ...event, task: undefined as never }), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_EVENT')
  })

  it('rejects forged replay transitions that revive failed work', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'forged', title: 'Forged', now: seams.clock() }], seams)
    const started = graph.startTask('forged')
    graph.failTask('forged', started.attemptId!, new Error('fail'))
    const events = graph.eventsSince()
    const forged = { ...events[events.length - 1]!, sequence: events.length + 1, revision: graph.get('forged').revision + 1, eventId: 'forged-event', task: { ...graph.get('forged'), revision: graph.get('forged').revision + 1, status: 'created', state: 'ready', stage: 'pending' } }
    assert.throws(() => TaskGraph.fromEvents([...events, forged], seams), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_EVENT')
  })

  it('does not let a restored event replace an existing task', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'restore', title: 'Restore', now: seams.clock() }], seams)
    const event = graph.eventsSince()[0]!
    const forged = {
      ...event,
      type: 'task.restored' as const,
      sequence: 2,
      revision: 2,
      eventId: 'forged-restore',
      task: { ...graph.get('restore'), revision: 2, updatedAt: seams.clock() },
    }
    assert.throws(() => TaskGraph.fromEvents([...graph.eventsSince(), forged]), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_EVENT')
  })

  it('validates attempt history, cancellation phases, and submission digests', () => {
    const seams = deterministic()
    const graph = new TaskGraph([{ taskId: 'guarded', title: 'Guarded', now: seams.clock() }], seams)
    const initial = graph.get('guarded')
    const stopping = { ...initial, stage: 'stopping' as const, cancellation: { requestId: 'c', reason: 'stop', requestedAt: seams.clock(), outcome: 'requested' as const } }
    assert.doesNotThrow(() => validateTaskRecord(stopping))
    assert.throws(() => validateTaskRecord({ ...stopping, cancellation: { ...stopping.cancellation, outcome: 'confirmed' as const } }), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_SNAPSHOT')

    const started = graph.startTask('guarded')
    const forged = { ...started, attemptHistory: [{ ...started.attemptHistory[0]!, outcome: 'completed' as const, endedAt: seams.clock() }] }
    assert.throws(() => validateTaskRecord(forged), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_SNAPSHOT')

    graph.completeTask('guarded', started.attemptId!, { ok: true }, [{ artifactId: 'out', uri: 'memory:out' }])
    graph.submitTaskResult('guarded', 'submit')
    const submitted = graph.get('guarded')
    const submission = submitted.submissions[0]!
    const badDigest = { ...submitted, submissions: [{ ...submission, artifactDigest: artifactDigest([]) }] }
    assert.throws(() => validateTaskRecord(badDigest), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_SNAPSHOT')
  })

  it('cancels unstarted tasks without creating an attempt', () => {
    const graph = new TaskGraph([
      { taskId: 'created', title: 'Created' },
      { taskId: 'queued', title: 'Queued', owner: 'lead' },
    ])
    graph.assignTask('queued', 'lead')
    const cancelled = graph.cancelUnstarted('shutdown')
    assert.deepEqual(cancelled.map(task => task.taskId), ['created', 'queued'])
    for (const task of cancelled) {
      assert.equal(task.stage, 'stopped')
      assert.equal(task.attempts, 0)
      assert.equal(task.attemptId, undefined)
      assert.equal(task.cancellation?.outcome, 'confirmed')
    }
  })

  it('does not delete a delivered artifact', () => {
    const graph = new TaskGraph([{ taskId: 'delivered', title: 'Delivered' }])
    const started = graph.startTask('delivered')
    graph.completeTask('delivered', started.attemptId!, true, [{ artifactId: 'out', uri: 'memory:out' }])
    graph.submitTaskResult('delivered', 'submit')
    graph.recordReview('delivered', {
      reviewId: 'review', reviewerId: 'reviewer', independent: true, outcome: 'passed', report: {}, findings: [], reviewedAt: new Date().toISOString(),
    })
    graph.acceptTask('delivered', undefined, 'accept')
    graph.deliverTask('delivered', 'deliver')
    assert.throws(() => graph.deleteTask('delivered'), (error: unknown) => error instanceof ProtocolError && error.code === 'INVALID_TRANSITION')
  })
})

describe('Dispatcher', () => {
  it('honors concurrency and records failures without implicit retry', async () => {
    const graph = new TaskGraph([
      { taskId: 'a', title: 'A' },
      { taskId: 'b', title: 'B' },
    ])
    const dispatcher = new Dispatcher(graph, { maxConcurrent: 1 })
    let active = 0
    let maximum = 0
    const result = await dispatcher.runReady(() => 'worker', async task => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, task.taskId === 'a' ? 5 : 1))
      active--
      if (task.taskId === 'b') throw new Error('failed')
      return { result: { task: task.taskId } }
    })
    assert.equal(maximum, 1)
    assert.deepEqual(result.started, ['a'])
    assert.deepEqual(result.completed, ['a'])
    assert.deepEqual(result.failed, [])
    assert.equal(graph.get('a').stage, 'needs_attention')
  })

  it('marks an executor that exceeds timeout as stop_unknown', async () => {
    const graph = new TaskGraph([{ taskId: 'slow', title: 'Slow' }])
    const dispatcher = new Dispatcher(graph, { timeoutMs: 10 })
    const result = await dispatcher.runReady(() => 'worker', async () => new Promise(resolve => setTimeout(() => resolve({ result: 1 }), 50)))
    assert.deepEqual(result.timedOut, ['slow'])
    assert.equal(graph.get('slow').stage, 'stop_unknown')
    assert.equal(graph.get('slow').status, 'failed')
  })

  it('waits for executor stop evidence and ignores a late result', async () => {
    const graph = new TaskGraph([{ taskId: 'cancel-me', title: 'Cancel me' }])
    const dispatcher = new Dispatcher(graph, { stopGraceMs: 25 })
    let taskStarted: TaskRecord | undefined
    const running = dispatcher.runReady(() => 'worker', async (task, signal) => {
      taskStarted = task
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { result: 'discarded' }
    })
    while (taskStarted === undefined) await new Promise(resolve => setTimeout(resolve, 1))
    graph.requestCancellation('cancel-me', 'user stop', 'cancel-request')
    const result = await running
    assert.deepEqual(result.cancelled, ['cancel-me'])
    assert.equal(graph.get('cancel-me').stage, 'stopped')
    assert.equal(graph.get('cancel-me').result, undefined)

    const lateGraph = new TaskGraph([{ taskId: 'late', title: 'Late' }])
    const lateDispatcher = new Dispatcher(lateGraph, { stopGraceMs: 5 })
    const lateRun = lateDispatcher.runReady(() => 'worker', async () => new Promise(resolve => setTimeout(() => resolve({ result: 'late' }), 35)))
    await new Promise(resolve => setTimeout(resolve, 2))
    lateGraph.requestCancellation('late', 'user stop', 'late-cancel')
    const lateResult = await lateRun
    assert.deepEqual(lateResult.stopUnknown, ['late'])
    const version = lateGraph.version
    await new Promise(resolve => setTimeout(resolve, 45))
    assert.equal(lateGraph.version, version)
    assert.equal(lateGraph.get('late').stage, 'stop_unknown')
  })

  it('does not duplicate a terminal event when cancellation races with executor failure', async () => {
    const graph = new TaskGraph([{ taskId: 'race', title: 'Race' }])
    const dispatcher = new Dispatcher(graph, { stopGraceMs: 25 })
    const run = dispatcher.runReady(() => 'worker', async (_task, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw new Error('aborted')
    })
    await new Promise(resolve => setTimeout(resolve, 2))
    graph.requestCancellation('race', 'user stop', 'race-cancel')
    const result = await run
    assert.deepEqual(result.cancelled, ['race'])
    assert.equal(graph.eventsSince().filter(event => event.taskId === 'race' && ['task.cancelled', 'task.stop_unknown', 'task.failed'].includes(event.type)).length, 1)
  })
})

describe('review, research, and optimization ledgers', () => {
  it('reports insufficient reviewer diversity and de-duplicates findings', () => {
    const review = {
      reviewId: 'r1', reviewerId: 'same', independent: true, outcome: 'passed' as const,
      report: {}, findings: [{ findingId: 'f1', reviewerId: 'same', summary: ' flaky  test ', location: 'x' }], reviewedAt: new Date().toISOString(),
    }
    const summary = summarizeReviews([review, { ...review, reviewId: 'r2', findings: [{ ...review.findings[0]!, findingId: 'f2' }] }])
    assert.equal(summary.status, 'inconclusive')
    assert.equal(summary.findings.length, 1)
  })

  it('normalizes sources and refuses unverified claims', () => {
    assert.equal(normalizeUrl('HTTPS://Example.COM:443/a/?utm_source=x&b=2&a=1#x'), 'https://example.com/a?a=1&b=2')
    const ledger = new ResearchLedger()
    const source = ledger.addSource({ url: 'https://example.com/a', kind: 'primary' })
    ledger.addClaim({ claimId: 'c', statement: 'fact', sourceIds: [source.sourceId], confidence: 'verified' })
    assert.equal(ledger.report().status, 'verified')
    assert.throws(() => ledger.addClaim({ claimId: 'bad', statement: 'unknown', sourceIds: ['missing'], confidence: 'verified' }), /unknown source/)
  })

  it('requires matched real metrics before optimization can stop', () => {
    const ledger = new OptimizationLedger()
    const accepted = ledger.record({
      experimentId: 'e1', hypothesis: 'shorter prompt', workloadId: 'w', changedFactor: 'prompt', rollbackRef: 'git:1',
      baseline: { mode: 'real', score: 1, inputTokens: 100, outputTokens: 20, latencyMs: 4, toolCalls: 2, workloadId: 'w' },
      candidate: { mode: 'real', score: 1, inputTokens: 80, outputTokens: 20, latencyMs: 4, toolCalls: 2, workloadId: 'w' },
    })
    assert.equal(accepted.decision, 'stop')
    const mock = ledger.record({ experimentId: 'e2', hypothesis: 'mock', workloadId: 'w', changedFactor: 'x', rollbackRef: 'git:2', baseline: { mode: 'mock', score: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, toolCalls: 1 }, candidate: { mode: 'mock', score: 1, inputTokens: 0, outputTokens: 1, latencyMs: 1, toolCalls: 1 } })
    assert.equal(mock.decision, 'inconclusive')
    assert.equal(ledger.report().best?.experimentId, 'e1')
  })
})

describe('programming workflow', () => {
  it('stops after a verified draft and does not create a repair call', async () => {
    const phases: string[] = []
    let verified = 0
    const result = await runProgrammingWorkflow('implement a function', {
      generate: async context => { phases.push(context.phase); return { text: context.phase === 'analysis' ? 'analysis' : 'draft', usage: { inputTokens: 10, outputTokens: 5 } } },
      verify: async () => { verified += 1; return { passed: true, feedback: 'tests passed' } },
    }, { planning: 'separate' })
    assert.equal(result.status, 'passed')
    assert.equal(result.attempts, 1)
    assert.deepEqual(phases, ['analysis', 'draft'])
    assert.equal(verified, 1)
    assert.equal(result.usage.totalTokens, 30)
  })

  it('can skip a separate planning turn for directly verifiable tasks', async () => {
    const phases: string[] = []
    const result = await runProgrammingWorkflow('implement a function', {
      generate: async context => { phases.push(context.phase); return { text: 'candidate', usage: { inputTokens: 2, outputTokens: 2 } } },
      verify: async () => ({ passed: true }),
    }, { planning: 'skip' })
    assert.equal(result.status, 'passed')
    assert.deepEqual(phases, ['draft'])
    assert.equal(result.attempts, 1)
  })

  it('selects planning from task shape without dataset-specific rules', () => {
    assert.equal(shouldPlanSeparately('write a function that adds two numbers'), false)
    assert.equal(shouldPlanSeparately('Design the architecture, dependencies, and acceptance criteria for a multi-component migration'), true)
  })

  it('uses automatic planning by default', async () => {
    const phases: string[] = []
    await runProgrammingWorkflow('write a small pure function', {
      generate: async context => { phases.push(context.phase); return { text: 'candidate' } },
      verify: async () => ({ passed: true }),
    })
    assert.deepEqual(phases, ['draft'])
  })

  it('feeds bounded verifier diagnostics into a repair and stops on success', async () => {
    const contexts: { phase: string; feedback?: string; messages: readonly { role: string; content: string }[] }[] = []
    let verifyCount = 0
    const result = await runProgrammingWorkflow('fix the function', {
      generate: async context => { contexts.push({ phase: context.phase, feedback: context.feedback, messages: context.messages }); return { text: `${context.phase}-${context.attempt}`, usage: { inputTokens: 3, outputTokens: 2 } } },
      verify: async () => { verifyCount += 1; return verifyCount === 1 ? { passed: false, repairHint: 'keep the required callable signature', feedback: 'x'.repeat(100) } : { passed: true, evidence: [] } },
    }, { maxRepairAttempts: 2, maxFeedbackChars: 24, planning: 'separate' })
    assert.equal(result.status, 'passed')
    assert.equal(result.attempts, 2)
    assert.equal(verifyCount, 2)
    assert.deepEqual(contexts.map(context => context.phase), ['analysis', 'draft', 'repair'])
    assert.equal(contexts[2]?.feedback?.length, compactFeedback('x'.repeat(100), 24).length)
    assert.ok((contexts[2]?.feedback?.length ?? 0) <= 24)
    assert.equal(contexts[2]?.messages.some(message => message.content === 'draft-1'), true)
    assert.equal(contexts[2]?.messages.filter(message => message.content === 'draft-1').length, 1)
    assert.equal(result.phases[2]?.acceptance?.passed, true)
  })

  it('reports budget exhaustion before starting another model call', async () => {
    let calls = 0
    const result = await runProgrammingWorkflow('bounded task', {
      generate: async () => { calls += 1; return { text: 'x', usage: { inputTokens: 6, outputTokens: 5 } } },
      verify: async () => ({ passed: false, feedback: 'retry' }),
    }, { budget: { maxTotalTokens: 10 }, maxRepairAttempts: 2, planning: 'separate' })
    assert.equal(result.status, 'budget_exhausted')
    assert.equal(calls, 1)
    assert.equal(result.attempts, 0)
  })

  it('stops repeated verifier feedback instead of wasting repair calls', async () => {
    let calls = 0
    const result = await runProgrammingWorkflow('stalled task', {
      generate: async context => { calls += 1; return { text: `${context.phase}-${calls}` } },
      verify: async () => ({ passed: false, repairHint: 'required signature: f(x)', feedback: 'same failure' }),
    }, { planning: 'skip', maxRepairAttempts: 5 })
    assert.equal(result.status, 'failed')
    assert.equal(calls, 2)
    assert.equal(result.attempts, 2)
  })

  it('passes remaining timeout to the host and stops admission after the deadline', async () => {
    const timeouts: number[] = []
    let calls = 0
    const result = await runProgrammingWorkflow('deadline task', {
      generate: async context => { calls += 1; timeouts.push(context.remainingBudget.timeoutMs ?? -1); return { text: context.phase, usage: { inputTokens: 1, outputTokens: 1 } } },
      verify: async () => ({ passed: false, feedback: 'retry' }),
    }, { budget: { timeoutMs: 1_000 }, maxRepairAttempts: 2, planning: 'separate' })
    assert.equal(result.status, 'failed')
    assert.equal(calls, 3)
    assert.ok(timeouts.every(timeout => timeout >= 0 && timeout <= 1_000))
  })

  it('aborts a host callback that exceeds the workflow deadline', async () => {
    let aborted = false
    const result = await runProgrammingWorkflow('hanging task', {
      generate: async ({ signal }) => await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ text: 'late' }) }, { once: true })),
      verify: async () => ({ passed: true }),
    }, { budget: { timeoutMs: 10 } })
    assert.equal(result.status, 'budget_exhausted')
    assert.equal(aborted, true)
  })
})

describe('multi-turn conversation workflow', () => {
  it('bounds history while preserving the first and latest messages', async () => {
    const contexts: readonly { role: string; content: string }[][] = []
    const result = await runConversationWorkflow(['first task', 'second task', 'third task'], {
      generate: async context => { contexts.push([...context.messages]); return { text: `answer-${context.turn} `.repeat(30), usage: { inputTokens: 1, outputTokens: 1 } } },
    }, { maxHistoryChars: 128 })
    assert.equal(result.generations.length, 3)
    assert.equal(contexts[2]?.[0]?.content, 'first task')
    assert.equal(contexts[2]?.at(-1)?.content, 'third task')
    assert.equal(contexts[2]?.some(message => message.role === 'assistant' && message.content.startsWith('answer-2')), true)
    assert.equal(contexts[2]?.some(message => message.content.includes('omitted')), true)
    assert.ok(contexts[2]?.every(message => message.content.length > 0))
    assert.equal(contexts[2]?.filter(message => message.content.includes('omitted')).length, 1)
    assert.ok(result.messages.reduce((sum, message) => sum + message.content.length, 0) <= 128)
    assert.ok(result.messages.every(message => message.content.length > 0))
  })

  it('can avoid retaining every generation for long-running sessions', async () => {
    const result = await runConversationWorkflow(['first', 'second'], {
      generate: async ({ turn }) => ({ text: `answer-${turn}` }),
    }, { retainGenerations: false })
    assert.deepEqual(result.generations, [])
    assert.equal(result.usage.totalTokens, 0)
  })

  it('never drops the task text before old assistant history', async () => {
    const task = 'task '.repeat(20).trim()
    const contexts: readonly { role: string; content: string }[][] = []
    await runConversationWorkflow([task, 'follow up'], {
      generate: async context => { contexts.push([...context.messages]); return { text: 'ok' } },
    }, { maxHistoryChars: 128 })
    assert.equal(contexts[1]?.find(message => message.role === 'user')?.content, task)
  })
})

describe('evaluation release gate', () => {
  it('requires both quality uplift and efficiency reduction', () => {
    const accepted = evaluateReleaseGate({ successRate: 0.8, totalTokens: 100, latencyMs: 10 }, { successRate: 0.92, totalTokens: 80, latencyMs: 8 })
    assert.equal(accepted.accepted, true)
    const flatQuality = evaluateReleaseGate({ successRate: 1, totalTokens: 100, latencyMs: 10 }, { successRate: 1, totalTokens: 50, latencyMs: 5 })
    assert.equal(flatQuality.accepted, false)
    assert.equal(flatQuality.checks.accuracyUplift, false)
  })

  it('aggregates independent matched runs before release decisions', () => {
    const aggregate = aggregateEvaluationRuns([
      { baseline: { successRate: 0.8, totalTokens: 100, latencyMs: 10 }, candidate: { successRate: 0.9, totalTokens: 80, latencyMs: 8 } },
      { baseline: { successRate: 0.6, totalTokens: 120, latencyMs: 12 }, candidate: { successRate: 0.8, totalTokens: 90, latencyMs: 9 } },
    ])
    assert.equal(aggregate.runs, 2)
    assert.equal(aggregate.baseline.successRate, 0.7)
    assert.equal(aggregate.tokenReduction, 0.22727272727272727)
    assert.ok(Math.abs(aggregate.deltas.successRate - 0.15) < 1e-12)
  })
})

describe('Cordis programming settings', () => {
  it('resolves bounded workflow defaults without changing legacy graph defaults', () => {
    const config = resolveConfig({ maxRepairAttempts: 1, maxFeedbackChars: 128, maxTotalTokens: 100 })
    assert.equal(config.maxRepairAttempts, 1)
    assert.equal(config.maxFeedbackChars, 128)
    assert.equal(config.programmingBudget.maxTotalTokens, 100)
    assert.equal(config.maxTasks, 256)
    assert.equal(config.planning, 'auto')
    assert.equal(config.stopOnRepeatedFeedback, true)
  })

  it('merges service settings with per-call workflow overrides', async () => {
    const ctx = new (await import('@deepseek-ai/cordis')).Context()
    const service = new SuperAgentService(ctx, { maxRepairAttempts: 1, maxFeedbackChars: 64, maxTotalTokens: 20, planning: 'separate' })
    let calls = 0
    const result = await service.programmingWorkflow('settings task', {
      generate: async context => { calls += 1; assert.equal(context.remainingBudget.maxTotalTokens, calls === 1 ? 20 : 18); return { text: context.phase, usage: { inputTokens: 1, outputTokens: 1 } } },
      verify: async () => ({ passed: true }),
    }, { maxFeedbackChars: 32 })
    assert.equal(result.status, 'passed')
    assert.equal(calls, 2)
  })
})
