import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, type ChangeSet } from '@codemirror/state'
import { createBuffer } from '../../../../builtin/workbench/buffer.js'
import { createProject } from '../../../../builtin/workbench/editing/project.js'
import { readSaveConflict, applySaveConflict } from '../../../../builtin/workbench/editing/save-conflict.js'

function fixture(base = 'one\ntwo\n', draft = 'ONE\ntwo\n', disk = 'one\nTWO\n') {
  let source = { path: 'a.ts', text: disk, version: 'v2' }
  const doc = createBuffer({ path: 'a.ts', text: base, version: 'v1' })
  doc.state = EditorState.create({ doc: draft })
  const api = { read: async () => source }, project = createProject(api, assert.fail), owner = Symbol()
  project.documents.set('a.ts', doc)
  const editing = { api, project, owner, binding: {}, cancel() {},
    applyText(_path: string, changes: ChangeSet) { doc.state = doc.state.update({ changes }).state },
  }
  return { doc, editing, external(text: string) { source = { ...source, text, version: 'v3' } } }
}

test('比较不改草稿或磁盘，合并不重叠修改并保留 CRLF 和可撤销记录', async () => {
  const { doc, editing } = fixture('one\r\ntwo\r\n', 'ONE\ntwo\n', 'one\r\nTWO\r\n')
  const entry = await readSaveConflict(editing, 'a.ts')
  assert.equal(entry.merged, 'ONE\r\nTWO\r\n')
  assert.equal(doc.text, 'ONE\r\ntwo\r\n')
  assert.equal(doc.version, 'v1')
  await applySaveConflict(editing, entry, entry.merged)
  assert.equal(doc.text, 'ONE\r\nTWO\r\n')
  assert.equal(doc.original, 'one\r\nTWO\r\n')
  assert.equal(doc.version, 'v2')
  assert.equal(doc.dirty, true)
  assert.equal(editing.project.history.peek(editing.owner, 'undo', 'a.ts').before.toString(), 'ONE\ntwo\n')
  editing.project.dispose()
})

test('相同变化不报冲突，同处不同变化等待明确选择', async () => {
  for (const [draft, disk, merged] of [['ONE', 'ONE', 'ONE'], ['ONE', 'other', null]]) {
    const { doc, editing } = fixture('one', draft!, disk!)
    const entry = await readSaveConflict(editing, 'a.ts')
    assert.equal(entry.merged, merged)
    if (merged === null) {
      await applySaveConflict(editing, entry, 'chosen')
      assert.equal(doc.text, 'chosen')
    }
    editing.project.dispose()
  }
})

test('比较后磁盘、其他视图的草稿或项目变化时拒绝应用，保留双方内容', async () => {
  for (const change of ['disk', 'draft', 'project']) {
    const { doc, editing, external } = fixture()
    const entry = await readSaveConflict(editing, 'a.ts')
    if (change === 'disk') external('new disk')
    if (change === 'draft') doc.state = EditorState.create({ doc: 'another draft' })
    if (change === 'project') editing.project.id = 'different-project'
    const before = doc.text
    await assert.rejects(applySaveConflict(editing, entry, entry.merged), /WORKBENCH_(CONFLICT_STALE|DRAFT_CHANGED|PROJECT_CHANGED)/)
    assert.equal(doc.text, before)
    assert.equal(doc.version, 'v1')
    editing.project.dispose()
  }
})

test('读盘期间的编辑不会被旧快照覆盖，返回最新草稿供用户比较', async () => {
  const { doc, editing } = fixture()
  const read = editing.api.read
  editing.api.read = async () => { doc.state = EditorState.create({ doc: 'latest draft' }); return read() }
  const entry = await readSaveConflict(editing, 'a.ts')
  assert.equal(entry.draft, 'latest draft')
  editing.project.dispose()
})
