import { outcomeFromEvents as sharedOutcome, attemptFailure, failureCategory } from './session-outcome.mjs'
export { readSessionEvents } from './session-outcome.mjs'

export function mechanismCoverage(events, kind) {
  const calls = events.filter(e => e.type === 'tool/call' || e.type === 'tool/ptc-dispatch')
  const names = ['context_read', 'context_search', 'context_expand', 'context_explore']
  const contextCalls = Object.fromEntries(names.map(name => [name, calls.filter(e => e.data?.name === name).length]))
  const explorationRecords = events.filter(e => e.type === 'user/message' && e.data?.source?.plugin === 'dsh-super-code/context-exploration/v1').length
  // Installation hashes + paid-launch boot/acceptance gates establish presence.
  // Tools are optional: zero use is data, never a failed solution.
  return { kind, contextCalls, explorationRecords, optional: true, entryPresent: true }
}

export function outcomeFromEvents(events, options = {}) {
  const outcome = sharedOutcome(events, options)
  const failures = events.map(attemptFailure).filter(Boolean)
  const protocol = failures.find(f => f.code === 'INVALID_REQUEST' || /\b400\b|tool.?call.*(?:pair|result)|invalid.*(?:message|request)/i.test(f.message))
  if (protocol) return { ...outcome, status: 'failed', category: 'request-protocol-error', failure: protocol, pauseCandidate: true }
  const mechanism = mechanismCoverage(events, options.kind ?? 'budget')
  // TRANSPORT is a provider boundary even when its message lacks a known
  // network phrase. It must not consume a task as a failed solution.
  if (outcome.status === 'failed' && outcome.failure?.code === 'TRANSPORT') {
    return { ...outcome, category: 'provider-unavailable', mechanism }
  }
  const attempts = events.filter(e => ['assistant/attempt', 'assistant/message'].includes(e.type))
  const last = attempts.at(-1)
  const finish = (last?.data?.stream ?? []).map(record => record.chunk ?? record)
    .findLast(chunk => chunk.type === 'finish')
  const providerFailures = failures.filter(f => f.code === 'TRANSPORT' || failureCategory(f) === 'provider-unavailable')
  // A cancelled, unfinished provider response cannot prove completion or
  // missing graph entry. A completed response after recovered retries, and a
  // solver-only deadline, retain the existing scoring policy.
  if (outcome.status === 'completed' && options.timeBudgetExhausted && finish === undefined && providerFailures.length > 0) {
    return { ...outcome, status: 'failed', category: 'provider-unavailable',
      failure: providerFailures.at(-1), providerInterruptedAtDeadline: true, mechanism }
  }
  if (outcome.status === 'completed' && !mechanism.entryPresent) return { ...outcome, status: 'failed', category: 'mechanism-missing', pauseCandidate: true, mechanism }
  return { ...outcome, mechanism }
}
