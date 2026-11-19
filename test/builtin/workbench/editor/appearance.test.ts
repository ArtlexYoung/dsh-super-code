import test from 'node:test'
import assert from 'node:assert/strict'
import { defaults, readPreferences } from '../../../../builtin/workbench/editor/preferences.js'
import { editorAppearance, editorFontSizes, editorLineHeights } from '../../../../builtin/workbench/editor/appearance.js'

test('旧偏好补齐阅读设置，默认增大代码而不扩大行距', () => {
  const legacy = readPreferences({ keymap: 'idea', palette: 'idea', shortcuts: {} })
  for (const value of [legacy, defaults()]) {
    assert.equal(value.fontSize, 14)
    assert.equal(value.lineHeight, 1.5)
    assert.equal(value.fontFamily, 'jetbrains')
    assert.equal(value.chineseFontFamily, 'system')
    assert.equal(value.readerMode, false)
    assert.equal(value.stickyScroll, true)
  }
})

test('字体与阅读开关可保存恢复，不改自动保存或快捷键', () => {
  const value = { ...defaults(), fontFamily: 'menlo', fontSize: 17, lineHeight: 1.7, readerMode: true, stickyScroll: false }
  assert.deepEqual(readPreferences(JSON.parse(JSON.stringify(value))), value)
  assert.equal(readPreferences(value).autoSave, 'manual')
  assert.deepEqual(readPreferences(value).shortcuts, {})
})

test('阅读器行高取整像素，所有字号行距均保留配置倍率且普通模式不变', () => {
  for (const fontSize of editorFontSizes) for (const lineHeight of editorLineHeights) {
    const preferences = { ...defaults(), fontSize, lineHeight, readerMode: true }
    const expected = (fontSize + 1) * Math.max(1.65, lineHeight)
    const rendered = editorAppearance(preferences)
    assert.equal(rendered.fontSize, `${fontSize + 1}px`)
    assert.match(rendered.lineHeight, /^\d+px$/)
    assert.ok(Math.abs(parseFloat(rendered.lineHeight) - expected) <= 0.5)
    assert.equal(preferences.lineHeight, lineHeight)
    assert.equal(editorAppearance({ ...preferences, readerMode: false }).lineHeight, String(lineHeight))
  }
})

test('阅读设置拒绝不合法的字体、尺寸、行距与开关', () => {
  const invalid = {
    fontFamily: ['url(https://example.invalid/font)', '', null, {}, 'unknown', ['menlo']],
    fontSize: [null, '14', 9, 25, 14.5, NaN, Infinity],
    lineHeight: [null, '1.5', 1.19, 2.01, NaN, Infinity],
    readerMode: [null, 0, 1, 'false', {}],
    stickyScroll: [null, 0, 1, 'false', {}],
  }
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    assert.throws(() => readPreferences({ ...defaults(), [key]: value }), /WORKBENCH_PREFERENCES_INVALID/, `${key}: ${String(value)}`)
  }
})
