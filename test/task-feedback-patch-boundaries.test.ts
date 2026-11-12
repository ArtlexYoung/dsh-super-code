import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { taskFeedbackProjection as projection } from '../src/task-feedback-projection.js'

const initial = () => projection.init({ cwd: '/project' } as SessionHeader, 0 as SessionLogOffset)
const event = (seq: number, type: string, data: object) => ({ seq, time: seq, type, data }) as SessionEvent
const args = (native: boolean, patch: string) => native ? { input: patch } : { patch }
const patchOf = (paths: string[]) => ['*** Begin Patch', ...paths.flatMap(path => [`*** Add File: ${path}`, '+value']), '*** End Patch'].join('\n')
const call = (patch: object) => event(0, 'tool/call', { turn: 1, step: 1, callId: 'patch', name: 'apply_patch', arguments: JSON.stringify(patch) })
const result = (failed = false) => event(1, 'tool/result', { turn: 1, step: 1,
  message: { role: 'tool', toolCallId: 'patch', isError: failed, content: [] } })

for (const native of [false, true]) {
  const name = native ? 'native' : 'legacy'
  test(`${name} patch evidence stays bounded at empty, exact, overflow and large file counts`, () => {
    for (const count of [0, 159, 160, 161, 12_000]) {
      const start = call(args(native, patchOf(Array.from({ length: count }, (_, i) => `src/文件 ${i}.ts`))))
      const before = JSON.stringify(start)
      const pending = projection.apply(initial(), start)
      const expected = Array.from({ length: Math.min(count, 160) }, (_, i) => `/project/src/文件 ${i}.ts`)
      assert.deepEqual(pending.pending[0]?.files.map(file => file.path), expected)
      assert.equal(pending.files.length, 0, 'a call is not completion evidence')
      const completed = projection.apply(pending, result())
      assert.deepEqual(completed.files.map(file => file.path), expected)
      assert.equal(completed.activities[0]?.status, 'succeeded')
      assert.equal(completed.pending.length, 0)
      assert.equal(projection.apply(completed, result()), completed, 'duplicate delivery has no side effects')
      assert.equal(projection.apply(pending, result(true)).files.length, 0, 'a failed patch does not claim files')
      assert.doesNotThrow(() => projection.stateSchema.parse(completed))
      assert.equal(JSON.stringify(start), before)
    }
  })

  test(`${name} patch limits count invalid and duplicate markers without pulling in later files`, () => {
    const paths = ['src/../a.ts', './a.ts', 'nul\0path', 'x'.repeat(4097),
      ...Array.from({ length: 156 }, (_, i) => `kept-${i}.ts`), 'outside-budget.ts']
    const pending = projection.apply(initial(), call(args(native, patchOf(paths))))
    assert.equal(pending.pending[0]?.files.length, 158)
    const completed = projection.apply(pending, result())
    assert.deepEqual(completed.files.map(file => file.path), ['/project/a.ts', ...Array.from({ length: 156 }, (_, i) => `/project/kept-${i}.ts`)])
    assert.equal(completed.omittedFiles, 0)
    assert.equal(completed.files.some(file => file.path.endsWith('outside-budget.ts')), false)
  })
}

test('oversized patch arguments are displayed without decoding file evidence', () => {
  for (const native of [false, true]) {
    const start = call(args(native, patchOf(['one.ts']) + ' '.repeat(2_000_000)))
    const completed = projection.apply(projection.apply(initial(), start), result())
    assert.deepEqual(completed.files, [])
    assert.equal(completed.activities[0]?.tool, 'apply_patch')
    assert.equal(completed.activities[0]?.status, 'succeeded')
    assert.doesNotThrow(() => projection.stateSchema.parse(completed))
  }
})

test('decoded PTC patches preserve move, deletion and empty creation evidence at the marker limit', () => {
  const input = ['*** Begin Patch', '*** Update File: old.ts', '*** Move to: new.ts', '@@', ' same',
    '*** Delete File: removed.ts', ...Array.from({ length: 157 }, (_, i) => `*** Add File: empty-${i}.ts`),
    '*** Add File: outside-budget.ts', '*** End Patch'].join('\r\n')
  const data = { subCallId: 'inner', parentCallId: 'outer', rootCallId: 'outer', name: 'apply_patch', arguments: { input },
    isError: false, content: [], meta: { diffs: [], stopped: false } }
  const start = event(0, 'tool/ptc-dispatch-start', data), done = event(1, 'tool/ptc-dispatch', data)
  const before = JSON.stringify([start, done])
  const live = projection.apply(projection.apply(initial(), start), done)
  const legacy = projection.apply(initial(), done)
  const expected = ['/project/old.ts', '/project/new.ts', '/project/removed.ts',
    ...Array.from({ length: 157 }, (_, i) => `/project/empty-${i}.ts`)]
  for (const state of [live, legacy]) {
    assert.deepEqual(state.files.map(file => file.path), expected)
    assert.equal(state.activities.length, 1)
    assert.equal(state.activities[0]?.status, 'succeeded')
    assert.deepEqual(state.pending, [])
    assert.doesNotThrow(() => projection.stateSchema.parse(state))
  }
  assert.equal(JSON.stringify([start, done]), before)
})
