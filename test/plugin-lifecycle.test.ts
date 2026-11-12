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

for (const failed of [false, true]) test(`replacing a memory facility during a ${failed ? 'failed' : 'successful'} pending open publishes only the replacement`, async t => {
  const ctx = new Context(), entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>()
  let oldClosed = 0, currentOpened = 0, currentClosed = 0
  t.after(async () => { gate.resolve(); await ctx.fiber.dispose() })
  const old = ctx.plugin({ apply(owner: Context) {
    owner.provide('storageDomain', { open: async () => {
      entered.resolve(); await gate.promise
      if (failed) throw new Error('old facility is unavailable')
      return { table: () => ({}), close: async () => { oldClosed++ } }
    } } as never)
  } })
  await old
  const feature = ctx.plugin(harnessPlugin)
  await entered.promise
  const stopping = old.dispose()
  const replacement = ctx.plugin({ apply(owner: Context) {
    owner.provide('storageDomain', { open: async () => {
      currentOpened++
      return { table: () => ({}), close: async () => { currentClosed++ } }
    } } as never)
  } })
  gate.resolve()
  await stopping; await replacement; await feature
  await ctx.inject(['superCodeLongMemory'], () => {})
  assert.equal(currentOpened, 1)
  assert.equal(oldClosed, failed ? 0 : 1)
  assert.equal(currentClosed, 0)
  assert.ok(ctx.get('superCodeLongMemory'))
  await feature.dispose()
  assert.equal(currentClosed, 1)
  assert.equal(ctx.get('superCodeLongMemory'), undefined)
})
