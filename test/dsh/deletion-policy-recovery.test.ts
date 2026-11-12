import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { revokeDeletionNotices } from '../../src/dsh/preset-recovery-runtime.js'

const rule = '删除文件或目录默认用 trash <path>（可恢复）；Use trash <path> by default.'
const active = 'dsh-super-code/deletion-protection'
const revoked = 'dsh-super-code/deletion-protection-revoked'
function session() {
  const id = SessionId('minimal-recovery')
  const result = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  result.append('turn/start', { turn: 1 })
  result.append('step/start', { turn: 1, step: 1 })
  result.append('system/message', { turn: 1, step: 1, message: createSystemMessage('OFFICIAL MINIMAL', 'fixture') }, { surfaceOp: 'append' })
  return result
}
function policy(s: Session) {
  return s.append('user/message', createUserMessage({ source: { kind: active }, content: [{ type: 'text', text: rule }] }), { surfaceOp: 'append' })
}

test('native replacement revokes owned rules while preserving user text, other producers and raw history', () => {
  const s = session()
  s.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: rule }] }), { surfaceOp: 'append' })
  s.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'other-plugin' }, content: [{ type: 'text', text: rule }] }), { surfaceOp: 'append' })
  const owned = policy(s), before = s.snapshotEvents()
  revokeDeletionNotices(s, createUserMessage)
  assert.deepEqual(s.snapshotEvents().slice(0, before.length), before)
  assert.equal(s.deriveMessages().filter(m => JSON.stringify(m.content).includes('Use trash')).length, 2)
  assert.equal(s.deriveMessages().filter(m => m.source.kind === active).length, 0)
  assert.equal(s.deriveMessages().filter(m => m.source.kind === revoked).length, 1)
  assert.match(JSON.stringify(s.deriveMessages()), /OFFICIAL MINIMAL/)
  const replacement = s.snapshotEvents().at(-1)!
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: owned.seq, endSeq: owned.seq })
  assert.deepEqual(replacement.sourceEventSeqs, [owned.seq])
  assert.doesNotMatch(JSON.stringify(replacement.data), /trash|\brm\b/)
})

test('multiple notices are revoked once, stay revoked after replay, and a later enabled rule can be revoked again', () => {
  const s = session()
  policy(s); policy(s)
  revokeDeletionNotices(s, createUserMessage)
  const size = s.seq
  revokeDeletionNotices(s, createUserMessage)
  assert.equal(s.seq, size)
  const cold = Session.create(s.id, s.snapshotEvents(), s.header), coldSize = cold.seq
  revokeDeletionNotices(cold, createUserMessage)
  assert.equal(cold.seq, coldSize)
  const reenabled = policy(cold)
  assert.equal(cold.deriveMessages().filter(m => m.source.kind === active).length, 1)
  revokeDeletionNotices(cold, createUserMessage)
  assert.equal(cold.seq, coldSize + 2)
  assert.equal(cold.deriveMessages().filter(m => m.source.kind === active).length, 0)
  assert.deepEqual(cold.snapshotEvents().at(-1)?.sourceEventSeqs, [reenabled.seq])
})

test('already summarized owned instructions receive an explicit revocation without discarding the summary', () => {
  const s = session(), owned = policy(s)
  const summary = createUserMessage({ source: { kind: 'plugin', plugin: 'summary-fixture' },
    content: [{ type: 'text', text: 'Important user decisions; previous policy: ' + rule }] })
  const checkpoint = s.append('user/message', summary, {
    surfaceOp: { op: 'replace', startSeq: owned.seq, endSeq: owned.seq }, sourceEventSeqs: [owned.seq],
  })
  const before = s.snapshotEvents()
  revokeDeletionNotices(s, createUserMessage)
  assert.deepEqual(s.snapshotEvents().slice(0, before.length), before)
  assert.ok(s.surface.nodes.includes(checkpoint.seq))
  assert.equal(s.deriveMessages().at(-1)?.source.kind, revoked)
  assert.match(JSON.stringify(s.deriveMessages().at(-1)), /no longer apply/)
  assert.deepEqual(s.snapshotEvents().at(-1)?.sourceEventSeqs, [owned.seq])
  const revokedEvent = s.snapshotEvents().at(-1)!
  s.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'summary-fixture' }, content: [{ type: 'text', text: 'Policy revoked; user decisions retained.' }] }), {
    surfaceOp: { op: 'replace', startSeq: checkpoint.seq, endSeq: revokedEvent.seq }, sourceEventSeqs: [checkpoint.seq, revokedEvent.seq],
  })
  const cold = Session.create(s.id, s.snapshotEvents(), s.header), size = cold.seq
  revokeDeletionNotices(cold, createUserMessage)
  assert.equal(cold.seq, size, 'a summarized revocation must not be appended repeatedly')
})

test('unrelated summaries and matching prose without owned provenance remain untouched', () => {
  const s = session()
  s.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: rule }] }), { surfaceOp: 'append' })
  const before = s.snapshotEvents()
  revokeDeletionNotices(s, createUserMessage)
  assert.deepEqual(s.snapshotEvents(), before)
})
