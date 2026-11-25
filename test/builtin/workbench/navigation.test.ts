import test from 'node:test'
import assert from 'node:assert/strict'
import { defaults, readPreferences, keyOf } from '../../../builtin/workbench/editor/preferences.js'
import { navigationItems } from '../../../builtin/workbench/navigation.js'

test('快速打开优先最近访问，文件关键词匹配路径，同名文件分别显示', () => {
  const state = { file: 'src/main.ts', recentFiles: ['src/main.ts', 'test/main.ts', '中文/入口.ts'], symbols: [] }
  const catalog = ['src/main.ts', 'test/main.ts', '中文/入口.ts', 'readme.md']
  assert.deepEqual(navigationItems('', state, catalog, []).map(item => item.target.file), ['test/main.ts', '中文/入口.ts', 'src/main.ts', 'readme.md'])
  assert.deepEqual(navigationItems('main', state, catalog, []).map(item => item.detail), ['test/main.ts', 'src/main.ts'])
  assert.equal(navigationItems('中文 入口', state, catalog, [])[0].target.file, '中文/入口.ts')
})

test('前缀切换当前文件符号和可搜索命令，不混入其他模式', () => {
  const target = { file: 'main.ts', name: 'calculate', line: 2, character: 9, offset: 30 }
  const state = { symbols: [target], recentFiles: [] }
  assert.deepEqual(navigationItems('@cal', state, ['calculate.ts'], [])[0].target, target)
  const commands = [{ id: 'save', label: '保存', disabled: true }, { id: 'find', label: '搜索' }]
  assert.deepEqual(navigationItems('>保存', state, [], commands).map(item => [item.id, item.disabled]), [['save', true]])
  assert.equal(navigationItems('missing', state, [], commands).length, 0)
})

test('新导航快捷键保留 IDEA 参数提示，既有自定义绑定优先于新增默认值', () => {
  const value = defaults()
  assert.equal(keyOf(value, 'parameters'), 'Mod-p')
  assert.equal(keyOf(value, 'navigateFiles'), 'Mod-Shift-o')
  assert.equal(keyOf({ ...value, keymap: 'vscode' }, 'navigateFiles'), 'Mod-p')
  const custom = readPreferences({ ...value, shortcuts: { save: 'Mod-Shift-o' } })
  assert.equal(keyOf(custom, 'save'), 'Mod-Shift-o')
  assert.equal(keyOf(custom, 'navigateFiles'), '')
})

test('main 的命令面板自定义快捷键迁移到所有操作，默认设置没有重复绑定', () => {
  const initial = readPreferences(defaults())
  assert.equal(keyOf(initial, 'commandPalette'), 'Mod-Shift-p')
  const migrated = readPreferences({ ...initial, shortcuts: { commands: 'Mod-Alt-p' } })
  assert.deepEqual(migrated.shortcuts, { commandPalette: 'Mod-Alt-p' })
  assert.equal(keyOf(migrated, 'commandPalette'), 'Mod-Alt-p')
  assert.throws(() => readPreferences({ ...initial, shortcuts: { commands: 'Mod-Alt-p', commandPalette: 'Mod-Shift-p' } }), /WORKBENCH_SHORTCUT_CONFLICT/)
})

test('文件行列输入从1转换为0，支持当前文件及含冒号的真实文件名', () => {
  const state = { file: 'src/main.ts', recentFiles: ['src/main.ts'], symbols: [] }
  const files = ['src/main.ts', '中文/入口.ts', 'notes:12', 'notes']
  assert.deepEqual(navigationItems('src/main.ts:120:8', state, files, [])[0].target, { file: 'src/main.ts', line: 119, character: 7 })
  assert.deepEqual(navigationItems('中文 入口:3', state, files, [])[0].target, { file: '中文/入口.ts', line: 2, character: 0 })
  assert.deepEqual(navigationItems(':4:2', state, files, [])[0].target, { file: 'src/main.ts', line: 3, character: 1 })
  assert.deepEqual(navigationItems('notes:12', state, files, [])[0].target, { file: 'notes:12' })
  for (const query of ['src/main.ts:0', 'src/main.ts:2:0', 'src/main.ts:9007199254740993']) assert.equal(navigationItems(query, state, files, []).length, 0)
})
