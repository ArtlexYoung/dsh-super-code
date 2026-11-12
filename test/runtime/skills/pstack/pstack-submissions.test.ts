import { validationRoot as scratch } from '../../../validation-root.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openSubmissions } from '../../../../runtime/skills/pstack/overrides/skills/make-bot-ui/scripts/submissions.mjs'

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  await mkdir(scratch, { recursive: true })
  const directory = await mkdtemp(join(scratch, '中文 存储-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'requests.json')
  return { directory, file, store: await openSubmissions(file) }
}
const payload = () => ({ action: 'greet', arguments: { name: '张 三' }, cwd: '/workspace', conversation: { mode: 'new' } })

test('concurrent identical submissions dispatch once and changed content conflicts before dispatch', async t => {
  const f = await fixture(t)
  let count = 0
  const dispatch = async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); return { taskId: 'sc-one', nested: { count: 1 } } }
  const results = await Promise.all(Array.from({ length: 6 }, () => f.store.submit('request-1', payload(), dispatch)))
  assert.equal(count, 1)
  assert.equal(results.filter(r => !r.replay).length, 1)
  assert.ok(results.every(r => r.result.taskId === 'sc-one'))
  results[0].result.nested.count = 99
  assert.ok(results.slice(1).every(r => r.result.nested.count === 1))
  assert.equal((await f.store.submit('request-1', payload(), dispatch)).result.nested.count, 1)
  await assert.rejects(f.store.submit('request-1', { ...payload(), arguments: { name: '不同' } }, dispatch), { code: 'request-conflict' })
  assert.equal(count, 1)
})

test('canonical object order survives restart and original payload/result cannot be mutated by callers', async t => {
  const f = await fixture(t), input = payload()
  const first = await f.store.submit('__proto__', input, async saved => { saved.arguments.name = 'callback mutation'; return { taskId: 'sc-one', nested: { count: 1 } } })
  input.arguments.name = 'caller mutation'
  first.result.nested.count = 99
  const restarted = await openSubmissions(f.file)
  const reordered = { conversation: { mode: 'new' }, cwd: '/workspace', arguments: { name: '张 三' }, action: 'greet' }
  const replay = await restarted.submit('__proto__', reordered, async () => assert.fail('must not redispatch'))
  assert.equal(replay.replay, true)
  assert.equal(replay.result.nested.count, 1)
})

test('unconfirmed admission retains original request across a restart and never silently retries', async t => {
  const f = await fixture(t)
  let count = 0
  await assert.rejects(f.store.submit('ambiguous', payload(), async () => { count++; throw new Error('transport lost after admission') }), /transport lost/)
  assert.equal(count, 1)
  const restarted = await openSubmissions(f.file)
  await assert.rejects(restarted.submit('ambiguous', { ...payload(), cwd: '/other' }, async () => assert.fail('must not dispatch')), { code: 'request-conflict' })
  const recovered = await restarted.submit('ambiguous', payload(), async saved => { assert.deepEqual(saved, payload()); return { taskId: 'sc-original' } })
  assert.equal(recovered.result.taskId, 'sc-original')
})

test('different request IDs persist concurrently without losing records', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({ length: 12 }, (_, i) => f.store.submit('parallel-' + i, { ...payload(), arguments: { name: String(i) } }, async () => ({ taskId: 'sc-' + i }))))
  const restarted = await openSubmissions(f.file)
  for (let i = 0; i < 12; i++) {
    const r = await restarted.submit('parallel-' + i, { ...payload(), arguments: { name: String(i) } }, async () => assert.fail('lost record'))
    assert.equal(r.result.taskId, 'sc-' + i)
  }
})

test('invalid JSON payloads and IDs are rejected before any side effect', async t => {
  const f = await fixture(t)
  const cyclic: any = {}; cyclic.self = cyclic
  for (const value of [undefined, null, [], { n: NaN }, { missing: undefined }, { n: Infinity }, { n: 1n }, { date: new Date() }, { a: Array(2) }, cyclic]) {
    await assert.rejects(f.store.submit('invalid', value, async () => assert.fail('invalid request dispatched')))
  }
  for (const id of ['', 'a b', '../bad', 'x'.repeat(129)]) await assert.rejects(f.store.submit(id, payload(), async () => assert.fail('invalid ID dispatched')))
  await assert.rejects(readFile(f.file), { code: 'ENOENT' })
})

test('corrupt or incompatible stores fail instead of being overwritten', async t => {
  const f = await fixture(t)
  for (const data of ['{bad', '{"version":2,"entries":[]}', '{"version":1,"entries":[null]}', '{"version":1,"entries":[{"requestId":"x","payload":{},"result":{"taskId":"sc-x"}},{"requestId":"x","payload":{}}]}']) {
    await writeFile(f.file, data)
    await assert.rejects(openSubmissions(f.file))
    assert.equal(await readFile(f.file, 'utf8'), data)
  }
})

test('a failed initial save prevents dispatch and an explicit retry can recover', async t => {
  const f = await fixture(t)
  await mkdir(f.file)
  let count = 0
  const dispatch = async () => { count++; return { taskId: 'sc-one' } }
  await assert.rejects(f.store.submit('save-failure', payload(), dispatch))
  assert.equal(count, 0)
  await rename(f.file, f.file + '.blocked')
  assert.equal((await f.store.submit('save-failure', payload(), dispatch)).result.taskId, 'sc-one')
  assert.equal(count, 1)
})

test('a failed result save retries persistence without redispatching accepted work', async t => {
  const f = await fixture(t)
  let count = 0
  await assert.rejects(f.store.submit('result-save', payload(), async () => {
    count++
    await rename(f.file, f.file + '.before-result')
    await mkdir(f.file)
    return { taskId: 'sc-accepted' }
  }))
  await rename(f.file, f.file + '.blocked')
  const replay = await f.store.submit('result-save', payload(), async () => assert.fail('accepted work dispatched again'))
  assert.equal(replay.result.taskId, 'sc-accepted')
  assert.equal(count, 1)
  const restarted = await openSubmissions(f.file)
  assert.equal((await restarted.submit('result-save', payload(), async () => assert.fail('lost persisted receipt'))).result.taskId, 'sc-accepted')
})

test('concurrent transport failures share one admission attempt; only a later explicit retry dispatches', async t => {
  const f = await fixture(t)
  let count = 0
  const dispatch = async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('ambiguous transport') }
  const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => f.store.submit('same-failure', payload(), dispatch)))
  assert.ok(outcomes.every(r => r.status === 'rejected'))
  assert.equal(count, 1)
  assert.equal((await f.store.submit('same-failure', payload(), async () => ({ taskId: 'sc-recovered' }))).result.taskId, 'sc-recovered')
})

test('accepted ownership receipts are defensive copies and invalid receipts are not cached', async t => {
  const f = await fixture(t)
  for (const result of [null, {}, { taskId: '' }, { taskId: 'not an id' }, { taskId: 'sc-one', bad: undefined }]) {
    await assert.rejects(f.store.submit('bad-receipt', payload(), async () => result))
    assert.deepEqual(f.store.receipts(), [])
  }
  await f.store.submit('valid', payload(), async () => ({ taskId: 'sc-valid' }))
  const list = f.store.receipts()
  list[0].result.taskId = 'mutated'
  assert.equal(f.store.receipts()[0].result.taskId, 'sc-valid')
  assert.deepEqual((await openSubmissions(f.file)).receipts(), [{ requestId: 'valid', result: { taskId: 'sc-valid' } }])
})
