import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbenchPreference } from '../../../builtin/workbench/preference.js'
import { readPreferences, defaults, bindingsOf, conflict } from '../../../builtin/workbench/editor/preferences.js'
import { selectionThread, hasMark, applyReplacement, selectionSnapshot, mapThread } from '../../../builtin/workbench/assistant/selection-state.js'
import { EditorState, ChangeSet } from '@codemirror/state'

test('代码模块默认关闭，开关及时通知且只保存自己的设置', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) }
  const preference = createWorkbenchPreference(storage)
  assert.equal(preference.snapshot(), false)
  let notifications = 0
  const unsubscribe = preference.subscribe(() => notifications++)
  preference.save(true); preference.save(true)
  assert.equal(notifications, 1)
  assert.equal(createWorkbenchPreference(storage).snapshot(), true)
  unsubscribe(); preference.save(false)
  assert.equal(notifications, 1)
  assert.equal(data.size, 1)
})

test('模块开关写入失败时保留之前的有效状态', () => {
  const preference = createWorkbenchPreference({ getItem: () => null, setItem: () => { throw new Error('read-only') } })
  assert.throws(() => preference.save(true), /read-only/)
  assert.equal(preference.snapshot(), false)
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
