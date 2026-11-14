import test from 'node:test'
import assert from 'node:assert/strict'
import { readLayout, saveLayout, panelWidth } from '../../../builtin/workbench/layout.js'

function fixture() {
  const data = new Map<string, string>()
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }
}

test('目录、右栏宽度和文件区的高度与折叠可以恢复，不改编辑器偏好', () => {
  const { data, storage } = fixture()
  storage.setItem('dsh-super-code-workbench', 'existing-preferences')
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, files: 280, filesOpen: true, outlineOpen: true })
  const layout = { explorer: 312, reading: 460, files: 240, filesOpen: true, outlineOpen: false }
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
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, files: 280, filesOpen: true, outlineOpen: true })
  storage.setItem('dsh-super-code-workbench-layout', JSON.stringify({ explorer: 300, reading: 420, files: null, filesOpen: false, outlineOpen: 'yes' }))
  assert.deepEqual(readLayout(storage), { explorer: 300, reading: 420, files: 280, filesOpen: false, outlineOpen: true })
  for (const width of [-Infinity, 0, 129, 200, 100000, Infinity]) {
    const clamped = panelWidth(width, 130, 500)
    assert.ok(clamped >= 130 && clamped <= 500)
  }
})
