import { validationRoot } from '../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { ConnectionHost } from '../../src/dsh/connection-host.js'
import type { ConnectionHostServices } from '../../src/dsh/connection-host.js'
import { ConnectionStore } from '../../src/connection/store.js'
import { ConnectionService } from '../../src/connection/service.js'
import { defaultConnectionConfig } from '../../src/connection/types.js'
import { invokeConnectionTool } from '../../src/connection/client.js'

const faults = ['root', 'child-cancel', 'interrupt', 'diagnostic-first', 'diagnostic-middle', 'diagnostic-last'] as const
for (const fault of faults) test(`task-tree cancellation attempts every known branch after ${fault} failure`, async () => {
  const calls: string[] = []
  let failing = true
  const agents = new Map(['root', 'earlier', 'bad', 'later', 'unrelated'].map(id => [id, {
    status: 'running',
    cancel(cause: unknown, options: unknown) {
      assert.deepEqual(cause, { kind: 'user' })
      assert.deepEqual(options, { keepInbox: false })
      calls.push(`cancel:${id}`)
      if (failing && (fault === 'root' && id === 'root' || fault === 'child-cancel' && id === 'bad')) throw new Error('cancel failed')
      this.status = 'idle'
    },
  }]))
  const children = [
    { id: 'earlier', parentId: 'root', kind: 'child', mode: 'continuable' },
    { id: 'bad', parentId: 'root', kind: 'child', mode: 'external' },
    { id: 'later', parentId: 'root', kind: 'child', mode: 'external' },
  ]
  if (fault.startsWith('diagnostic-')) children.splice(fault.endsWith('first') ? 0 : fault.endsWith('middle') ? 1 : 3, 0,
    { id: 'unreadable-branch', parentId: 'root', kind: 'diagnostic', mode: '' })
  const before = structuredClone(children)
  const host = new ConnectionHost({ agents: { get: id => agents.get(id) }, subagents: {
    listDescendants: async () => children,
    interrupt: async (id, authority) => {
      calls.push(`interrupt:${id}`)
      assert.deepEqual(authority, { kind: 'user', parentSessionId: 'root' })
      if (failing && fault === 'interrupt' && id === 'bad') throw new Error('interrupt failed')
      return {}
    },
  } } as ConnectionHostServices)
  const failure = await host.cancel('root').then(() => false, error => error)
  assert.ok(failure, 'partial cancellation remains unconfirmed')
  assert.deepEqual(calls.filter(row => row.startsWith('cancel:')), ['cancel:root', 'cancel:later', 'cancel:bad', 'cancel:earlier'])
  assert.deepEqual(calls.filter(row => row.startsWith('interrupt:')), ['interrupt:later', 'interrupt:bad'])
  assert.equal(failure.code, 'cancellation-unconfirmed')
  assert.deepEqual(children, before, 'the host-owned catalog retains its order')
  assert.equal(agents.get('unrelated')!.status, 'running')
  failing = false
  for (let i = children.length - 1; i >= 0; i--) if (children[i]!.kind === 'diagnostic') children.splice(i, 1)
  calls.length = 0
  await host.cancel('root')
  assert.deepEqual(calls.filter(row => row.startsWith('cancel:')), ['cancel:root', 'cancel:later', 'cancel:bad', 'cancel:earlier'])
  assert.equal(agents.get('unrelated')!.status, 'running')
})

for (const missing of [false, true]) test(`healthy cancellation handles ${missing ? 'unloaded' : 'loaded'} external agents without touching other sessions`, async () => {
  const cancelled: string[] = [], interrupted: string[] = []
  const host = new ConnectionHost({
    agents: { get: id => id === 'external' && missing ? undefined : { status: 'idle', cancel: () => { cancelled.push(id) } } },
    subagents: { listDescendants: async () => [{ id: 'external', parentId: 'root', kind: 'child', mode: 'external' }],
      interrupt: async (id, authority) => { assert.equal(authority.parentSessionId, 'root'); interrupted.push(id); return {} } },
  } as ConnectionHostServices)
  await host.cancel('root')
  assert.deepEqual(cancelled, missing ? ['root'] : ['root', 'external'])
  assert.deepEqual(interrupted, ['external'])
})

test('MCP cancellation stops healthy branches despite a diagnostic and recovers without replay', async t => {
  await mkdir(validationRoot, { recursive: true })
  const root = await mkdtemp(join(validationRoot, 'cancel-tree-'))
  let diagnostic = true, prompts = 0, sessionId = '', disposed = 0
  const cancelled: string[] = [], states = new Map<string, string>(), journals = new Map<string, any[]>()
  const host = new ConnectionHost({
    presets: { status: async () => ({ state: 'available', id: 'super-code' }) },
    controller: { create: async input => { sessionId = input.sessionId; states.set(sessionId, 'running'); return input },
      prompt: async input => {
        prompts++
        journals.set(sessionId, [{ seq: 0, time: 1, type: 'user/message', data: { source: { rpcId: input.requestId }, content: [{ type: 'text', text: 'Work' }] } }])
        states.set('child', 'running')
        journals.set('child', [{ seq: 0, time: 2, type: 'turn/start', data: {} }])
        return {}
      } },
    agents: { get: id => states.has(id) ? { get status() { return states.get(id)! }, cancel: () => { cancelled.push(id); states.set(id, 'idle') } } : undefined },
    query: { observeSession: async id => ({ events: journals.get(id) ?? [], inheritedEventCount: 0, [Symbol.dispose]() { disposed++ } }) },
    subagents: { listDescendants: async () => [{ id: 'child', parentId: sessionId, kind: 'child', mode: 'continuable' },
      ...diagnostic ? [{ id: 'unreadable', parentId: sessionId, kind: 'diagnostic' }] : []], interrupt: async () => ({}) },
  } as ConnectionHostServices)
  const service = new ConnectionService(new ConnectionStore(join(root, 'profile')), host)
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }) })
  await service.initialize()
  const finder = createServer()
  await new Promise<void>(resolve => finder.listen(0, '127.0.0.1', resolve))
  const address = finder.address(); assert.ok(address && typeof address !== 'string')
  await new Promise<void>(resolve => finder.close(() => resolve()))
  assert.equal((await service.save(JSON.stringify({ ...defaultConnectionConfig, enabled: true, port: address.port, allowedDirectories: [root] }), '0')).ok, true)
  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await invokeConnectionTool({ url: service.read().url, token: service.reveal().token, tool, arguments: args })
    assert.notEqual(result.isError, true)
    return JSON.parse((result.content as { text: string }[])[0]!.text)
  }
  const task = await call('dsh_run', { cwd: root, requestId: 'once', prompt: 'Work' })
  const result = await call('dsh_cancel', { taskId: task.taskId })
  assert.equal(result.status, 'unavailable', 'an unreadable branch must not be reported as fully cancelled')
  assert.ok(cancelled.includes('child'), 'the healthy child still receives cancellation')
  assert.equal(states.get('child'), 'idle')
  assert.match(result.events.map((event: any) => event.message).join('\n'), /Could not confirm cancellation/)
  diagnostic = false
  assert.equal((await call('dsh_wait', { taskId: task.taskId, cursor: result.cursor, waitMs: 0 })).status, 'cancelled')
  assert.equal(prompts, 1, 'cancellation and recovery do not replay the prompt')
  assert.equal((await call('dsh_read', { taskId: task.taskId })).entries[0].text, 'Work')
  assert.ok(disposed > 0)
  assert.deepEqual(service.overview().connections, [], 'one-shot MCP calls release their own connections')
})
