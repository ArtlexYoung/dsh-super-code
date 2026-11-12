import test from 'node:test'
import assert from 'node:assert/strict'
import { ExperimentBudget, reduceFailure, findCounterexample, differential, metamorphic, interleavings } from '../src/experiments.js'
import type { Probe, Verdict, ScheduleStep } from '../src/experiments.js'

const budget = (maxChecks = 200) => new ExperimentBudget({ maxChecks, timeoutMs: 10000 })
const fail = { kind: 'fail', signature: 'duplicate' } as const
const pass = { kind: 'pass' } as const

test('reduction retains the same fault, order and duplicates without mutating input', async () => {
  const input = ['noise', 'a', 'b', 'a', 'tail']
  const probe: Probe<string[]> = values => {
    const fails = values.join(',').includes('a,b,a')
    values.push('mutation')
    return fails ? fail : pass
  }
  const result = await reduceFailure(input, 'duplicate', probe, budget())
  assert.equal(result.status, 'reduced')
  assert.equal(result.minimality, 'one-removal')
  assert.deepEqual(result.input, ['a', 'b', 'a'])
  assert.deepEqual(input, ['noise', 'a', 'b', 'a', 'tail'])
  for (let i = 0; i < result.input.length; i++) assert.equal((await probe(result.input.filter((_, n) => i !== n))).kind, 'pass')
  const empty = await reduceFailure([1, 2], 'duplicate', () => fail, budget())
  assert.deepEqual(empty.input, [])
  assert.equal(empty.reproduced, true)
})

test('wrong faults, unknown verdicts and unstable confirmations are not reproductions', async () => {
  assert.equal((await reduceFailure([1], 'target', () => fail, budget())).status, 'not-reproduced')
  assert.equal((await reduceFailure([1], 'duplicate', () => ({ kind: 'unknown', reason: 'missing oracle' }), budget())).status, 'inconclusive')
  let calls = 0
  const flaky = await reduceFailure([1], 'duplicate', () => ++calls % 2 ? fail : pass, budget())
  assert.equal(flaky.status, 'inconclusive')
  assert.equal(flaky.reproduced, false)
  const partial = await reduceFailure([1, 2], 'duplicate', xs => xs.length === 2 ? fail : { kind: 'unknown', reason: 'unsupported' }, budget())
  assert.equal(partial.reproduced, true)
  assert.equal(partial.minimality, 'not-established')
  assert.deepEqual(partial.input, [1, 2])
})

test('confirmation consumes the shared budget and only confirmed reductions survive', async () => {
  const shared = budget(4)
  assert.equal((await findCounterexample([[1, 2, 3]], () => fail, shared)).status, 'counterexample')
  const reduced = await reduceFailure([1, 2, 3], 'duplicate', () => fail, shared)
  assert.equal(reduced.status, 'stopped')
  assert.equal(reduced.reason, 'checks')
  assert.deepEqual(reduced.input, [1, 2, 3]) // Empty input was checked only once.
  assert.equal(reduced.reproduced, true)
  assert.equal(reduced.stats.checks, 4)
  assert.equal((await reduceFailure([1], 'duplicate', () => fail, budget(1))).reproduced, false)
})

test('abort and cooperative deadlines stop without treating interrupted work as evidence', async () => {
  const controller = new AbortController()
  controller.abort()
  const cancelled = await findCounterexample([1], () => fail, new ExperimentBudget({ maxChecks: 2, timeoutMs: 1000, signal: controller.signal }))
  assert.equal(cancelled.status, 'stopped')
  assert.equal(cancelled.stats.checks, 0)
  const during = new AbortController()
  const probe = differential<number, number>(() => { during.abort(); return 1 }, () => { throw new Error('must not run') })
  const interrupted = await findCounterexample([1], probe, new ExperimentBudget({ maxChecks: 2, timeoutMs: 1000, signal: during.signal }))
  assert.equal(interrupted.status, 'stopped')
  const slow = await findCounterexample([1], async () => { await new Promise(resolve => setTimeout(resolve, 20)); return fail }, new ExperimentBudget({ maxChecks: 2, timeoutMs: 5 }))
  assert.equal(slow.status, 'stopped')
  if (slow.status === 'stopped') { assert.equal(slow.reason, 'deadline'); assert.equal(slow.checkedCases, 0) }
})

test('invalid budgets, verdicts and thrown probes fail explicitly', async () => {
  for (const maxChecks of [0, -1, 1.5, Infinity]) assert.throws(() => budget(maxChecks))
  assert.throws(() => new ExperimentBudget({ maxChecks: 1, timeoutMs: NaN }))
  await assert.rejects(() => reduceFailure([1], '', () => pass, budget()), /signature/)
  for (const verdict of [undefined, null, { kind: 'fail', signature: '' }, { kind: 'unknown', reason: '' }, { kind: 'success' }]) {
    await assert.rejects(() => findCounterexample([1], () => verdict as Verdict, budget()), /Probe must return/)
  }
  await assert.rejects(() => reduceFailure([1], 'duplicate', () => { throw new Error('setup failure') }, budget()), /setup failure/)
  await assert.rejects(() => findCounterexample([() => 1], () => pass, budget()), /clone/i)
})

test('search is lazy, keeps original witnesses and distinguishes empty/unknown/limited work', async () => {
  function* inputs() { yield [1]; yield [2]; throw new Error('eager consumption') }
  const found = await findCounterexample(inputs(), xs => { const n = xs[0]; xs.pop(); return n === 2 ? fail : pass }, budget())
  assert.equal(found.status, 'counterexample')
  if (found.status === 'counterexample') { assert.deepEqual(found.input, [2]); assert.equal(found.index, 1) }
  assert.equal((await findCounterexample([], () => pass, budget())).status, 'inconclusive')
  assert.equal((await findCounterexample([1], () => ({ kind: 'unknown', reason: 'no reference' }), budget())).status, 'inconclusive')
  assert.equal((await findCounterexample([1], () => pass, budget(1))).status, 'checked')
  assert.equal((await findCounterexample([1, 2], () => pass, budget(1))).status, 'stopped')
})

test('differential snapshots shared outputs and isolates input mutation', async () => {
  const shared: number[] = []
  const probe = differential<number[], number[]>(xs => { shared.push(...xs); xs.pop(); return shared }, xs => { shared.push(...xs); return shared })
  const found = await findCounterexample([[1]], probe, budget())
  assert.equal(found.status, 'counterexample')
  if (found.status === 'counterexample') assert.deepEqual(found.verdict.detail, { expected: [1], actual: [1, 1] })
  const equal = differential<number[], number>(xs => { xs.push(2); return xs.length }, xs => xs.length + 1)
  assert.equal((await findCounterexample([[1]], equal, budget())).status, 'checked')
  await assert.rejects(() => findCounterexample([1], differential(() => { throw new Error('broken baseline') }, () => 1), budget()), /broken baseline/)
  await assert.rejects(() => findCounterexample([1], differential(x => x, x => x, (() => undefined) as never), budget()), /boolean/)
})

test('a task-specific predicate keeps a target fault when generic differential reduction can switch faults', async () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  // Two known, independent fixture defects: the sentinel path and the fallback path.
  const compare = differential(sum, xs => sum(xs) + (xs.includes(9) ? 100 : xs.includes(2) ? 1 : 0))
  const generic = await reduceFailure([9, 2], 'behavior-difference', compare, budget())
  assert.deepEqual(generic.input, [2])
  const target: Probe<number[]> = async xs => {
    const verdict = await compare(xs)
    return verdict.kind === 'fail' ? { ...verdict, signature: xs.includes(9) ? 'sentinel-path' : 'fallback-path' } : verdict
  }
  assert.deepEqual(await target([2]), { kind: 'fail', signature: 'fallback-path', detail: { expected: 2, actual: 3 } })
  const scoped = await reduceFailure([9, 2], 'sentinel-path', target, budget())
  assert.equal(scoped.status, 'reduced')
  assert.deepEqual(scoped.input, [9])
  assert.equal(scoped.reproduced, true)
  assert.equal(scoped.minimality, 'one-removal')
})

test('metamorphic relations detect contract violations and protect input copies', async () => {
  const sum = (xs: number[]) => xs.reduce((total, x) => total + x, 0)
  const reverse = (xs: number[]) => xs.reverse()
  const correct = metamorphic('sum is permutation invariant', sum, reverse, (a, b) => a === b)
  assert.equal((await findCounterexample([[1, 2, 3]], correct, budget())).status, 'checked')
  const broken = metamorphic('sum is permutation invariant', (xs: number[]) => xs[0], reverse, (a, b) => a === b)
  assert.equal((await findCounterexample([[1, 2, 3]], broken, budget())).status, 'counterexample')
  assert.throws(() => metamorphic('', sum, reverse, (a, b) => a === b), /contract/)
  await assert.rejects(() => findCounterexample([[1]], metamorphic('sum', sum, reverse, (() => undefined) as never), budget()), /boolean/)
})

test('interleavings preserve lane order, bound enumeration and disclose coverage', () => {
  const set = interleavings(2, 2, 10)
  const schedules = [...set]
  assert.equal(set.coverage, 'complete')
  assert.equal(set.count, 6)
  assert.equal(new Set(schedules.map(x => JSON.stringify(x))).size, 6)
  for (const schedule of schedules) for (const lane of [0, 1]) assert.deepEqual(schedule.filter(x => x.lane === lane).map(x => x.index), [0, 1])
  assert.deepEqual([...set], schedules)
  assert.deepEqual([...interleavings(0, 0, 1)], [[]])
  assert.deepEqual([...interleavings(0, 2, 1)], [[{ lane: 1, index: 0 }, { lane: 1, index: 1 }]])
  assert.equal(interleavings(2, 2, 6).coverage, 'complete')
  const large = interleavings(128, 128, 3)
  assert.equal(large.coverage, 'limited')
  assert.equal(large.count, 3)
  assert.equal([...large].length, 3)
  for (const args of [[-1, 2, 2], [1.5, 2, 2], [256, 1, 2], [1, 1, 0]]) assert.throws(() => interleavings(args[0]!, args[1]!, args[2]!))
})

// Two requests each have a start and a completion. Promise gates control the
// actual await boundary; no timing sleeps or a simulated state-only scheduler.
async function race(schedule: ScheduleStep[], guarded: boolean): Promise<Verdict> {
  let version = 0, visible = -1, latest = -1
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  const pending = new Map<number, Promise<void>>()
  for (const { lane, index } of schedule) {
    if (index === 0) {
      const token = ++version; latest = lane
      pending.set(lane, (async () => {
        await gates[lane]!.promise
        if (!guarded || token === version) visible = lane
      })())
    } else { gates[lane]!.resolve(); await pending.get(lane) }
  }
  return visible === latest ? pass : { kind: 'fail', signature: 'stale-overwrite' }
}

test('controlled Promise interleavings reproduce stale writes and verify generation guards', async () => {
  const broken = await findCounterexample(interleavings(2, 2, 6), schedule => race(schedule, false), budget())
  assert.equal(broken.status, 'counterexample')
  if (broken.status === 'counterexample') assert.deepEqual(broken.input.map(x => x.lane), [0, 1, 1, 0])
  const fixed = await findCounterexample(interleavings(2, 2, 6), schedule => race(schedule, true), budget())
  assert.equal(fixed.status, 'checked')
  if (fixed.status === 'checked') assert.equal(fixed.checkedCases, 6)
})

test('bounded interleavings agree with an exhaustive recursive reference for small lanes', () => {
  const reference = (left: number, right: number, prefix: ScheduleStep[] = []): ScheduleStep[][] => {
    const a = prefix.filter(step => step.lane === 0).length, b = prefix.length - a
    if (a === left && b === right) return [prefix]
    return [...(a < left ? reference(left, right, [...prefix, { lane: 0, index: a }]) : []),
      ...(b < right ? reference(left, right, [...prefix, { lane: 1, index: b }]) : [])]
  }
  for (let left = 0; left <= 5; left++) for (let right = 0; right <= 5; right++) {
    const expected = reference(left, right)
    for (const cap of new Set([1, 2, Math.max(1, expected.length - 1), expected.length, expected.length + 1])) {
      const actual = interleavings(left, right, cap)
      assert.deepEqual([...actual], expected.slice(0, cap), `${left}/${right}, cap=${cap}`)
      assert.equal(actual.count, Math.min(cap, expected.length))
      assert.equal(actual.coverage, cap < expected.length ? 'limited' : 'complete')
    }
  }
})

test('reduction minimality holds for all deterministic predicates on three distinct elements', async () => {
  // A truth table covers non-monotone predicates as well as ordinary subset failures.
  for (let table = 0; table < 256; table++) {
    const matches = (items: number[]) => Boolean(table & (1 << items.reduce((mask, item) => mask | (1 << item), 0)))
    let checks = 0
    const reduced = await reduceFailure([0, 1, 2], 'duplicate', items => { checks++; return matches(items) ? fail : pass }, budget())
    assert.equal(reduced.stats.checks, checks)
    if (!matches([0, 1, 2])) { assert.equal(reduced.status, 'not-reproduced'); continue }
    assert.equal(reduced.status, 'reduced', `truth table ${table}`)
    assert.equal(reduced.minimality, 'one-removal')
    assert.equal(matches(reduced.input), true)
    for (let index = 0; index < reduced.input.length; index++) assert.equal(matches(reduced.input.filter((_, i) => i !== index)), false)
  }
})
