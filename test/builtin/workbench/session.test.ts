import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceSession } from '../../../builtin/workbench/session.js'

const workspace = () => ({ version: 1, updatedAt: 42, tree: 0, active: 0, panes: [{
  tabs: [{ path: 'src/main.ts', kind: 'file', pinned: true, dirty: false, location: { line: 8, character: 2, length: 0, viewport: { line: 5, offset: 4, left: 20 } } }],
  current: { file: 'src/main.ts', kind: 'file' }, recent: ['src/main.ts'],
}] })
const memory = () => {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}

test('工作记录按会话和项目隔离，读回固定标签、位置与分栏', () => {
  const storage = memory(), first = createWorkspaceSession(storage, 'session-one'), second = createWorkspaceSession(storage, 'session-two')
  const record = workspace()
  first.save('ssh://machine-a/project', record)
  assert.deepEqual(first.read('ssh://machine-a/project'), record)
  assert.equal(first.read('ssh://machine-b/project'), null)
  assert.equal(second.read('ssh://machine-a/project'), null)
  const split = { ...record, tree: { vertical: false, ratio: .6, children: [0, 1] }, active: 1, panes: [...record.panes, { ...record.panes[0], recent: ['other.ts'] }] }
  first.save('ssh://machine-a/project', split)
  assert.deepEqual(first.read('ssh://machine-a/project'), split)
})

test('拒绝损坏、未来版本和越界布局，不偷偷替换已有记录', () => {
  const storage = memory(), store = createWorkspaceSession(storage, 'session')
  store.save('/project', workspace())
  for (const value of [ { ...workspace(), version: 2 }, { ...workspace(), active: 3 }, { ...workspace(), tree: { vertical: true, ratio: .5, children: [0, 0] } } ]) {
    assert.throws(() => store.save('/project', value), /WORKBENCH_SESSION_INVALID/)
    assert.deepEqual(store.read('/project'), workspace())
  }
  const key = [...storage.data.keys()][0]!
  storage.setItem(key, '{broken')
  assert.throws(() => store.read('/project'), /WORKBENCH_SESSION_INVALID/)
})

test('超出分栏、标签或记录容量时说明容量不足，并保留上一份记录', () => {
  const storage = memory(), store = createWorkspaceSession(storage, 'session'), value = workspace()
  store.save('/project', value)
  for (const oversized of [
    { ...value, panes: Array.from({ length: 17 }, () => value.panes[0]) },
    { ...value, panes: [{ ...value.panes[0], tabs: Array.from({ length: 51 }, () => value.panes[0]!.tabs[0]) }] },
    { ...value, panes: [{ ...value.panes[0], tabs: Array.from({ length: 50 }, () => ({ ...value.panes[0]!.tabs[0], path: 'x'.repeat(4096) })), recent: Array.from({ length: 50 }, () => 'x'.repeat(4096)) }] },
  ]) {
    assert.throws(() => store.save('/project', oversized), /WORKBENCH_SESSION_SIZE/)
    assert.deepEqual(store.read('/project'), value)
  }
})

test('工作记录只接受界面元数据，不能把缓冲正文写入浏览器存储', () => {
  const storage = memory(), store = createWorkspaceSession(storage, 'session')
  const value = workspace()
  store.save('/project', { ...value, text: 'secret source', panes: [{ ...value.panes[0], tabs: [{ ...value.panes[0]!.tabs[0], text: 'draft source' }] }] })
  assert.deepEqual(store.read('/project'), value)
  assert.doesNotMatch([...storage.data.values()][0]!, /secret source|draft source/)
})

test('存储不可用时返回具体错误，已有记录保持原样', () => {
  const storage = memory(), store = createWorkspaceSession(storage, 'session')
  store.save('/project', workspace())
  storage.setItem = () => { throw new Error('quota') }
  assert.throws(() => store.save('/project', workspace()), /WORKBENCH_SESSION_WRITE/)
  assert.deepEqual(store.read('/project'), workspace())
  storage.getItem = () => { throw new Error('blocked') }
  assert.throws(() => store.read('/project'), /WORKBENCH_SESSION_READ/)
})
