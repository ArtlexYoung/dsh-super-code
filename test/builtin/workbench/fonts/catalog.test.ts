import test from 'node:test'
import assert from 'node:assert/strict'
import { defaults, readPreferences } from '../../../../builtin/workbench/editor/preferences.js'
import { editorAppearance } from '../../../../builtin/workbench/editor/appearance.js'
import { detectFonts, fontChoices } from '../../../../builtin/workbench/fonts/catalog.js'

test('新默认使用内嵌英文和系统中文，旧字体选择保持，动态字体可以保存并安全生成CSS', () => {
  assert.equal(defaults().fontFamily, 'jetbrains')
  assert.equal(defaults().chineseFontFamily, 'system')
  const legacy = readPreferences({ keymap: 'idea', palette: 'idea', shortcuts: {}, fontFamily: 'menlo' })
  assert.equal(legacy.fontFamily, 'menlo'); assert.equal(legacy.chineseFontFamily, 'system')
  const value = readPreferences({ ...defaults(), fontFamily: 'local:My Mono', chineseFontFamily: 'local:苹方-简' })
  assert.deepEqual(readPreferences(JSON.parse(JSON.stringify(value))), value)
  assert.match(editorAppearance(value).fontFamily, /"My Mono".*"苹方-简"/)
  const quoted = readPreferences({ ...value, chineseFontFamily: 'local:My "Font", Other' })
  assert.match(editorAppearance(quoted).fontFamily, /"My \\"Font\\", Other"/)
})

test('字体设置拒绝非字符串、空名称、控制字符及超长名称', () => {
  for (const key of ['fontFamily', 'chineseFontFamily']) for (const value of [null, {}, [], 'local:', 'local:   ', 'local:Bad\nFont', 'local:' + 'a'.repeat(257)]) {
    assert.throws(() => readPreferences({ ...defaults(), [key]: value }), /WORKBENCH_PREFERENCES_INVALID/)
  }
})

test('后端候选逐项核对当前电脑，不把远程服务器字体当成可用字体', async () => {
  const queried: string[] = []
  const fonts = await detectFonts({ host: async () => ['Only Server', 'Menlo', '苹方-简', 'Menlo'], available: async name => { queried.push(name); return ['Menlo', '苹方-简'].includes(name) }, environment: {} })
  assert.deepEqual(fonts.families, ['Menlo', '苹方-简'])
  assert.equal(queried.filter(name => name === 'Menlo').length, 1)
  assert.equal(fonts.complete, false)
  assert.ok(!fonts.families.includes('Only Server'))
})

test('浏览器已授权时自动枚举，未授权时不弹窗，明确请求才读取完整列表', async () => {
  let called = 0
  const environment = { permissions: { query: async () => ({ state: 'prompt' }) }, queryLocalFonts: async () => { called++; return [{ family: 'Custom Font' }, { family: 'Custom Font' }] } }
  const options = { host: async () => [], available: async () => false, environment }
  assert.equal((await detectFonts(options)).complete, false); assert.equal(called, 0)
  assert.deepEqual(await detectFonts({ ...options, full: true }), { families: ['Custom Font'], complete: true, failed: false })
  assert.equal(called, 1)
  environment.permissions.query = async () => ({ state: 'granted' })
  assert.equal((await detectFonts(options)).complete, true); assert.equal(called, 2)
})

test('字体枚举或权限失败保留实际可用选项，取消不发布结果', async () => {
  const fonts = await detectFonts({ host: async () => { throw new Error('offline') }, available: async name => name === 'Menlo', environment: {} })
  assert.deepEqual(fonts.families, ['Menlo']); assert.equal(fonts.failed, true)
  const denied = await detectFonts({ host: async () => [], available: async () => false, full: true, environment: { queryLocalFonts: async () => { throw new Error('denied') } } })
  assert.equal(denied.complete, false); assert.equal(denied.failed, true)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(detectFonts({ signal: abort.signal, host: async () => [], available: async () => false, environment: {} }), { name: 'AbortError' })
})

test('失效的当前字体仍展示以便更换，英文保留内嵌选项、中文有系统回退', () => {
  const t = (key: string) => key
  const english = fontChoices(['Menlo'], 'local:Missing Font', false, t)
  assert.ok(english.some(([key]) => key === 'jetbrains')); assert.ok(english.some(([key]) => key === 'menlo'))
  assert.ok(english.some(([key, label]) => key === 'local:Missing Font' && label.includes('fontUnavailable')))
  assert.ok(!fontChoices(['Menlo'], 'system', true, t).some(([key]) => key === 'jetbrains'))
})
