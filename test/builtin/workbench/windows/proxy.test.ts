import test from 'node:test'
import assert from 'node:assert/strict'
import { createWindowProxy } from '../../../../builtin/workbench/windows/proxy.js'

test('独立窗口表单连续输入立即显示，延迟的宿主状态不能覆盖较新的输入', async () => {
  const sent: any[] = []
  const proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  const original = { file: null, panel: { kind: 'fileAction', id: 'form', name: '' }, preferences: {} }
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: original } })
    proxy.panel({ ...original.panel, name: 'a' })
    assert.equal(proxy.snapshot().panel.name, 'a')
    proxy.panel({ ...original.panel, name: 'ab' })
    assert.equal(proxy.snapshot().panel.name, 'ab')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sent.length, 2)
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, panel: sent[0].args[0] } } })
    assert.equal(proxy.snapshot().panel.name, 'ab')
    await proxy.accept({ kind: 'result', id: sent[0].id })
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, panel: sent[1].args[0] } } })
    await proxy.accept({ kind: 'result', id: sent[1].id })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(proxy.snapshot().panel.name, 'ab')
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, panel: null } } })
    assert.equal(proxy.snapshot().panel, null)
  } finally { proxy.dispose() }
})

test('独立窗口连续修改不同偏好立即显示，旧宿主快照不覆盖新选择', async () => {
  const { defaults } = await import('../../../../builtin/workbench/editor/preferences.js')
  const sent: any[] = [], proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  const original = { file: null, preferences: defaults() }
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: original } })
    const first = proxy.settings({ ...proxy.snapshot().preferences, showToolbarShortcuts: false })
    assert.equal(proxy.snapshot().preferences.showToolbarShortcuts, false)
    const second = proxy.settings({ ...proxy.snapshot().preferences, windowMode: 'external' })
    assert.equal(proxy.snapshot().preferences.windowMode, 'external')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sent.length, 2)
    assert.equal(sent[1].args[0].showToolbarShortcuts, false)
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, preferences: sent[0].args[0] } } })
    assert.equal(proxy.snapshot().preferences.windowMode, 'external')
    await proxy.accept({ kind: 'result', id: sent[0].id }); await first
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, preferences: sent[1].args[0] } } })
    await proxy.accept({ kind: 'result', id: sent[1].id }); await second
    assert.equal(proxy.snapshot().preferences.showToolbarShortcuts, false)
    assert.equal(proxy.snapshot().preferences.windowMode, 'external')
  } finally { proxy.dispose() }
})

test('独立窗口设置保存失败回退到最后确认值，后续可重试', async () => {
  const { defaults } = await import('../../../../builtin/workbench/editor/preferences.js')
  const sent: any[] = [], proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  const original = { file: null, preferences: defaults() }
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: original } })
    const update = { ...original.preferences, windowMode: 'external' }
    const pending = proxy.settings(update), failure = assert.rejects(pending, /storage unavailable/)
    assert.equal(proxy.snapshot().preferences.windowMode, 'external')
    await new Promise(resolve => setImmediate(resolve))
    await proxy.accept({ kind: 'error', id: sent[0].id, error: 'storage unavailable' }); await failure
    assert.deepEqual(proxy.snapshot().preferences, original.preferences)
    const retry = proxy.settings(update)
    await new Promise(resolve => setImmediate(resolve))
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, preferences: update } } })
    await proxy.accept({ kind: 'result', id: sent[1].id }); await retry
    assert.deepEqual(proxy.snapshot().preferences, update)
  } finally { proxy.dispose() }
})

test('较早设置失败不回退新输入，最新失败回退到最后成功回执', async () => {
  const { defaults } = await import('../../../../builtin/workbench/editor/preferences.js')
  const sent: any[] = [], proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  const original = { file: null, preferences: defaults() }
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: original } })
    const first = proxy.settings({ ...proxy.snapshot().preferences, showToolbarShortcuts: false })
    const firstFailure = assert.rejects(first, /first failed/)
    const second = proxy.settings({ ...proxy.snapshot().preferences, palette: 'vscode' })
    await new Promise(resolve => setImmediate(resolve))
    await proxy.accept({ kind: 'error', id: sent[0].id, error: 'first failed' }); await firstFailure
    assert.equal(proxy.snapshot().preferences.palette, 'vscode')
    assert.equal(proxy.snapshot().preferences.showToolbarShortcuts, false)
    const confirmed = sent[1].args[0]
    await proxy.accept({ kind: 'state', patch: { snapshot: { ...original, preferences: confirmed } } })
    await proxy.accept({ kind: 'result', id: sent[1].id }); await second
    const third = proxy.settings({ ...proxy.snapshot().preferences, windowMode: 'external' })
    const thirdFailure = assert.rejects(third, /third failed/)
    await new Promise(resolve => setImmediate(resolve))
    await proxy.accept({ kind: 'error', id: sent[2].id, error: 'third failed' }); await thirdFailure
    assert.deepEqual(proxy.snapshot().preferences, confirmed)
  } finally { proxy.dispose() }
})

test('外窗非法设置在发送前拒绝，断连后失败保留最后确认偏好', async () => {
  const { defaults } = await import('../../../../builtin/workbench/editor/preferences.js')
  const sent: any[] = [], proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  const original = { file: null, preferences: defaults() }
  await proxy.accept({ kind: 'state', patch: { snapshot: original } })
  assert.throws(() => proxy.settings({ ...original.preferences, undoLimit: 0 }), /WORKBENCH_PREFERENCES_INVALID/)
  assert.equal(sent.length, 0)
  assert.deepEqual(proxy.snapshot().preferences, original.preferences)
  const pending = proxy.settings({ ...original.preferences, windowMode: 'external' })
  const failure = assert.rejects(pending, /WORKBENCH_WINDOW_DISCONNECTED/)
  await new Promise(resolve => setImmediate(resolve))
  proxy.dispose(); await failure
  assert.deepEqual(proxy.snapshot().preferences, original.preferences)
})

test('独立窗口语言路径通过工作区专用调用保存，不写全局编辑偏好', async () => {
  const sent: any[] = [], proxy = createWindowProxy(async (message: any) => { sent.push(message) }, (key: string) => key)
  try {
    await proxy.accept({ kind: 'state', patch: { snapshot: { file: null, preferences: {}, environmentPaths: { python: '/first' } } } })
    const pending = proxy.environmentPaths({ python: '/next' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sent[0].method, 'environmentPaths')
    assert.deepEqual(sent[0].args, [{ python: '/next' }])
    await proxy.accept({ kind: 'state', patch: { snapshot: { file: null, preferences: {}, environmentPaths: { python: '/next' } } } })
    await proxy.accept({ kind: 'result', id: sent[0].id }); await pending
    assert.deepEqual(proxy.snapshot().environmentPaths, { python: '/next' })
    assert.equal(Object.hasOwn(proxy.snapshot().preferences, 'environmentPaths'), false)
  } finally { proxy.dispose() }
})
