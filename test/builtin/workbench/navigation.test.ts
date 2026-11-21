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
