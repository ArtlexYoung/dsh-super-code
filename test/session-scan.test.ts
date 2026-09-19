import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { scanSessionPage } from '../src/core/session-scan.js'
import { listToolEvidence, readToolEvidence, toolEvidenceRef } from '../src/core/tool-evidence.js'

test('sparse scans yield, remain bounded, and resume without skipping events', async () => {
  const visited: number[] = []
  const read = (seq: number) => { visited.push(seq); return undefined }
  const signal = new AbortController().signal
  const first = await scanSessionPage(5000, 5000, read, () => false, signal)
  assert.deepEqual(first, { nextBeforeSeq: 904, done: false, scanned: 4096 })
  const second = await scanSessionPage(5000, first.nextBeforeSeq, read, () => false, signal)
  assert.equal(second.done, true)
  assert.deepEqual(visited, Array.from({ length: 5000 }, (_, i) => 4999 - i))
  for (const cursor of [-1, 5001, NaN, 1.5]) await assert.rejects(scanSessionPage(5000, cursor, read, () => false, signal), /cursor/)
  const controller = new AbortController()
  let reads = 0
  setImmediate(() => controller.abort())
  await assert.rejects(scanSessionPage(5000, 5000, () => { reads++; return undefined }, () => false, controller.signal), /abort/i)
  assert.ok(reads <= 256)
})

test('evidence directories expose exact identities across pages without guessing a parallel pair', async () => {
  const events = new Map<number, SessionEvent>()
  for (let i = 0; i < 8; i++) {
    events.set(i, { type: 'tool/call', seq: i, time: i, data: { callId: `c${i}`, name: 'bash', arguments: `command-${i}`, turn: 1, step: 1 } } as SessionEvent)
    events.set(i + 8, { type: 'tool/result', seq: i + 8, time: i + 8, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: `c${i}`, content: [{ type: 'text', text: 'PASS 0 tests' }] }] } } } as SessionEvent)
  }
  const read = (seq: number) => events.get(seq)
  const signal = new AbortController().signal
  const first = await listToolEvidence(16, 16, read, signal)
  assert.equal(first.records.length, 12)
  assert.equal(first.done, false)
  const second = await listToolEvidence(16, first.nextBeforeSeq, read, signal)
  const all = [...first.records, ...second.records]
  const call = all.find(r => r.type === 'call' && r.arguments === 'command-0')!
  const result = all.find(r => r.type === 'result' && r.callId === call.callId)!
  const ref = toolEvidenceRef({ sessionId: 's', callSeq: call.seq, resultSeq: result.seq })
  const evidence = readToolEvidence('s', ref, read)
  assert.equal(evidence.kind === 'recorded' && evidence.acceptance, 'not-established')
  assert.equal(new Set(all.map(r => r.seq)).size, 16)
})
