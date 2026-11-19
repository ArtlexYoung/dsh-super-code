import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbenchPreference } from '../../../builtin/workbench/preference.js'
import { readPreferences, defaults, bindingsOf, conflict, keyOf, matchesShortcut } from '../../../builtin/workbench/editor/preferences.js'
import { selectionThread, hasMark, applyReplacement, selectionSnapshot, mapThread } from '../../../builtin/workbench/assistant/selection-state.js'
import { EditorState, ChangeSet } from '@codemirror/state'

test('代码模块默认关闭，开关及时通知且只保存自己的设置', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) }
  const preference = createWorkbenchPreference(storage)
  assert.equal(preference.snapshot().enabled, false)
  let notifications = 0
  const unsubscribe = preference.subscribe(() => notifications++)
  preference.save({ enabled: true }); preference.save({ enabled: true })
  assert.equal(notifications, 1)
  assert.equal(createWorkbenchPreference(storage).snapshot().enabled, true)
  unsubscribe(); preference.save({ enabled: false })
  assert.equal(notifications, 1)
  assert.equal(data.size, 1)
})

test('模块开关写入失败时保留之前的有效状态', () => {
  const preference = createWorkbenchPreference({ getItem: () => null, setItem: () => { throw new Error('read-only') } })
  assert.throws(() => preference.save({ enabled: true }), /read-only/)
  assert.equal(preference.snapshot().enabled, false)
})

test('旧学习开关迁移到统一工作台，关闭后不会被旧开关重新开启', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) }
  data.set('dsh-super-code-workbench-enabled', 'false')
  data.set('dsh-super-code-reading-enabled', 'true')
  const preference = createWorkbenchPreference(storage)
  assert.equal(preference.snapshot().enabled, true)
  preference.save({ enabled: false })
  assert.equal(preference.snapshot().enabled, false)
  assert.equal(createWorkbenchPreference(storage).snapshot().enabled, false)
  assert.equal(data.get('dsh-super-code-reading-enabled'), 'false')
  data.set('dsh-super-code-workbench-enabled', 'true')
  preference.refresh({ key: 'unrelated' }); assert.equal(preference.snapshot().enabled, false)
  preference.refresh({ key: 'dsh-super-code-workbench-enabled' }); assert.equal(preference.snapshot().enabled, true)
  data.clear(); preference.refresh({ key: null }); assert.equal(preference.snapshot().enabled, false)
})

test('编辑器默认 IDEA，支持独立配色、VS Code 绑定及无冲突的自定义快捷键', () => {
  const preferences = defaults()
  assert.equal(preferences.keymap, 'idea'); assert.equal(preferences.palette, 'idea')
  const updated = readPreferences({ ...preferences, palette: 'vscode', shortcuts: { definition: 'Ctrl-Shift-b' } })
  assert.equal(updated.keymap, 'idea')
  assert.equal(bindingsOf(updated, {}).find(item => item.key === 'Ctrl-Shift-b') !== undefined, true)
  assert.ok(conflict(preferences, 'find', 'Mod-b'))
  assert.throws(() => readPreferences({ ...preferences, shortcuts: { find: 'Mod-b' } }))
  assert.throws(() => readPreferences({ ...preferences, shortcuts: { invalid: 'Mod-k' } }))
})

test('新增多光标与扩词动作可配置，Ctrl+/ 保留单行注释绑定', () => {
  const preferences = readPreferences(defaults()), bindings = bindingsOf(preferences, {})
  for (const key of ['Ctrl-/', 'Ctrl-Alt-ArrowUp', 'Ctrl-Alt-ArrowDown', 'Alt-j', 'Ctrl-Alt-Shift-j', 'Ctrl-ArrowLeft', 'Ctrl-ArrowRight']) assert.ok(bindings.some(binding => binding.key === key), key)
  const model = { provider: 'demo', model: 'translation' }
  assert.deepEqual(readPreferences({ ...preferences, translationModel: model }).translationModel, model)
  assert.equal(readPreferences(preferences).translationModel, undefined)
  assert.throws(() => readPreferences({ ...preferences, translationModel: { provider: '', model: 'x' } }))
})

test('编辑器保存与历史设置兼容已有偏好，替换和保存快捷键可配置', () => {
  const preferences = readPreferences({ keymap: 'idea', palette: 'idea', shortcuts: {} })
  assert.equal(preferences.undoLimit, 1000); assert.equal(preferences.autoSave, 'manual')
  assert.ok(bindingsOf(preferences, {}).some(binding => binding.key === 'Ctrl-r'))
  assert.ok(bindingsOf(preferences, {}).some(binding => binding.key === 'Ctrl-Shift-r'))
  assert.ok(bindingsOf(preferences, {}).some(binding => binding.key === 'Ctrl-s'))
  assert.equal(readPreferences({ ...preferences, undoLimit: 2000, autoSave: '15' }).undoLimit, 2000)
  for (const value of [0, -1, 1.5, '1000', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => readPreferences({ ...preferences, undoLimit: value }), /WORKBENCH_PREFERENCES_INVALID/)
  for (const value of ['0', '10', 15, null, false]) assert.throws(() => readPreferences({ ...preferences, autoSave: value }), /WORKBENCH_PREFERENCES_INVALID/)
  assert.throws(() => readPreferences({ ...preferences, shortcuts: { replace: 'Mod-f' } }), /CONFLICT/)
  assert.equal(keyOf(readPreferences({ ...preferences, shortcuts: { replace: 'Ctrl-h' } }), 'replace'), 'Ctrl-h')
})

test('Esc 关闭弹框可配置且不会抢占编辑器补全和搜索的 Esc', () => {
  const preferences = defaults()
  assert.equal(keyOf(preferences, 'close'), 'Escape')
  assert.ok(matchesShortcut({ key: 'Escape' }, 'Escape'))
  assert.equal(matchesShortcut({ key: 'Escape', ctrlKey: true }, 'Escape'), false)
  const updated = readPreferences({ ...preferences, shortcuts: { close: 'Ctrl-k' } })
  assert.ok(matchesShortcut({ key: 'k', ctrlKey: true }, keyOf(updated, 'close')))
  assert.equal(bindingsOf(updated, {}).some(item => item.key === 'Ctrl-k' || item.key === 'Escape'), false)
  assert.throws(() => readPreferences({ ...preferences, shortcuts: { close: 'Mod-f' } }), /CONFLICT/)
})

test('顶栏快捷键默认显示，弹窗默认内嵌；旧偏好补齐，显式配置可保存恢复', () => {
  const legacy = { keymap: 'idea', palette: 'vscode', shortcuts: { find: 'Ctrl-k' } }
  const preferences = readPreferences(legacy)
  assert.equal(defaults().showToolbarShortcuts, true)
  assert.equal(defaults().windowMode, 'internal')
  assert.equal(preferences.showToolbarShortcuts, true)
  assert.equal(preferences.windowMode, 'internal')
  const changed = readPreferences(JSON.parse(JSON.stringify({ ...preferences, showToolbarShortcuts: false, windowMode: 'external' })))
  assert.equal(changed.showToolbarShortcuts, false)
  assert.equal(changed.windowMode, 'external')
  assert.deepEqual(bindingsOf(changed, {}).map(item => item.key), bindingsOf(preferences, {}).map(item => item.key))
  for (const value of [null, 0, 1, 'false', {}, []]) assert.throws(() => readPreferences({ ...preferences, showToolbarShortcuts: value }), /WORKBENCH_PREFERENCES_INVALID/)
  for (const value of [null, false, 0, '', 'popup', {}, []]) assert.throws(() => readPreferences({ ...preferences, windowMode: value }), /WORKBENCH_PREFERENCES_INVALID/)
})

test('工具文字默认开启，旧偏好补齐，可关闭恢复并拒绝非法值', () => {
  const legacy = { keymap: 'idea', palette: 'idea', shortcuts: { find: 'Ctrl-k' } }
  assert.equal(defaults().showToolNames, true)
  const preferences = readPreferences(legacy)
  assert.equal(preferences.showToolNames, true)
  for (const showToolNames of [false, true]) {
    const restored = readPreferences(JSON.parse(JSON.stringify({ ...preferences, showToolNames })))
    assert.deepEqual(restored, { ...preferences, showToolNames })
  }
  for (const showToolNames of [null, 0, 1, 'false', {}, []]) assert.throws(() => readPreferences({ ...preferences, showToolNames }), /WORKBENCH_PREFERENCES_INVALID/)
})

test('未发送的草稿没有标记，固定或发送后才显示', () => {
  const state = EditorState.create({ doc: 'const value = 1;', selection: { anchor: 6, head: 11 } })
  const thread = selectionThread('main.ts', state, 'thread')
  assert.equal(hasMark(thread), false)
  thread.draft = '解释'; assert.equal(hasMark(thread), false)
  thread.pinned = true; assert.equal(hasMark(thread), true)
  thread.pinned = false; thread.messages.push({ role: 'user', text: '解释' }); assert.equal(hasMark(thread), true)
})

test('模型请求期间选区前移动可映射，选区内修改后拒绝替换', () => {
  let state = EditorState.create({ doc: 'const value = 1;', selection: { anchor: 6, head: 11 } })
  let thread = selectionThread('main.ts', state, 'thread'), snapshot = selectionSnapshot(thread, state)
  const before = ChangeSet.of({ from: 0, insert: '// comment\n' }, state.doc.length)
  thread = mapThread(thread, before); state = state.update({ changes: before }).state
  const view = { get state() { return state }, dispatch(transaction: any) { state = state.update(transaction).state } }
  const result = applyReplacement(view, thread, snapshot, 'count')
  assert.equal(result.original, 'count'); assert.match(state.doc.toString(), /const count = 1/)
  const edited = ChangeSet.of({ from: result.from, to: result.to, insert: 'other' }, state.doc.length)
  thread = mapThread(result, edited); state = state.update({ changes: edited }).state
  assert.throws(() => applyReplacement(view, thread, snapshot, 'stale'))
})

test('选区修改按编辑器字符位置处理换行，模型返回不同换行风格仍可继续提问和撤销', () => {
  for (const separator of ['\n', '\r\n', '\r']) for (const replacement of ['a\nb', 'a\r\nb', 'a\rb', 'a\r\n😀', '']) {
    let state = EditorState.create({ doc: 'old', selection: { anchor: 0, head: 3 }, extensions: EditorState.lineSeparator.of(separator) })
    const thread = selectionThread('main.ts', state, 'thread'), snapshot = selectionSnapshot(thread, state)
    const view = { get state() { return state }, dispatch(transaction: any) { state = state.update(transaction).state } }
    const updated = applyReplacement(view, thread, snapshot, replacement)
    const lines = replacement.split(/\r\n?|\n/)
    assert.equal(state.doc.toString(), lines.join('\n'))
    assert.equal(state.doc.lines, lines.length)
    assert.equal(state.selection.main.to, state.doc.length)
    assert.equal(updated.to, state.doc.length)
    assert.equal(updated.original, lines.join(separator))
    if (replacement) assert.doesNotThrow(() => selectionSnapshot(updated, state))
  }
})

test('对话文件接管默认关闭，独立实时保存，不重置工作台和编辑设置', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) }
  const preference = createWorkbenchPreference(storage), initial = preference.snapshot()
  assert.deepEqual(initial, { enabled: false, openFiles: false })
  let count = 0
  preference.subscribe(() => count++)
  preference.save({ openFiles: true })
  assert.deepEqual(preference.snapshot(), { enabled: false, openFiles: true })
  preference.save({ enabled: true }); preference.save({ enabled: true })
  assert.equal(count, 2)
  assert.deepEqual(createWorkbenchPreference(storage).snapshot(), { enabled: true, openFiles: true })
  preference.save({ enabled: false })
  assert.equal(preference.snapshot().openFiles, true)
  data.set('dsh-super-code-workbench-open-files', 'false')
  preference.refresh({ key: 'dsh-super-code-workbench-open-files' })
  assert.deepEqual(preference.snapshot(), { enabled: false, openFiles: false })
  assert.equal(count, 4)
})

test('文件接管开关写入失败后快照保持稳定', () => {
  const preference = createWorkbenchPreference({ getItem: () => null, setItem: () => { throw new Error('read-only') } })
  const previous = preference.snapshot()
  assert.throws(() => preference.save({ openFiles: true }), /read-only/)
  assert.equal(preference.snapshot(), previous)
})
