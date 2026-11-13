import test from 'node:test'
import assert from 'node:assert/strict'
import { readLayout, saveLayout, panelWidth } from '../../../builtin/workbench/layout.js'

function fixture() {
  const data = new Map<string, string>()
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }
}

test('目录和学习侧栏的宽度与打开状态可以保存并恢复，不改编辑器偏好', () => {
  const { data, storage } = fixture()
  storage.setItem('dsh-super-code-workbench', 'existing-preferences')
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, learningOpen: false })
  const layout = { explorer: 312, reading: 460, learningOpen: true }
  saveLayout(storage, layout)
  assert.deepEqual(readLayout(storage), layout)
  assert.equal(data.get('dsh-super-code-workbench'), 'existing-preferences')
  saveLayout(storage, { ...layout, learningOpen: false })
  assert.deepEqual(readLayout(storage), { ...layout, learningOpen: false })
})

test('旧学习开关只决定没有保存布局时的初始状态，无效宽度使用默认值', () => {
  const { storage } = fixture()
  storage.setItem('dsh-super-code-reading-enabled', 'true')
  assert.equal(readLayout(storage).learningOpen, true)
  storage.setItem('dsh-super-code-workbench-layout', 'broken')
  assert.equal(readLayout(storage).learningOpen, true)
  storage.setItem('dsh-super-code-workbench-layout', JSON.stringify({ explorer: -1, reading: 'wide', learningOpen: false }))
  assert.deepEqual(readLayout(storage), { explorer: 220, reading: 380, learningOpen: false })
  for (const width of [-Infinity, 0, 129, 200, 100000, Infinity]) {
    const clamped = panelWidth(width, 130, 500)
    assert.ok(clamped >= 130 && clamped <= 500)
  }
})
