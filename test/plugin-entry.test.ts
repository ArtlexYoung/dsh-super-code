import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import harnessPlugin from '../src/index.js'

test('package-root mounts durable projections without an alternative executor', async () => {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'super-code-entry-'))
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    await ctx.plugin(harnessPlugin)
    await ctx.inject(['superCodeLongMemory'], () => {})
    assert.ok(ctx.get('superCodeLongMemory'))
    const session = ctx.sessions.create(SessionId('plugin-entry'))
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superCodeTasks')?.tasks, {})
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superAgentUsage')?.totals, {})
    assert.equal(Reflect.has(ctx, 'superAgent'), false)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('package-root keeps task projections without storage and mounts long memory when storage arrives', async () => {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'super-code-late-storage-'))
  try {
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    await ctx.plugin(harnessPlugin)
    const session = ctx.sessions.create(SessionId('before-storage'))
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superCodeTasks')?.tasks, {})
    assert.equal(ctx.get('superCodeLongMemory'), undefined)
    let ready!: () => void
    const mounted = new Promise<void>(resolve => { ready = resolve })
    ctx.inject(['superCodeLongMemory'], () => { ready() })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
    await mounted
    assert.ok(ctx.get('superCodeLongMemory'))
    await domainFiber.dispose()
    assert.equal(ctx.get('superCodeLongMemory'), undefined)
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superCodeTasks')?.tasks, {})
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('failed long-memory domain open leaves task projections available', async () => {
  const ctx = new Context()
  let opened!: () => void
  const attempted = new Promise<void>(resolve => { opened = resolve })
  try {
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    ctx.provide('storageDomain', { open: async () => { opened(); throw new Error('disk unavailable') } })
    await ctx.plugin(harnessPlugin)
    await attempted
    const session = ctx.sessions.create(SessionId('failed-storage'))
    assert.deepEqual(ctx.sessionProjections.stateOf(session, 'superCodeTasks')?.tasks, {})
    assert.equal(ctx.get('superCodeLongMemory'), undefined)
  } finally { await ctx.fiber.dispose() }
})
