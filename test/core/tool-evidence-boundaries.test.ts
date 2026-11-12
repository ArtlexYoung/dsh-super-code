import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { listToolEvidence, readToolEvidence, toolEvidenceRef } from '../../src/core/tool-evidence.js'

function journal(argumentsText: string, texts: string[], direct = false) {
  const content = texts.map(text => ({ type: 'text', text }))
  const events = [
    { seq: 0, time: 1, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call', name: 'bash', arguments: argumentsText } },
    { seq: 1, time: 2, type: 'tool/result', data: { turn: 1, step: 1, message: direct
      ? { role: 'tool', toolCallId: 'call', content }
      : { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call', content }] } } },
  ] as SessionEvent[]
  return { events, at: (seq: number) => events[seq], ref: toolEvidenceRef({ sessionId: '中文:目录/😀', callSeq: 0, resultSeq: 1 }) }
}

for (const limit of [240, 2000]) test(`tool argument preview at ${limit} code units keeps complete Unicode characters`, async () => {
  for (const character of ['😀', '𠮷']) for (const prefix of [limit - 2, limit - 1, limit]) {
    const raw = 'x'.repeat(prefix) + character + 'tail'
    const { events, at, ref } = journal(raw, ['result'])
    const before = JSON.stringify(events)
    const preview = limit === 240
      ? (await listToolEvidence(events.length, events.length, at, new AbortController().signal)).records.find(row => row.type === 'call')
      : readToolEvidence('中文:目录/😀', ref, at)
    assert.ok(preview)
    // Only a prefix is a preview: characters after the first excluded point cannot fill its spare unit.
    const prefixPoints: string[] = []
    let used = 0
    for (const point of raw) { if (used + point.length > limit) break; prefixPoints.push(point); used += point.length }
    assert.equal('arguments' in preview && preview.arguments, prefixPoints.join(''))
    assert.equal('truncated' in preview && preview.truncated, true)
    assert.equal(JSON.stringify(events), before)
  }
})

for (const direct of [false, true]) test(`Unicode evidence pages match a joined-text reference with ${direct ? 'direct' : 'nested'} results`, () => {
  for (const shift of [0, 1, 2, 31, 239, 1999, 2999, 7999]) {
    const texts = ['', 'x'.repeat(shift) + '中😀𠮷\n'.repeat(1700), '', '末尾检查失败 [exit code: 1]', '']
    const expected = texts.join('\n'), { events, at, ref } = journal('command', texts, direct)
    const before = JSON.stringify(events)
    let offset = 0, assembled = '', pages = 0
    do {
      const page = readToolEvidence('中文:目录/😀', ref, at, offset)
      assert.ok(page.kind === 'recorded')
      const points: string[] = []
      let used = 0
      for (const point of expected.slice(offset)) { if (used + point.length > 8000) break; points.push(point); used += point.length }
      assert.equal(page.output, points.join(''))
      assert.equal(page.outputChars, expected.length)
      assert.equal(page.acceptance, 'not-established')
      assert.ok(++pages < 20)
      assembled += page.output
      if (!page.readMore) break
      assert.equal(page.readMore.record.offset, offset + page.output.length)
      offset = page.readMore.record.offset
    } while (true)
    assert.equal(assembled, expected)
    assert.equal(JSON.stringify(events), before)
    const pairOffset = expected.indexOf('😀') + 1
    assert.equal(readToolEvidence('中文:目录/😀', ref, at, pairOffset).kind, 'unavailable')
  }
})
