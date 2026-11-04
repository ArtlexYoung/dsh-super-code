import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import harnessPlugin from '../src/index.js'

test('unloading while the memory domain opens closes the late result without publishing a stale store', async t => {
  const ctx = new Context(), entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let closed = 0
  ctx.provide('storageDomain', { open: async () => {
    entered.resolve(); await gate.promise
    return { table: () => ({}), close: async () => { closed++ } }
  } } as never)
  t.after(async () => { gate.resolve(); await ctx.fiber.dispose() })
  const feature = ctx.plugin(harnessPlugin)
  await entered.promise
  const stopping = feature.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  gate.resolve()
  await stopping
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(closed, 1)
  assert.equal(ctx.get('superCodeLongMemory'), undefined)
})
