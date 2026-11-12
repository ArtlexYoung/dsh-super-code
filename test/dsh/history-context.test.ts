import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { connectionHistoryPage } from '../../src/dsh/connection-history.js'
import { ConnectionHost } from '../../src/dsh/connection-host.js'
import type { ConnectionHostServices } from '../../src/dsh/connection-host.js'
import { ConnectionService } from '../../src/connection/service.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import { invokeConnectionTool } from '../../src/connection/client.js'

const privateSources = [
  { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'host', text: 'PRIVATE-RUNTIME' }] },
  { kind: 'system-prompt' },
  { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
  { kind: 'plugin:@deepseek-ai/dsh-system-prompt' },
]
function message(seq: number, source: object, text: string, wrapped = false): SessionEvent {
  const value = { role: 'user', source, content: [{ type: 'text', text }] }
  return { seq, time: seq, type: 'user/message', data: wrapped ? { message: value } : value } as SessionEvent
}

for (const wrapped of [false, true]) for (const source of privateSources) {
  test(`public history hides ${source.kind}${source.kind === 'plugin' ? ' system-prompt' : ''} in ${wrapped ? 'wrapped' : 'direct'} messages`, () => {
    const events = [message(0, source, 'PRIVATE-CONTEXT'.repeat(4000), wrapped),
      message(1, { kind: 'user' }, 'Current runtime context is my literal user text.', wrapped),
      message(2, { kind: 'skill-invocation' }, 'Public skill invocation', wrapped),
      message(3, { kind: 'plugin', plugin: 'another-plugin' }, 'Public plugin message', wrapped)]
    const before = JSON.stringify(events)
    const first = connectionHistoryPage(events, { seq: 0, offset: 0 }, 1)
    assert.deepEqual(first.entries.map(row => [row.seq, row.text]), [[1, 'Current runtime context is my literal user text.']])
    const rest = connectionHistoryPage(events, first.nextCursor, 20)
    assert.deepEqual(rest.entries.map(row => row.text), ['Public skill invocation', 'Public plugin message'])
    assert.equal(rest.hasMore, false)
    assert.equal(JSON.stringify(events), before, 'public filtering cannot change model context or durable history')
    assert.throws(() => connectionHistoryPage(events, { seq: 0, offset: 1 }, 1), /invalid-history-cursor/)
  })
}

test('private-only context pages advance their bounded cursor and keep older source-less messages readable', () => {
  const events = Array.from({ length: 2001 }, (_, seq) => message(seq, privateSources[seq % privateSources.length]!, 'PRIVATE'))
  events.push({ seq: 2001, time: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'Legacy user text' }] } } as SessionEvent)
  const first = connectionHistoryPage(events, { seq: 0, offset: 0 }, 20)
  assert.deepEqual(first.entries, [])
  assert.deepEqual(first.nextCursor, { seq: 2000, offset: 0 })
  assert.equal(first.hasMore, true)
  const second = connectionHistoryPage(events, first.nextCursor, 20)
  assert.deepEqual(second.entries.map(row => row.text), ['Legacy user text'])
  assert.equal(second.hasMore, false)
})

async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

test('real MCP dsh_read excludes injected runtime context while preserving public conversation text', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-history-context-'))
  const events = privateSources.map((source, seq) => message(seq, source, `PRIVATE-${source.kind}`))
  events.push(message(4, { kind: 'user' }, 'Public user request'))
  const original = JSON.stringify(events)
  let disposed = 0, prompts = 0
  const host = new ConnectionHost({
    presets: { status: async () => ({ state: 'installed', id: 'super-code' }) },
    controller: { create: async ({ sessionId }: { sessionId: string }) => ({ sessionId, agentPreset: 'super-code' }), prompt: async () => { prompts++ } },
    agents: { get: () => ({ status: 'running' }) },
    query: { observeSession: async () => ({ events, inheritedEventCount: 0, [Symbol.dispose]() { disposed++ } }) },
    subagents: { listDescendants: async () => [] },
  } as unknown as ConnectionHostServices)
  const service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host)
  t.after(async () => { try { await service.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await service.initialize()
  assert.ok((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: await port(), allowedDirectories: [root] }), '0')).ok)
  const call = (tool: string, args: object) => invokeConnectionTool({ url: service.read().url, token: service.reveal().token, tool, arguments: args })
  const started = await call('dsh_run', { cwd: root, requestId: 'history-context', prompt: 'Read history' })
  assert.equal(started.isError, undefined)
  const task = JSON.parse((started.content as { text: string }[])[0]!.text)
  const read = await call('dsh_read', { taskId: task.taskId, cursor: { seq: 0, offset: 0 }, limit: 20 })
  assert.equal(read.isError, undefined)
  const page = JSON.parse((read.content as { text: string }[])[0]!.text)
  assert.deepEqual(page.entries.map((row: { text: string }) => row.text), ['Public user request'])
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE/)
  assert.equal(JSON.stringify(events), original)
  assert.ok(disposed > 0)
  assert.equal(prompts, 1, 'reading history must not schedule an additional model turn')
})
