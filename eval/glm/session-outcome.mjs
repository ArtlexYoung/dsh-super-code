/** Local evaluation boundary: provider errors are not candidate answers. */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { requestsFromEvents as observedRequests } from './request-accounting.mjs'

export function attemptFailure(event) {
  if (!['assistant/attempt', 'assistant/message'].includes(event.type)) return false
  const finish = (event.data?.stream ?? []).map(record => record.chunk ?? record)
    .findLast(chunk => chunk.type === 'finish')
  const reason = finish?.reason
  if (reason?.kind !== 'error') return false
  return { seq: event.seq, code: reason.failure?.code ?? 'UNKNOWN',
    message: String(reason.failure?.message ?? 'provider request failed') }
}

export function failureCategory(failure) {
  const text = String(failure.message ?? '').toLowerCase()
  if (['AUTH', 'AUTHENTICATION', 'PERMISSION'].includes(failure.code)
      || /403001|permission_error|package is disabled|invocation permission|api.?key.*invalid|invalid.*api.?key/.test(text)) {
    return 'account-unavailable'
  }
  if (['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'NETWORK'].includes(failure.code)
      || /tpm limit|rate.?limit|request rate exceeds|too many requests|\b(?:429|500|502|503|504)\b|connection|timed out|timeout|fetch failed|econn|etimedout/.test(text)) {
    return 'provider-unavailable'
  }
  return 'model-error'
}

export function outcomeFromEvents(events, { timeBudgetExhausted = false } = {}) {
  const attempts = events.filter(event => ['assistant/attempt', 'assistant/message'].includes(event.type))
  const failed = attempts.map(attemptFailure).filter(Boolean)
  const last = attempts.at(-1)
  const terminal = last === undefined ? false : attemptFailure(last)
  const turn = events.filter(event => event.type === 'turn/end').at(-1)
  const turnFailure = turn?.data?.reason?.kind === 'error'
    ? { seq: turn.seq, ...turn.data.reason.error } : false
  const failure = terminal || turnFailure
  if (failure) return { schema: 1, status: 'failed', category: failureCategory(failure),
    failure, failed_requests: failed.length, excluded_request_seqs: failed.map(item => item.seq) }
  if (last === undefined && !timeBudgetExhausted) return { schema: 1, status: 'failed',
    category: 'provider-unavailable', failure: { code: 'NO_RESPONSE', message: 'persisted session has no model response' },
    failed_requests: failed.length, excluded_request_seqs: failed.map(item => item.seq) }
  return { schema: 1, status: 'completed', failed_requests: failed.length,
    excluded_request_seqs: failed.map(item => item.seq) }
}

export function requestsFromEvents(events) {
  return observedRequests(events.filter(event => !attemptFailure(event)))
}

export async function readSessionEvents(path) {
  const child = spawn('zstd', ['-q', '-dc', path], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`session decode failed (${code}): ${stderr}`)))
  })
  const events = []
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (line.trim()) events.push(JSON.parse(line))
    }
    await completed
  } catch (error) {
    child.kill()
    await completed.catch(() => {})
    throw error
  }
  return events
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await readSessionEvents(process.argv[2])
  const outcome = outcomeFromEvents(events, { timeBudgetExhausted: process.argv[3] === 'timeout' })
  process.stdout.write(JSON.stringify(outcome) + '\n')
}
