import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbench } from '../../../builtin/workbench/controller.js'
import { defaults } from '../../../builtin/workbench/editor/preferences.js'
import { createEditorPreference } from '../../../builtin/workbench/preference.js'

function storage(t: any, value = JSON.stringify(defaults())) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const state = { value, writable: true }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => state.value,
    setItem(_key: string, next: string) { if (!state.writable) throw new Error('storage unavailable'); state.value = next },
  } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage') })
  return state
}

test('编辑偏好写入失败不改变有效值，恢复后可重试并重建读取', t => {
  const saved = storage(t)
  const workbench = createWorkbench({}, (key: string) => key)
  t.after(() => workbench.dispose())
  const original = workbench.snapshot().preferences, updated = { ...original, showToolbarShortcuts: false, showToolNames: false, windowMode: 'external', fontSize: 17, lineHeight: 1.7, fontFamily: 'menlo', chineseFontFamily: 'local:Songti SC', readerMode: true, stickyScroll: false }
  let changes = 0
  workbench.subscribe(() => changes++)
  saved.writable = false
  assert.throws(() => workbench.settings(updated), /settingsFailed/)
  assert.equal(workbench.snapshot().preferences, original)
  assert.equal(changes, 0, '保存失败不得发布未保存的偏好')
  assert.deepEqual(JSON.parse(saved.value), original)
  saved.writable = true
  workbench.settings(updated)
  assert.deepEqual(workbench.snapshot().preferences, updated)
  const reopened = createWorkbench({}, (key: string) => key)
  t.after(() => reopened.dispose())
  assert.deepEqual(reopened.snapshot().preferences, updated)
})

test('非法编辑偏好不会写入存储、改变有效设置或重置其他字段', t => {
  const saved = storage(t)
  const workbench = createWorkbench({}, (key: string) => key)
  t.after(() => workbench.dispose())
  const original = workbench.snapshot().preferences, serialized = saved.value
  for (const patch of [{ undoLimit: 0 }, { undoLimit: 1.5 }, { undoLimit: Number.MAX_SAFE_INTEGER + 1 }, { showToolbarShortcuts: 'false' }, { showToolNames: 'false' }, { followFile: 'true' }, { previewTabs: 1 }, { windowMode: 'popup' }, { shortcuts: { find: 'Mod-b' } }]) {
    assert.throws(() => workbench.settings({ ...original, ...patch }))
    assert.equal(workbench.snapshot().preferences, original)
    assert.equal(saved.value, serialized)
  }
})

test('旧设置默认开启目录跟随和预览，可关闭且重建后保留', t => {
  storage(t, JSON.stringify({ keymap: 'idea', palette: 'vscode', shortcuts: {} }))
  const workbench = createWorkbench({}, (key: string) => key)
  t.after(() => workbench.dispose())
  assert.equal(workbench.snapshot().preferences.followFile, true)
  assert.equal(workbench.snapshot().preferences.previewTabs, true)
  workbench.settings({ ...workbench.snapshot().preferences, followFile: false, previewTabs: false })
  const reopened = createWorkbench({}, (key: string) => key)
  t.after(() => reopened.dispose())
  assert.equal(reopened.snapshot().preferences.followFile, false)
  assert.equal(reopened.snapshot().preferences.previewTabs, false)
  assert.equal(reopened.snapshot().preferences.palette, 'vscode')
})

test('恢复有效设置后清除损坏提示，保留无关文件错误', t => {
  const saved = storage(t, '{invalid')
  const workbench = createWorkbench({}, (key: string) => key)
  t.after(() => workbench.dispose())
  assert.equal(workbench.snapshot().error, 'settingInvalid')
  workbench.settings({ ...workbench.snapshot().preferences, showToolbarShortcuts: false })
  assert.equal(workbench.snapshot().error, '')
  assert.equal(JSON.parse(saved.value).showToolbarShortcuts, false)
  workbench.fail(new Error('file unavailable'))
  workbench.settings({ ...workbench.snapshot().preferences, undoLimit: 1500 })
  assert.equal(workbench.snapshot().error, 'file unavailable')
})

test('全局偏好在不同项目控制器中实时同步，重建后仍保留，释放后停止通知', t => {
  storage(t)
  const preference = createEditorPreference(localStorage)
  const first = createWorkbench({}, (key: string) => key, { settings: preference })
  const second = createWorkbench({}, (key: string) => key, { settings: preference })
  t.after(() => first.dispose()); t.after(() => second.dispose())
  const next = { ...first.snapshot().preferences, palette: 'vscode', showToolNames: false, quickModel: { provider: 'demo', model: 'fast' }, quickReasoning: 'high', translationReasoning: 'off' }
  first.settings(next)
  assert.deepEqual(second.snapshot().preferences, next)
  preference.save({ ...next, translationModel: { provider: 'demo', model: 'translator' } })
  assert.equal(first.snapshot().preferences.translationModel.model, 'translator')
  assert.equal(second.snapshot().preferences.translationModel.model, 'translator')
  const restored = createWorkbench({}, (key: string) => key)
  t.after(() => restored.dispose())
  assert.deepEqual(restored.snapshot().preferences, first.snapshot().preferences)
  second.dispose()
  const released = second.snapshot()
  first.settings({ ...first.snapshot().preferences, quickReasoning: 'off' })
  assert.equal(second.snapshot(), released)
})

test('两组模型默认关闭思考，旧翻译模型、其他偏好及关闭设置均保留', t => {
  storage(t, JSON.stringify({ keymap: 'idea', palette: 'vscode', shortcuts: {}, translationModel: { provider: 'demo', model: 'previous' } }))
  const preference = createEditorPreference(localStorage)
  assert.equal(preference.snapshot().preferences.quickReasoning, 'off')
  assert.equal(preference.snapshot().preferences.translationReasoning, 'off')
  assert.equal(preference.snapshot().preferences.translationModel.model, 'previous')
  assert.equal(preference.snapshot().preferences.quickModel, undefined)
  let notifications = 0; preference.subscribe(() => notifications++)
  preference.save({ ...preference.snapshot().preferences, undoLimit: 1234 })
  preference.save(preference.snapshot().preferences)
  assert.equal(notifications, 1)
  assert.equal(preference.snapshot().preferences.palette, 'vscode')
})

test('全局偏好响应存储更新，损坏或写入失败时保留有效值并可恢复', t => {
  const saved = storage(t), preference = createEditorPreference(localStorage)
  const original = preference.snapshot().preferences
  saved.value = JSON.stringify({ ...original, translationReasoning: 'high' })
  preference.refresh({ key: 'unrelated' })
  assert.equal(preference.snapshot().preferences, original)
  preference.refresh({ key: 'dsh-super-code-workbench' })
  assert.equal(preference.snapshot().preferences.translationReasoning, 'high')
  const valid = preference.snapshot().preferences
  saved.value = '{invalid'; preference.refresh({ key: null })
  assert.equal(preference.snapshot().preferences, valid)
  assert.equal(preference.snapshot().invalid, true)
  saved.writable = false
  assert.throws(() => preference.save({ ...valid, quickReasoning: 'low' }), /WORKBENCH_SETTINGS_WRITE/)
  assert.equal(preference.snapshot().preferences, valid)
  saved.writable = true; preference.save(valid)
  assert.equal(preference.snapshot().invalid, false)
  saved.value = ''; preference.refresh({ key: null })
  assert.deepEqual(preference.snapshot().preferences, defaults())
})

test('两组全局模型设置拒绝无效值，不改动其他已经保存的偏好', t => {
  const saved = storage(t), preference = createEditorPreference(localStorage)
  const original = preference.snapshot(), serialized = saved.value
  for (const key of ['quickReasoning', 'translationReasoning']) {
    for (const value of [null, false, 0, '', ' ', [], {}, 'a'.repeat(257)]) {
      assert.throws(() => preference.save({ ...original.preferences, [key]: value }), /WORKBENCH_MODEL_SETTING/)
      assert.equal(preference.snapshot(), original)
      assert.equal(saved.value, serialized)
    }
  }
  for (const key of ['quickModel', 'translationModel']) {
    for (const value of [null, [], { provider: '', model: 'demo' }, { provider: 'demo', model: 'a'.repeat(257) }, { provider: 'demo', model: 'valid', reasoning: 'high' }]) {
      assert.throws(() => preference.save({ ...original.preferences, [key]: value }), /WORKBENCH_TRANSLATION_MODEL/)
      assert.equal(preference.snapshot(), original)
      assert.equal(saved.value, serialized)
    }
  }
  preference.save({ ...original.preferences, quickReasoning: 'custom-effort', translationModel: { provider: 'demo', model: 'a'.repeat(256) } })
  assert.equal(preference.snapshot().preferences.quickReasoning, 'custom-effort')
})
