import test from 'node:test'
import assert from 'node:assert/strict'
import { readLayout, saveLayout, createLayoutPreference, panelWidth, resizeSidebar } from '../../../builtin/workbench/layout.js'
const right = { conversation: 6, quick: 2, changes: 3, learning: 6 }
const panes = { conversation: true, quick: false, changes: false, learning: false }

function fixture() {
  const data = new Map<string, string>()
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }
}

test('目录、右栏宽度和文件区的高度与折叠可以恢复，不改编辑器偏好', () => {
  const { data, storage } = fixture()
  storage.setItem('dsh-super-code-workbench', 'existing-preferences')
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, files: 280, filesOpen: true, outlineOpen: true, explorerOpen: true, rightOpen: true, right, panes })
  const layout = { explorer: 312, reading: 460, files: 240, filesOpen: true, outlineOpen: false, explorerOpen: true, rightOpen: true, right, panes }
  saveLayout(storage, layout)
  assert.deepEqual(readLayout(storage), layout)
  assert.equal(data.get('dsh-super-code-workbench'), 'existing-preferences')
  saveLayout(storage, { ...layout, filesOpen: false })
  assert.deepEqual(readLayout(storage), { ...layout, filesOpen: false })
})

test('忽略旧学习开关，无效尺寸使用默认值，保留可识别的旧宽度', () => {
  const { storage } = fixture()
  storage.setItem('dsh-super-code-reading-enabled', 'true')
  assert.equal('learningOpen' in readLayout(storage), false)
  storage.setItem('dsh-super-code-workbench-layout', 'broken')
  assert.equal(readLayout(storage).filesOpen, true)
  storage.setItem('dsh-super-code-workbench-layout', JSON.stringify({ explorer: -1, reading: 'wide', learningOpen: false }))
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, files: 280, filesOpen: true, outlineOpen: true, explorerOpen: true, rightOpen: true, right, panes })
  storage.setItem('dsh-super-code-workbench-layout', JSON.stringify({ explorer: 300, reading: 420, files: null, filesOpen: false, outlineOpen: 'yes' }))
  assert.deepEqual(readLayout(storage), { explorer: 300, reading: 420, files: 280, filesOpen: false, outlineOpen: true, explorerOpen: true, rightOpen: true, right, panes })
  for (const width of [-Infinity, 0, 129, 200, 100000, Infinity]) {
    const clamped = panelWidth(width, 130, 500)
    assert.ok(clamped >= 130 && clamped <= 500)
  }
})

test('右侧比例可保存，旧布局或无效比例不影响目录偏好', () => {
  const { storage } = fixture()
  saveLayout(storage, { explorer: 300, right: { conversation: 4, quick: 3, changes: 2 } })
  assert.deepEqual(readLayout(storage).right, { conversation: 4, quick: 3, changes: 2, learning: 6 })
  saveLayout(storage, { explorer: 300, right: { conversation: -1, quick: 'large', changes: 1e308 } })
  assert.deepEqual(readLayout(storage).right, right)
  assert.equal(readLayout(storage).explorer, 300)
})

test('调高只在相邻展开项之间分配空间，极端拖动保留最小高度', () => {
  const resized = resizeSidebar(right, 'conversation', 'changes', { before: 300, after: 150, delta: -100 })
  assert.deepEqual(resized, { conversation: 4, quick: 2, changes: 5, learning: 6 })
  const moved = resizeSidebar(right, 'quick', 'changes', { before: 200, after: 300, delta: 10000 })
  assert.equal(moved.conversation, right.conversation)
  assert.equal(moved.quick + moved.changes, 5)
  assert.equal(Math.round(500 * moved.changes / 5), 70)
  const minimum = resizeSidebar(right, 'quick', 'changes', { before: 50, after: 50, delta: -10000 })
  assert.deepEqual(minimum, { conversation: 6, quick: 2.5, changes: 2.5, learning: 6 })
})

test('学习区高度与其他右栏独立保存，旧布局自动补齐比例', () => {
  const { storage } = fixture()
  saveLayout(storage, { right: { conversation: 4, quick: 3, changes: 2, learning: 5 } })
  assert.deepEqual(readLayout(storage).right, { conversation: 4, quick: 3, changes: 2, learning: 5 })
  const resized = resizeSidebar(right, 'changes', 'learning', { before: 150, after: 300, delta: 50 })
  assert.deepEqual(resized, { conversation: 6, quick: 2, changes: 4, learning: 5 })
})

test('左右侧栏收起独立记忆，不丢失原宽度与右栏比例', () => {
  const { storage } = fixture(), original = readLayout(storage)
  const closed = { conversation: false, quick: false, changes: false, learning: false }
  saveLayout(storage, { ...original, explorer: 310, reading: 400, explorerOpen: false, rightOpen: false, panes: closed })
  assert.deepEqual(readLayout(storage), { ...original, explorer: 310, reading: 400, explorerOpen: false, rightOpen: false, panes: closed })
})

test('旧整体开关恢复原对话区，逐项开关只接受布尔值', () => {
  const { storage } = fixture()
  for (const rightOpen of [true, false]) {
    saveLayout(storage, { rightOpen })
    assert.deepEqual(readLayout(storage).panes, { ...panes, conversation: rightOpen })
  }
  saveLayout(storage, { rightOpen: false, panes: { conversation: 'yes', quick: true, changes: 1, learning: true } })
  assert.deepEqual(readLayout(storage).panes, { conversation: false, quick: true, changes: false, learning: true })
})

test('多个视图共用完整布局，逐项切换和拖动保留其他侧栏，原键保存后可恢复', () => {
  const { storage, data } = fixture(), layout = createLayoutPreference(storage), updates: unknown[] = [], other: unknown[] = []
  storage.setItem('dsh-super-code-workbench', 'existing-preferences')
  const unsubscribe = layout.subscribe(() => updates.push(layout.snapshot()))
  const stop = layout.subscribe(() => other.push(layout.snapshot()))
  layout.change({ outlineOpen: false, panes: { quick: true } })
  layout.change({ reading: 420, panes: { conversation: false } })
  assert.deepEqual(layout.snapshot().panes, { conversation: false, quick: true, changes: false, learning: false })
  assert.equal(layout.snapshot().rightOpen, true)
  assert.equal(layout.snapshot().outlineOpen, false)
  layout.change({ right: { ...right, quick: 5 } })
  layout.save()
  assert.deepEqual(createLayoutPreference(storage).snapshot(), layout.snapshot())
  assert.equal(data.get('dsh-super-code-workbench'), 'existing-preferences')
  assert.equal(updates.length, 3)
  assert.equal(other.length, 3)
  unsubscribe()
  layout.change({ panes: { quick: false } })
  assert.equal(layout.snapshot().rightOpen, false)
  assert.equal(updates.length, 3)
  assert.equal(other.length, 4)
  stop()
})

test('布局存储失败明确报错，不影响当前窗口同步且可重试保存', () => {
  const { storage } = fixture(), original = readLayout(storage)
  let unavailable = true
  const layout = createLayoutPreference({ ...storage, setItem(key: string, value: string) {
    if (unavailable) throw new Error('storage unavailable')
    storage.setItem(key, value)
  } })
  layout.change({ panes: { conversation: false, learning: true } })
  assert.throws(layout.save, /storage unavailable/)
  assert.deepEqual(readLayout(storage), original)
  assert.equal(layout.snapshot().panes.learning, true)
  unavailable = false
  layout.save()
  assert.deepEqual(readLayout(storage), layout.snapshot())
})
