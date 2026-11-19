import test from 'node:test'
import assert from 'node:assert/strict'
import { ChangeSet } from '@codemirror/state'
import { asText, createHistory, textChanges, undoChanges } from '../../../../builtin/workbench/editing/history.js'
import { createAutosave } from '../../../../builtin/workbench/editing/autosave.js'

function entry(path: string, before: string, changes: any) {
  const text = asText(before), change = ChangeSet.of(changes, text.length)
  return { kind: 'text', path, before: text, after: change.apply(text), changes: change }
}

test('撤销只回退自己的范围，保留其他来源的前后修改，重叠时拒绝', () => {
  const edit = entry('a.ts', 'const count = 1;\nconst name = "demo";', { from: 14, to: 15, insert: '42' })
  assert.equal(undoChanges(edit, edit.after).apply(edit.after).toString(), edit.before.toString())
  const outside = asText('// note\n' + edit.after.toString().replace('demo', 'kept'))
  assert.equal(undoChanges(edit, outside).apply(outside).toString(), '// note\n' + edit.before.toString().replace('demo', 'kept'))
  assert.throws(() => undoChanges(edit, asText(edit.after.toString().replace('42', '99'))), /WORKBENCH_UNDO_CONFLICT/)
})

test('插入、删除、CRLF、中文、多选区的撤销和重做准确还原', () => {
  for (const edit of [entry('a.ts', '甲\r\n乙\r\n', [{ from: 0, insert: '前' }, { from: 2, to: 3, insert: '后' }]), entry('empty', '', { from: 0, insert: 'hello' }), entry('delete', 'all', { from: 0, to: 3 })]) {
    const undo = undoChanges(edit, edit.after), restored = undo.apply(edit.after)
    assert.equal(restored.toString(), edit.before.toString())
    assert.equal(undoChanges({ before: edit.after, after: restored, changes: undo }, restored).apply(restored).toString(), edit.after.toString())
  }
  assert.equal(textChanges(asText('abc'), asText('aXYc')).apply(asText('abc')).toString(), 'aXYc')
})

test('历史按对话和文件隔离，冲突文件不会阻止另一个文件撤销，默认保留1000步', () => {
  const history = createHistory(), a = Symbol(), b = Symbol()
  for (let i = 0; i < 1002; i++) history.record(a, entry(`file${i}.ts`, 'old', { from: 0, to: 3, insert: 'new' }))
  assert.equal(history.peek(a, 'undo', 'file0.ts').path, 'file1001.ts')
  assert.equal(history.peek(a, 'undo', 'file2.ts').path, 'file2.ts')
  history.record(b, entry('file2.ts', 'new', { from: 0, to: 3, insert: 'other' }))
  const conflict = history.peek(a, 'undo', 'file2.ts')
  assert.throws(() => undoChanges(conflict, asText('other')), /CONFLICT/)
  const other = history.peek(a, 'undo', 'file3.ts')
  assert.equal(undoChanges(other, asText('new')).apply(asText('new')).toString(), 'old')
  history.complete(a, 'undo', other, other)
  assert.equal(history.peek(a, 'redo', 'file3.ts'), other)
  assert.equal(history.peek(b, 'undo', 'file2.ts').after.toString(), 'other')
})

test('连续输入合并为一步，历史缩短和新编辑释放废弃的文件恢复令牌', () => {
  const released: string[] = [], history = createHistory((tokens: string[]) => released.push(...tokens)), owner = Symbol()
  const first = entry('a', '', { from: 0, insert: 'a' })
  history.record(owner, { ...first, group: 'input' })
  const secondChange = ChangeSet.of({ from: 1, insert: 'b' }, 1)
  history.record(owner, { kind: 'text', path: 'a', before: first.after, after: secondChange.apply(first.after), changes: secondChange, group: 'input' })
  assert.equal(history.peek(owner, 'undo', 'a').before.toString(), '')
  assert.equal(history.peek(owner, 'undo', 'a').after.toString(), 'ab')
  history.record(owner, { kind: 'file', path: 'dir', token: 'first' })
  history.record(owner, { kind: 'file', path: 'dir2', token: 'second' })
  const last = history.peek(owner, 'undo', 'dir2'); history.complete(owner, 'undo', last, last)
  history.limit(1)
  assert.deepEqual(released, ['first'])
  history.record(owner, first)
  assert.deepEqual(released, ['first', 'second'])
})

test('自动保存默认关闭、按文件防抖、换设置取消定时器，失败不重复覆盖', async () => {
  let now = 0, next = 0
  const timers = new Map<number, { at: number; fn: () => void }>(), calls: string[] = [], failures: Error[] = []
  const clock = { setTimeout(fn: () => void, delay: number) { const id = ++next; timers.set(id, { at: now + delay, fn }); return id }, clearTimeout(id: number) { timers.delete(id) } }
  const save = createAutosave(async (path: string) => { calls.push(path); if (path === 'fail') throw new Error('conflict') }, (error: Error) => failures.push(error), clock)
  const advance = async (ms: number) => { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn() } await Promise.resolve(); await Promise.resolve() }
  save.change('manual'); await advance(30000); assert.deepEqual(calls, [])
  save.configure('15'); save.change('a'); await advance(10000); save.change('a'); save.change('b'); await advance(14999); assert.deepEqual(calls, [])
  await advance(1); assert.deepEqual(calls, ['a', 'b'])
  save.change('pending'); save.configure('manual'); await advance(30000); assert.equal(calls.length, 2)
  save.configure('immediate'); save.change('fail'); await advance(0); await advance(30000); assert.equal(failures.length, 1); assert.equal(calls.filter(path => path === 'fail').length, 1)
  save.change('pending'); save.dispose(); await advance(1000); assert.equal(calls.includes('pending'), false)
})
