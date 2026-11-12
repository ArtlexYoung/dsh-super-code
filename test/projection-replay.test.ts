import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { taskFeedbackProjection as feedback } from '../src/task-feedback-projection.js'
import { memoryUsageProjection as memory } from '../src/memory-usage-projection.js'

/** Cross several independent windows in one journal, including unfinished calls at checkpoint boundaries. */
function journal(modern: boolean) {
  const events: SessionEvent[] = [], cuts = new Set([0])
  const add = (type: string, data: object) => {
    events.push({ seq: events.length, time: events.length, type, data } as SessionEvent)
    if (events.length % 37 === 0) cuts.add(events.length)
  }
  const mark = () => cuts.add(events.length)
  const user = (text: string) => add('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const call = (id: string, name: string, args: object, step = 1) => add('tool/call', {
    turn: 1, step, callId: id, name, arguments: JSON.stringify(args),
  })
  const result = (id: string, value: object, step = 1) => {
    const content = [{ type: 'text', text: JSON.stringify(value) }]
    add('tool/result', { turn: 1, step, message: modern ? { role: 'tool', toolCallId: id, content }
      : { content: [{ type: 'tool-result', toolCallId: id, content }] } })
  }
  user('继承的请求')
  call('prefix', 'write', { path: 'inherited.ts' }); result('prefix', {})
  const inherited = events.length
  mark()
  add('turn/start', { turn: 1 }); user('当前任务😀')
  add('todo/write', { todos: Array.from({ length: 202 }, (_, i) => ({ content: `步骤 ${i}`, status: 'pending' })) })
  mark()
  for (let i = 0; i < 70; i++) {
    call(`parallel-${i}`, 'write', { path: `parallel-${i}.ts` })
    if ([63, 64].includes(i)) mark()
  }
  mark()
  for (let i = 69; i >= 0; i--) result(`parallel-${i}`, {})
  mark()
  for (let i = 0; i < 160; i++) {
    call('reused-file', 'write', { path: `最终 文件-${i}.ts` }, i + 2)
    if (i === 159) mark()
    result('reused-file', {}, i + 2)
  }
  mark()
  for (let i = 0; i < 68; i++) {
    call(`memory-${i}`, 'super_code_memory', { action: 'read', id: `parallel-${i}` }, 162)
    if ([63, 64].includes(i)) mark()
  }
  mark()
  for (let i = 67; i >= 0; i--) result(`memory-${i}`, {
    scope: 'project', topic: 'notes', revision: 1, entry: { id: `parallel-${i}`, summary: `并行记忆 ${i}😀` },
  }, 162)
  mark()
  for (let i = 0; i < 60; i++) {
    call('reused-memory', 'super_code_memory', { action: 'remember', record: { entries: [{ id: `item-${i}`, summary: `  记忆 ${i}😀  ` }] } }, i + 163)
    if ([35, 36, 59].includes(i)) mark()
    result('reused-memory', { scope: 'project', topic: 'notes', revision: i + 2 }, i + 163)
  }
  add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  mark()
  for (let i = 1; i <= 23; i++) {
    add('turn/start', { turn: 1 + i }); user(`后续要求 ${i}`)
    add('todo/write', { todos: [{ content: `完成 ${i}`, status: 'completed' }, { content: `待办 ${i}`, status: 'pending' }] })
    add('approval/asked', { id: `approval-${i}` }); mark()
    add('approval/decided', { id: `approval-${i}` })
    add('turn/end', { turn: 1 + i, reason: { kind: 'completed' } })
  }
  mark()
  return { events, cuts: [...cuts].sort((a, b) => a - b), inherited }
}

for (const modern of [false, true]) for (const fork of [false, true]) {
  test(`${modern ? 'v4' : 'legacy'} projection checkpoints preserve long ${fork ? 'forked' : 'root'} journals across bounded windows`, async t => {
    const ctx = new Context(); new SessionStore(ctx); new SessionProjectionRegistry(ctx)
    t.after(() => ctx.fiber.dispose())
    ctx.sessionProjections.register(feedback); ctx.sessionProjections.register(memory)
    const { events, cuts, inherited: prefix } = journal(modern)
    const original = JSON.stringify(events), inherited = SessionLogOffset(fork ? prefix : 0)
    const header = { cwd: modern ? 'C:\\项目\\工作区' : '/project/工作区' } as SessionHeader
    let facts = feedback.init(header, inherited), usage = memory.init(header, inherited)
    const expected = new Map([[0, { facts, usage }]])
    for (const event of events) {
      facts = feedback.apply(facts, event); usage = memory.apply(usage, event)
      if (cuts.includes(event.seq + 1)) expected.set(event.seq + 1, { facts, usage })
    }
    assert.equal(facts.request, fork ? '当前任务😀' : '继承的请求')
    assert.equal(facts.latestRequest, '后续要求 23')
    assert.equal(facts.history.length, 20); assert.equal(facts.history[0]?.request, '后续要求 3')
    assert.equal(facts.omittedRequests, fork ? 3 : 4)
    assert.equal(facts.files.length, 160); assert.equal(facts.omittedFiles, fork ? 64 : 65)
    assert.ok(facts.files.every(file => file.path.includes('最终 文件-')))
    assert.equal(facts.activities.length, 80); assert.ok(facts.activities.every(row => row.status === 'succeeded'))
    assert.equal(facts.phase, 'idle'); assert.deepEqual(facts.pending, []); assert.deepEqual(facts.approvals, [])
    assert.equal(usage.rows.length, 100); assert.equal(usage.omitted, 24); assert.deepEqual(usage.pending, [])
    assert.equal(usage.rows.at(-1)?.summary, '记忆 59😀')
    for (const cut of cuts) {
      const first = ctx.sessionProjections.restore({}, events.slice(0, cut), SessionLogOffset(0), header, inherited)
      const at = expected.get(cut)!
      assert.deepEqual(first.checkpoint.superCodeFeedback?.val, at.facts, `feedback at ${cut}`)
      assert.deepEqual(first.checkpoint.superCodeMemoryUsage?.val, at.usage, `memory at ${cut}`)
      const checkpoint = JSON.parse(JSON.stringify(first.checkpoint))
      const restored = ctx.sessionProjections.restore(checkpoint, events.slice(cut), SessionLogOffset(cut), header, inherited)
      assert.deepEqual(restored.checkpoint.superCodeFeedback?.val, feedback.stateSchema.parse(facts), `feedback after ${cut}`)
      assert.deepEqual(restored.checkpoint.superCodeMemoryUsage?.val, memory.stateSchema.parse(usage), `memory after ${cut}`)
      assert.deepEqual(restored.snapshot.values.superCodeFeedback, feedback.wire.view!(facts), `feedback wire after ${cut}`)
      assert.deepEqual(restored.snapshot.values.superCodeMemoryUsage, memory.wire.view!(usage), `memory wire after ${cut}`)
    }
    assert.equal(JSON.stringify(events), original, 'read-only projections must preserve journal content')
  })
}
