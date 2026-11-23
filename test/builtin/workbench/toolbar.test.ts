import test from 'node:test'
import assert from 'node:assert/strict'
import { readToolbar, moveToolbar } from '../../../builtin/workbench/toolbar.js'
import { defaults, readPreferences } from '../../../builtin/workbench/editor/preferences.js'

test('原有编辑设置自动补齐工具栏，固定操作不参与显示隐藏和排序', () => {
  const value = readPreferences({ keymap: 'idea', palette: 'idea', shortcuts: {} })
  assert.deepEqual(value.toolbar.map((item: { id: string }) => item.id), ['back', 'forward', 'navigateFiles', 'find', 'replace', 'project', 'projectReplace', 'definition', 'complete', 'parameters', 'codeHistory', 'saveAll', 'drafts', 'undo', 'redo', 'navigateSymbols', 'readingFocus', 'saveConflict', 'reopenTab', 'navigateProjectSymbols'])
  assert.deepEqual(value.toolbar.filter((item: { visible: boolean }) => item.visible).map((item: { id: string }) => item.id), ['back', 'forward', 'navigateFiles', 'find', 'project'])
  for (const id of ['refresh', 'window', 'save', 'git', 'reading', 'settings']) assert.equal(value.toolbar.some((item: any) => item.id === id), false)
})

test('工具栏顺序、隐藏和空显示状态可保存恢复，不影响快捷键或其他偏好', () => {
  const original = defaults()
  const moved = moveToolbar(original.toolbar, 'project', -1)
  const toolbar = moved.map((item: any) => ({ ...item, visible: item.id !== 'find' }))
  const restored = readPreferences(JSON.parse(JSON.stringify({ ...original, toolbar })))
  assert.deepEqual(restored.toolbar, toolbar)
  assert.deepEqual(restored.shortcuts, original.shortcuts)
  assert.equal(restored.palette, original.palette)
  assert.deepEqual(original.toolbar.slice(3, 6).map((item: { id: string }) => item.id), ['find', 'replace', 'project'])
  assert.deepEqual(restored.toolbar.slice(3, 6).map((item: { id: string }) => item.id), ['find', 'project', 'replace'])
  assert.equal(readToolbar(toolbar.map((item: any) => ({ ...item, visible: false }))).some((item: any) => item.visible), false)
  assert.equal(readToolbar().filter((item: { visible: boolean }) => item.visible).length, 5)
})

test('排序保留动作和隐藏状态，越界移动不丢失项目', () => {
  const items = readToolbar().map((item: any) => ({ ...item, visible: item.id !== 'forward' }))
  assert.equal(moveToolbar(items, 'back', -1), items)
  assert.equal(moveToolbar(items, 'navigateProjectSymbols', 1), items)
  assert.equal(moveToolbar(items, 'missing', 1), items)
  const moved = moveToolbar(items, 'forward', -1)
  assert.deepEqual(moved[0], { id: 'forward', visible: false })
  assert.equal(new Set(moved.map((item: any) => item.id)).size, items.length)
  assert.equal(items[0].id, 'back')
})

test('工具栏拒绝重复、未知及非法条目，新增动作补到末尾', () => {
  for (const invalid of [null, {}, 'find', [null], [{ id: 'missing', visible: true }], [{ id: 'find' }], [{ id: 'find', visible: 'true' }], [{ id: 'find', visible: true }, { id: 'find', visible: false }]]) {
    assert.throws(() => readToolbar(invalid), /WORKBENCH_PREFERENCES_INVALID/)
  }
  const partial = readToolbar([{ id: 'find', visible: false }])
  assert.deepEqual(partial[0], { id: 'find', visible: false })
  assert.equal(partial.length, readToolbar().length)
  assert.equal(partial.find((item: { id: string }) => item.id === 'parameters')?.visible, false)
})

test('旧偏好中的刷新、独立窗口和保存自动转为固定操作，保留其他排序与隐藏状态', () => {
  const value = readToolbar([
    { id: 'save', visible: false }, { id: 'redo', visible: true },
    { id: 'window', visible: false }, { id: 'find', visible: false },
    { id: 'refresh', visible: false },
  ])
  assert.deepEqual(value.slice(0, 2), [{ id: 'redo', visible: true }, { id: 'find', visible: false }])
  assert.equal(value.some((item: any) => ['refresh', 'window', 'save'].includes(item.id)), false)
  assert.equal(value.length, readToolbar().length)
})


test('已有工具栏的全部可见设置保留，只有新增动作采用默认值', () => {
  const prior = [{ id: 'parameters', visible: true }, { id: 'find', visible: false }]
  assert.deepEqual(readToolbar(prior).slice(0, 2), prior)
})
