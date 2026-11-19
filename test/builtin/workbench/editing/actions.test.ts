import test from 'node:test'
import assert from 'node:assert/strict'
import { ChangeSet, EditorState } from '@codemirror/state'
import { createBuffer } from '../../../../builtin/workbench/buffer.js'
import { createProject } from '../../../../builtin/workbench/editing/project.js'
import { undoEdit } from '../../../../builtin/workbench/editing/actions.js'
import { replaceProject } from '../../../../builtin/workbench/editing/replace.js'
import { asText, createHistory } from '../../../../builtin/workbench/editing/history.js'

test('项目卸载等待在途文件操作记账完成，再释放新增恢复令牌', async () => {
  const started = Promise.withResolvers<void>(), pending = Promise.withResolvers<void>(), released: string[] = []
  const owner = Symbol(), api = { fileOperation: async (input: { tokens: string[] }) => { released.push(...input.tokens) } }
  const project = createProject(api, assert.fail)
  const writing = project.exclusive(async () => {
    started.resolve(); await pending.promise
    project.history.record(owner, { kind: 'file', path: 'created.ts', token: 'created-token' })
  })
  await started.promise; project.dispose(); pending.resolve(); await writing
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(released, ['created-token'])
  await assert.rejects(project.run(() => assert.fail('卸载后不能启动写入')), /WORKBENCH_FILE_BUSY/)
})

test('连续快速撤销和重做按队列读取最新历史，不重复处理同一步', async () => {
  const file = { path: 'a.ts', text: 'const value = 1;', version: 'v1' }, owner = Symbol()
  const api = { read: async () => file }, project = createProject(api, assert.fail)
  const doc = createBuffer(file); doc.state = EditorState.create({ doc: file.text }); project.documents.set(file.path, doc)
  for (const insert of ['\n// first', '\n// second']) {
    const before = doc.state.doc, changes = ChangeSet.of({ from: before.length, insert }, before.length)
    doc.state = doc.state.update({ changes }).state
    project.history.record(owner, { kind: 'text', path: file.path, before, after: doc.state.doc, changes })
  }
  const full = doc.text
  const editing = { api, project, owner, documents: project.documents, current: file.path, schedule() {},
    applyText(path: string, changes: ChangeSet) { doc.state = doc.state.update({ changes }).state },
  }
  await Promise.all([undoEdit(editing, 'undo'), undoEdit(editing, 'undo')])
  assert.equal(doc.text, file.text)
  assert.equal(project.history.peek(owner, 'undo', file.path), null)
  await Promise.all([undoEdit(editing, 'redo'), undoEdit(editing, 'redo')])
  assert.equal(doc.text, full)
  project.dispose()
})

test('排队等待期间切换文件，撤销仍作用于按键时的文件', async () => {
  const owner = Symbol(), files = new Map(['a.ts', 'b.ts'].map(path => [path, { path, text: 'old', version: 'v1' }]))
  const api = { read: async (path: string) => files.get(path) }, project = createProject(api, assert.fail)
  for (const file of files.values()) {
    const doc = createBuffer(file), before = asText(file.text), changes = ChangeSet.of({ from: 0, to: before.length, insert: 'new' }, before.length)
    doc.state = EditorState.create({ doc: changes.apply(before) }); project.documents.set(file.path, doc)
    project.history.record(owner, { kind: 'text', path: file.path, before, after: doc.state.doc, changes })
  }
  let current = 'a.ts', resume!: () => void
  void project.run(() => new Promise<void>(resolve => { resume = resolve }))
  await Promise.resolve()
  const editing = { api, project, owner, documents: project.documents, get current() { return current }, schedule() {},
    applyText(path: string, changes: ChangeSet) { const doc = project.documents.get(path); doc.state = doc.state.update({ changes }).state },
  }
  const undo = undoEdit(editing, 'undo'); current = 'b.ts'; resume()
  assert.equal((await undo).path, 'a.ts')
  assert.equal(project.documents.get('a.ts').text, 'old'); assert.equal(project.documents.get('b.ts').text, 'new')
  project.dispose()
})

test('全局替换取消时已开始的写入仍记入撤销，后续文件不再修改', async () => {
  const abort = new AbortController(), owner = Symbol(), history = createHistory(), written: string[] = [], changed: string[] = []
  const project = { documents: new Map(), history, exclusive: async (action: () => unknown) => action() }
  const matches = ['first.ts', 'second.ts'].map(path => ({ path, version: 'v1' }))
  const result = replaceProject({ owner, project, matches, query: { search: 'old', replace: 'new', caseSensitive: true }, signal: abort.signal,
    api: { read: async (path: string) => ({ path, text: 'old', version: 'v1' }) },
    persist: async (path: string) => { abort.abort(); await Promise.resolve(); written.push(path) },
    applyText: (path: string) => changed.push(path), progress() {},
  })
  await assert.rejects(result, { name: 'AbortError' })
  assert.deepEqual(written, ['first.ts']); assert.deepEqual(changed, written)
  const entry = history.peek(owner, 'undo', 'first.ts')
  assert.equal(entry.before.toString(), 'old'); assert.equal(entry.after.toString(), 'new'); assert.equal(entry.saved, true)
})

test('全局替换分别报告过期、未保存与写入失败的文件，其余成功项保留历史', async () => {
  const owner = Symbol(), history = createHistory(), written: string[] = [], applied: string[] = []
  const project = { documents: new Map([['dirty.ts', { dirty: true }]]), history, exclusive: async (action: () => unknown) => action() }
  const matches = ['stale.ts', 'dirty.ts', 'fail.ts', 'same.ts', 'good.ts'].map(path => ({ path, version: 'v1' }))
  const result = await replaceProject({ owner, project, matches, query: { search: 'old', replace: 'new', caseSensitive: true }, signal: new AbortController().signal,
    api: { read: async (path: string) => ({ path, text: path === 'same.ts' ? 'unchanged' : 'old', version: path === 'stale.ts' ? 'v2' : 'v1' }) },
    persist: async (path: string) => { if (path === 'fail.ts') throw new Error('write failed'); written.push(path) },
    applyText: (path: string) => applied.push(path), progress() {},
  })
  assert.deepEqual(result.changed, ['good.ts']); assert.deepEqual(written, result.changed); assert.deepEqual(applied, result.changed)
  assert.deepEqual(result.failed.map((item: { path: string }) => item.path), ['stale.ts', 'dirty.ts', 'fail.ts'])
  assert.equal(history.peek(owner, 'undo', 'good.ts').after.eq(asText('new')), true)
  const entry = history.peek(owner, 'undo', 'good.ts'); history.complete(owner, 'undo', entry, entry)
  assert.equal(history.peek(owner, 'undo', ''), null)
})
