import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { openCodeHistory } from '../../../../builtin/workbench/git/history.js'
import { createChanges } from '../../../../builtin/workbench/git/changes.js'

function fixture(file: string, text: string, from: number, to = from) {
  let state = EditorState.create({ doc: text, selection: { anchor: from, head: to } }), panel: any
  const view = { get state() { return state } }
  const workbench = { view: () => view, snapshot: () => ({ file }), panel: (value: any) => { panel = value } }
  return { workbench, panel: () => panel, replace: () => { state = EditorState.create({ doc: text + '\n' }) } }
}

test('代码历史入口优先显式选区；没有选区时选择当前函数，旧语言回退当前行', async () => {
  const text = 'const first = 1\nfunction compute(n: number) {\n  return n * 2\n}\nconst last = 2\n'
  const fn = fixture('main.ts', text, text.indexOf('return'))
  await openCodeHistory(fn.workbench, (key: string) => key)
  assert.equal(fn.panel().title, 'historyFunction')
  assert.deepEqual(fn.panel().target, { path: 'main.ts', start: 2, end: 4 })
  assert.equal(fn.panel().text, text)
  const selection = fixture('main.ts', text, text.indexOf('  return'), text.indexOf('\n}', text.indexOf('return')) + 1)
  await openCodeHistory(selection.workbench, (key: string) => key)
  assert.equal(selection.panel().title, 'historySelection')
  assert.deepEqual(selection.panel().target, { path: 'main.ts', start: 3, end: 3 })
  const fallback = fixture('plain.txt', 'line one\nline two\n', 12)
  await openCodeHistory(fallback.workbench, (key: string) => key)
  assert.equal(fallback.panel().title, 'historyLine')
  assert.deepEqual(fallback.panel().target, { path: 'plain.txt', start: 2, end: 2 })
})

test('异步解析完成前源码变化时不打开旧范围，无文件或编辑器时无副作用', async () => {
  const f = fixture('main.ts', 'function run() { return 1 }', 20)
  const waiting = openCodeHistory(f.workbench, (key: string) => key)
  f.replace()
  await assert.rejects(waiting, /WORKBENCH_GIT_STALE/)
  assert.equal(f.panel(), undefined)
  await openCodeHistory({ view: () => null, snapshot: () => ({ file: null }), panel: () => assert.fail() }, (key: string) => key)
})

test('只读历史查询不抢占共享 Git 状态请求的顺序', async () => {
  const pending = Promise.withResolvers<any>(), store = createChanges(async (input: any) => input.action === 'status' ? pending.promise : { kind: input.action === 'lineHistory' ? 'lineHistory' : 'diff' }, (error: Error) => error.message)
  const request = store.run({ action: 'status' })
  await store.run({ action: 'lineHistory' }); await store.run({ action: 'lineHistoryDiff' })
  pending.resolve({ kind: 'state', state: { version: 'new', exists: true, changes: [] } }); await request
  assert.equal(store.snapshot().state.version, 'new')
  store.dispose()
})
