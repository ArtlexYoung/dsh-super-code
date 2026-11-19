import test from 'node:test'
import assert from 'node:assert/strict'
import { createEnvironmentPreference, readEnvironmentPaths } from '../../../builtin/workbench/environment-preference.js'
import { createEditorPreference } from '../../../builtin/workbench/preference.js'
import { defaults } from '../../../builtin/workbench/editor/preferences.js'

function fixture() {
  const values = new Map<string, string>()
  let writable = true
  return { values, writable: (value: boolean) => { writable = value }, storage: {
    getItem: (key: string) => values.get(key),
    setItem(key: string, value: string) { if (!writable) throw new Error('read-only'); values.set(key, value) },
  } }
}

test('工作区路径独立持久化，不继承旧全局值，修改外观不清除环境', () => {
  const { values, storage } = fixture()
  values.set('dsh-super-code-workbench', JSON.stringify({ ...defaults(), environmentPaths: { python: '/old-global' } }))
  const global = createEditorPreference(storage), first = createEnvironmentPreference(storage, '/中文 项目'), other = createEnvironmentPreference(storage, '/中文 项目2')
  assert.deepEqual(first.snapshot().paths, {})
  assert.equal(Object.hasOwn(global.snapshot().preferences, 'environmentPaths'), false)
  first.save({ python: ' .venv ', javascript: '' })
  assert.deepEqual(first.snapshot().paths, { python: '.venv' })
  assert.deepEqual(other.snapshot().paths, {})
  global.save({ ...global.snapshot().preferences, palette: 'vscode' })
  assert.deepEqual(createEnvironmentPreference(storage, '/中文 项目').snapshot().paths, { python: '.venv' })
})

test('保存失败或非法输入不发布，损坏缓存明确标记，允许纠正和清空', () => {
  const { values, storage, writable } = fixture(), preference = createEnvironmentPreference(storage, '/project')
  let count = 0; preference.subscribe(() => count++)
  preference.save({ python: '/valid' }); const state = preference.snapshot()
  writable(false)
  assert.throws(() => preference.save({ python: '/lost' }), /WORKBENCH_SETTINGS_WRITE/)
  assert.equal(preference.snapshot(), state); assert.equal(count, 1)
  writable(true)
  for (const value of [null, [], { fake: '' }, { python: 3 }, { python: 'a\0' }, { python: 'a'.repeat(4097) }]) assert.throws(() => readEnvironmentPaths(value))
  assert.equal(preference.snapshot(), state)
  values.set([...values.keys()][0], '{broken')
  preference.refresh(); assert.equal(preference.snapshot().invalid, true)
  assert.deepEqual(preference.snapshot().paths, { python: '/valid' })
  preference.save({}); assert.deepEqual(preference.snapshot(), { paths: {}, invalid: false })
})

test('跨页面存储通知只刷新对应工作区，清除通知重置自动识别', () => {
  const { storage, values } = fixture(), first = createEnvironmentPreference(storage, '/first'), second = createEnvironmentPreference(storage, '/second')
  first.save({ go: '/sdk' })
  const reader = createEnvironmentPreference(storage, '/first')
  first.save({ go: '/next' })
  reader.refresh({ key: 'unrelated' }); assert.equal(reader.snapshot().paths.go, '/sdk')
  reader.refresh({ key: [...values.keys()][0] }); assert.equal(reader.snapshot().paths.go, '/next')
  assert.deepEqual(second.snapshot().paths, {})
  values.clear(); reader.refresh({ key: null }); assert.deepEqual(reader.snapshot().paths, {})
})
