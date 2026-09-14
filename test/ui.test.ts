import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentTree, injectPresets, selectModel, summarizeTokens } from '../src/ui.js'

test('model pools promote without downgrading and choose strength by difficulty', () => {
  const pool = {
    high: [{ provider: 'deepseek', id: 'h', strengths: ['balanced', 'deep'], available: true }],
    normal: [{ id: 'n', strengths: ['fast'], available: true }],
    low: [{ id: 'l', strengths: ['fast'], available: false }],
  }
  assert.equal(selectModel(pool, 'low', 0.1)?.id, 'n')
  assert.deepEqual(selectModel(pool, 'high', 0.99), { provider: 'deepseek', id: 'h', strengths: ['balanced', 'deep'], available: true, strength: 'deep' })
  assert.equal(selectModel({ high: [], normal: [], low: [] }, 'low'), undefined)
})

test('token summary and dynamic preset/tree projections preserve all entries', () => {
  const summary = summarizeTokens([{ model: 'a', cacheHit: 8, uncachedInput: 2, cacheRead: 0, output: 5 }])
  assert.deepEqual(summary, { total: 15, averageCacheHitRate: 0.8, details: { cacheHit: 8, uncachedInput: 2, cacheRead: 0, output: 5 } })
  const duplicateCacheBuckets = summarizeTokens([{ model: 'a', cacheHit: 8, uncachedInput: 2, cacheRead: 8, output: 5 }])
  assert.equal(duplicateCacheBuckets.total, 15)
  assert.equal(duplicateCacheBuckets.averageCacheHitRate, 0.8)
  assert.deepEqual(injectPresets([{ id: 'solo' }], [{ id: 'solo' }, { id: 'team' }]).map(p => p.id), ['solo', 'team'])
  assert.deepEqual(buildAgentTree([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', parentId: 'a' }]), [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B', parentId: 'a', children: [] }] }])
})
