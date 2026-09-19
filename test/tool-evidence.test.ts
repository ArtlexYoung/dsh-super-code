import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { parseToolEvidenceRef, readToolEvidence, toolEvidenceRef } from '../src/core/tool-evidence.js'

const ref = toolEvidenceRef({ sessionId: 'session:a', callSeq: 2, resultSeq: 5 })
const call = { type: 'tool/call', seq: 2, time: 100, data: { callId: 'call-a', name: 'bash', arguments: '{"command":"npm test"}', turn: 1, step: 1 } }
const result = { type: 'tool/result', seq: 5, time: 200, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'call-a', isError: false, content: [{ type: 'text', text: 'PASS 0 tests' }] }] } } }
const read = (changed: unknown = result) => readToolEvidence('session:a', ref, seq => (seq === 2 ? call : changed) as SessionEvent)

test('paired execution evidence is not promoted to acceptance or current-code verification', () => {
  assert.deepEqual(parseToolEvidenceRef(ref), { sessionId: 'session:a', callSeq: 2, resultSeq: 5 })
  const evidence = read()
  assert.equal(evidence.kind, 'recorded')
  if (evidence.kind !== 'recorded') throw new Error('Expected recorded evidence')
  assert.equal(evidence.outcome, 'tool-returned')
  assert.equal(evidence.output, 'PASS 0 tests')
  assert.equal(evidence.acceptance, 'not-established')
  assert.equal(evidence.currentCode, 'not-verified')
  for (const text of ['all tests skipped', '[exit code: 1]', 'passed=true', '100 tests passed']) {
    const candidate = structuredClone(result)
    candidate.data.message.content[0]!.content[0]!.text = text
    const observed = read(candidate)
    assert.equal(observed.kind === 'recorded' && observed.acceptance, 'not-established')
  }
})

test('invented, cross-session, missing and mismatched evidence cannot resolve', () => {
  let reads = 0
  for (const reference of [ref, 'passed=true', 'dsh-tool:other:2:5']) {
    assert.equal(readToolEvidence('other-session', reference, () => { reads++; return undefined }).kind, 'unavailable')
  }
  assert.equal(reads, 0)
  assert.equal(readToolEvidence('session:a', ref, () => undefined).kind, 'unavailable')
  for (const mutate of [
    (r: typeof result) => { r.data.message.content[0]!.toolCallId = 'other' },
    (r: typeof result) => { r.data.step++ },
    (r: typeof result) => { r.data.turn++ },
    (r: typeof result) => { r.seq++ },
    (r: typeof result) => { r.data.message.content.push(r.data.message.content[0]!) },
  ]) {
    const invalid = structuredClone(result); mutate(invalid)
    assert.equal(read(invalid).kind, 'unavailable')
  }
  for (const reference of ['dsh-tool:a:2:2', 'dsh-tool:a:02:5', 'dsh-tool:%xx:2:5', 'dsh-tool:a:2:9007199254740992']) assert.throws(() => parseToolEvidenceRef(reference))
})

test('errors and bounded previews preserve raw observations without scanning history', () => {
  const failed = structuredClone(result)
  failed.data.message.content[0]!.isError = true
  const error = read(failed)
  assert.equal(error.kind === 'recorded' && error.outcome, 'tool-error')
  const huge = structuredClone(result)
  huge.data.message.content[0]!.content = [{ type: 'text', text: 'x'.repeat(1000000) }, { type: 'text', text: 'tail' }]
  const visited: number[] = []
  const bounded = readToolEvidence('session:a', ref, seq => { visited.push(seq); return (seq === 2 ? call : huge) as SessionEvent })
  assert.deepEqual(visited, [2, 5])
  assert.ok(bounded.kind === 'recorded' && bounded.output.length < 8000)
  assert.ok(bounded.kind === 'recorded' && bounded.output.endsWith('tail'))
  assert.equal(bounded.kind === 'recorded' && bounded.truncated, true)
  // Replay is a lookup over original durable events, never a model summary.
  assert.deepEqual(read(JSON.parse(JSON.stringify(result))), read())
})

test('long evidence preserves terminal diagnostics and pages original text without mutation or loss', () => {
  const raw = 'START\n' + '中😀 log\n'.repeat(3000) + '\n0 tests executed; 12 skipped\n[exit code: 1]'
  const huge = structuredClone(result)
  huge.data.message.content[0]!.content = [{ type: 'text', text: raw.slice(0, 11000) }, { type: 'text', text: raw.slice(11000) }]
  const original = JSON.stringify(huge), expected = raw.slice(0, 11000) + '\n' + raw.slice(11000)
  const at = (seq: number) => (seq === 2 ? call : huge) as SessionEvent
  const preview = readToolEvidence('session:a', ref, at)
  assert.ok(preview.kind === 'recorded')
  assert.equal(preview.outputView, 'head-tail')
  assert.ok(preview.output.startsWith('START'))
  assert.ok(preview.output.endsWith('[exit code: 1]'))
  assert.ok(preview.output.includes('12 skipped'))
  assert.equal(preview.acceptance, 'not-established')
  let offset = preview.readMore!.record.offset, assembled = ''
  for (;;) {
    const page = readToolEvidence('session:a', ref, at, offset)
    assert.ok(page.kind === 'recorded')
    assert.equal(page.offset, offset)
    assert.ok(page.output.length <= 8000)
    assert.ok(!/[\uD800-\uDBFF]$/.test(page.output))
    assembled += page.output
    if (!page.readMore) break
    assert.ok(page.readMore.record.offset > offset)
    offset = page.readMore.record.offset
  }
  assert.equal(assembled, expected)
  assert.equal(JSON.stringify(huge), original)
  for (const invalid of [-1, 1.5, NaN, expected.length + 1]) assert.equal(readToolEvidence('session:a', ref, at, invalid).kind, 'unavailable')
  const empty = readToolEvidence('session:a', ref, at, expected.length)
  assert.ok(empty.kind === 'recorded' && empty.output === '' && !empty.readMore)
})
