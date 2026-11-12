import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { deletionNoticeMatches, revokeDeletionNotices } from '../../src/dsh/preset-recovery-runtime.js'

const active = 'dsh-super-code/deletion-protection'
const revoked = 'dsh-super-code/deletion-protection-revoked'
const rule = 'Use recoverable trash; preserve user work.'
function make(id: string, seed: ReturnType<Session['snapshotEvents']> = []) {
  return Session.create(SessionId(id), seed, { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: seed.length > 0 }, seed.length)
}
function append(session: Session, kind: 'user' | typeof active, text: string) {
  return session.append('user/message', createUserMessage({ source: { kind }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
}
function observed(session: Session) {
  let reads = 0
  const proxy = new Proxy(session, { get(target, property) {
    if (property === 'surface') reads++
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return { proxy, reads: () => reads }
}

for (const state of ['empty', 'ordinary', 'revoked', 'summarized-revocation'] as const) test(`policy retirement avoids surface traversal for ${state} history and still notices a later rule`, () => {
  const source = make('source-' + state)
  if (state !== 'empty') for (let i = 0; i < 32; i++) append(source, 'user', `User decision ${i}; ${rule}`)
  if (state === 'revoked' || state === 'summarized-revocation') {
    const policy = append(source, active, rule)
    revokeDeletionNotices(source, createUserMessage)
    if (state === 'summarized-revocation') source.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'summary' },
      content: [{ type: 'text', text: 'User decisions retained; earlier policy revoked.' }] }), {
      surfaceOp: { op: 'replace', startSeq: source.snapshotEvents().at(-1)!.seq, endSeq: source.snapshotEvents().at(-1)!.seq }, sourceEventSeqs: [policy.seq, source.snapshotEvents().at(-1)!.seq],
    })
  }
  const cold = Session.create(source.id, source.snapshotEvents(), source.header), f = observed(cold), before = cold.snapshotEvents()
  for (let i = 0; i < 3; i++) revokeDeletionNotices(f.proxy, createUserMessage)
  assert.equal(f.reads(), 0, 'no pending producer-owned policy needs a surface lookup')
  assert.deepEqual(cold.snapshotEvents(), before)
  const user = append(cold, 'user', 'Keep this explicit user instruction: ' + rule)
  revokeDeletionNotices(f.proxy, createUserMessage)
  assert.equal(f.reads(), 0, 'new unrelated events do not require a surface lookup')
  const later = append(cold, active, rule)
  assert.equal(deletionNoticeMatches(f.proxy, rule), true)
  revokeDeletionNotices(f.proxy, createUserMessage)
  assert.equal(f.reads(), 1, 'a newly enabled rule still takes the native replacement path')
  assert.deepEqual(cold.snapshotEvents().at(-1)?.sourceEventSeqs, [later.seq])
  assert.ok(cold.surface.nodes.includes(user.seq))
  assert.equal(deletionNoticeMatches(f.proxy, rule), false)
  const settled = cold.snapshotEvents()
  revokeDeletionNotices(f.proxy, createUserMessage)
  assert.equal(f.reads(), 1)
  assert.deepEqual(cold.snapshotEvents(), settled)
})

for (const inherited of [false, true]) test(`mixed visible and compacted policies retain user history across ${inherited ? 'fork' : 'cold'} replay`, () => {
  const source = make('mixed-source')
  const user = append(source, 'user', 'User rule remains: ' + rule)
  const summarized = append(source, active, rule)
  const summary = source.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'summary' },
    content: [{ type: 'text', text: 'User decisions and prior policy: ' + rule }] }), {
    surfaceOp: { op: 'replace', startSeq: summarized.seq, endSeq: summarized.seq }, sourceEventSeqs: [summarized.seq],
  })
  const visible = append(source, active, rule)
  const cold = inherited ? make('mixed-child', source.snapshotEvents()) : Session.create(source.id, source.snapshotEvents(), source.header)
  const before = cold.snapshotEvents(), f = observed(cold)
  revokeDeletionNotices(f.proxy, createUserMessage)
  assert.equal(f.reads(), 1)
  assert.deepEqual(cold.snapshotEvents().slice(0, before.length), before)
  assert.ok(cold.surface.nodes.includes(user.seq))
  assert.ok(cold.surface.nodes.includes(summary.seq))
  assert.ok(!cold.surface.nodes.includes(visible.seq))
  assert.equal(cold.deriveMessages().filter(message => message.source.kind === revoked).length, 2)
  const confirmations = cold.snapshotEvents().slice(before.length).flatMap(event => event.sourceEventSeqs ?? [])
  assert.deepEqual(confirmations.toSorted(), [summarized.seq, visible.seq].toSorted())
  const replay = Session.fromRestore(cold.id, cold.snapshotEvents(), cold.header, cold.inheritedEventCount, 'shared-frozen'), next = observed(replay), size = replay.seq
  revokeDeletionNotices(next.proxy, createUserMessage)
  assert.equal(next.reads(), 0)
  assert.equal(replay.seq, size)
})
