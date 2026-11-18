import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function client(react = {}, timers = {}) {
  let plugin: any
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    structuredClone, setTimeout, clearTimeout, ...timers,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button', ...react } : {}) } },
  })
  return plugin
}
const configuration = () => ({ version: 1, activeId: 'builtin:ptc', custom: [
  { id: 'custom:one', name: '我的工具', execution: 'native', shell: 'standard', tools: ['ask_user_question'] },
] })
const snapshot = () => ({ configuration: configuration(), revision: 1, generation: 'host-one', writable: true })

test('preview and edits do not activate a profile; explicit use and deletion update the same document', () => {
  const plugin = client(), original = configuration()
  const edited = plugin.toolConfiguration(original, { type: 'edit', id: 'custom:one', patch: { name: '新名称', tools: [] } })
  assert.equal(original.custom[0]!.name, '我的工具')
  assert.equal(edited.activeId, 'builtin:ptc')
  assert.equal(edited.custom[0].name, '新名称')
  const used = plugin.toolConfiguration(edited, { type: 'use', id: 'custom:one' })
  assert.equal(used.activeId, 'custom:one')
  const removed = plugin.toolConfiguration(used, { type: 'delete', id: 'custom:one' })
  assert.equal(removed.activeId, 'builtin:super-code')
  assert.equal(removed.custom.length, 0)
})
test('tool autosave preserves failed drafts, does not replay after reconnect, and supports explicit retry', async () => {
  let calls = 0, connected = false
  const editor = client().createToolAutosave({ saveConfig: async (content: string, expected: string) => {
    calls++
    if (!connected) throw new Error('disconnected')
    assert.equal(expected, '1:host-one')
    return { ok: true, value: { ok: true, snapshot: { ...snapshot(), revision: 2, configuration: JSON.parse(content) } } }
  } })
  editor.receive(snapshot())
  editor.change({ activeId: 'custom:one' }); await editor.flush()
  assert.equal(editor.getSnapshot().error, 'save-failed')
  connected = true; await editor.flush()
  assert.equal(calls, 1)
  assert.equal(editor.getSnapshot().draft.activeId, 'custom:one')
  await editor.retry()
  assert.equal(calls, 2)
  assert.equal(editor.getSnapshot().notice, 'saved')
})
test('conflicts retain tool drafts and invalid names never write', async () => {
  let calls = 0
  const editor = client().createToolAutosave({ saveConfig: async () => { calls++; return { ok: true, value: { ok: false, error: 'conflict' } } } })
  editor.receive(snapshot())
  editor.change({ custom: [{ ...configuration().custom[0], name: ' ' }] }); await editor.flush()
  assert.equal(calls, 0)
  assert.equal(editor.getSnapshot().error, 'invalid')
  editor.change({ custom: [{ ...configuration().custom[0], name: '保留草稿' }] }); await editor.flush()
  assert.equal(calls, 1)
  assert.equal(editor.getSnapshot().error, 'conflict')
  assert.equal(editor.getSnapshot().draft.custom[0].name, '保留草稿')
})
test('edits during an in-flight save serialize against its returned revision', async () => {
  let finish!: () => void
  const revisions: string[] = []
  const editor = client().createToolAutosave({ saveConfig: async (content: string, expected: string) => {
    revisions.push(expected)
    if (revisions.length === 1) await new Promise<void>(resolve => { finish = resolve })
    return { ok: true, value: { ok: true, snapshot: { ...snapshot(), revision: revisions.length + 1, configuration: JSON.parse(content) } } }
  } })
  editor.receive(snapshot())
  editor.change({ activeId: 'builtin:standard' })
  editor.change({ activeId: 'custom:one' })
  finish(); await editor.flush()
  assert.deepEqual(revisions, ['1:host-one', '2:host-one'])
  assert.equal(editor.getSnapshot().draft.activeId, 'custom:one')
})

function viewFixture(statusAvailable = true) {
  let values: any[] = [], cursor = 0, Settings: any, injected: any
  const effects: Function[] = []
  const React = { Fragment: 'fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children }),
    useState: (initial: any) => { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value: any) => { values[index] = typeof value === 'function' ? value(values[index]) : value }] },
    useRef: (initial: any) => ({ current: initial }), useEffect: (effect: Function) => effects.push(effect), useLayoutEffect() {},
    useSyncExternalStore: (_subscribe: any, get: any) => get(), useMemo: (get: any) => get(),
  }
  const scheduled: Function[] = []
  const plugin = client(React, { setTimeout: (callback: Function) => { scheduled.push(callback); return scheduled.length }, clearTimeout() {} })
  const ctx = { effect() {}, inject() {}, remote: { $mount: async () => {} }, locale: { bind: () => (key: string) => key },
    slots: { inject: (_: string, callback: any) => callback(), register: (options: any, component: any) => {
      if (options.name === 'settings.section') { Settings = component; injected = options.inject() }
      return () => {}
    } } }
  plugin.apply(ctx)
  const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' && 'type' in node ? [node, ...node.children.flatMap(walk)] : []
  const shell = Settings({ ...injected, t: (key: string) => key })
  const View = walk(shell).find(node => node.props.editor === injected.toolEditor).type
  values = []; cursor = 0; effects.length = 0
  let stored: any = { ...snapshot(), builtins: ['standard', 'ptc', 'minimal', 'create', 'super-code'].map(name => ({ id: 'builtin:' + name, name, execution: name === 'ptc' || name === 'super-code' ? 'ptc' : 'native', shell: 'standard', tools: ['ask_user_question'] })),
    catalog: [{ name: 'ask_user_question', group: 'questions', available: true }, { name: 'third_party', group: 'external', available: true }], sessions: [] }
  let writes = 0, reads = 0
  const api = { readConfig: async () => { reads++; return { ok: true, value: structuredClone(stored) } }, status: async () => ({ ok: statusAvailable, value: [] }),
    saveConfig: async (content: string) => { writes++; stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }; return { ok: true, value: { ok: true, snapshot: stored } } } }
  const editor = plugin.createToolAutosave(api); editor.receive(stored)
  const render = (active = true) => { cursor = 0; effects.length = 0; return walk(View({ api, editor, t: (key: string) => key, active })) }
  return { render, effects, editor, scheduled, reads: () => reads, writes: () => writes, stored: () => stored,
    writable: (value: boolean) => { stored = { ...stored, writable: value }; editor.permissions(value) } }
}
test('actual Tools component previews without saving, explicitly activates custom tools and keeps builtins read-only', async () => {
  const f = viewFixture()
  let nodes = f.render()
  const picker = () => nodes.find(node => node.props.id === 'super-code-tool-profile' && node.props.onChange)
  const button = (text: string) => nodes.find(node => node.children.includes(text) && node.props.onClick)
  const input = (id: string) => nodes.find(node => node.props.id === id && node.props.onChange)
  assert.equal(input('super-code-tool-ask_user_question').props.disabled, true)
  assert.equal(button('tools.active').props.disabled, true)
  picker().props.onChange('custom:one'); nodes = f.render()
  assert.equal(f.writes(), 0)
  assert.equal(input('super-code-tools-name').props.value, '我的工具')
  assert.equal(input('super-code-tool-ask_user_question').props.disabled, false)
  assert.equal(input('super-code-tool-third_party').props.disabled, false)
  assert.equal(input('super-code-tool-third_party').props.checked, true)
  await button('tools.use').props.onClick(); await f.editor.flush(); nodes = f.render()
  assert.equal(f.stored().configuration.activeId, 'custom:one')
  assert.equal(f.writes(), 1)
  f.writable(false); nodes = f.render()
  assert.equal(button('tools.active').props.disabled, true)
  assert.equal(button('tools.delete').props.disabled, true)
  assert.equal(input('super-code-tools-name').props.disabled, true)
})
test('tool rows show a summary before availability and summarize unknown host tools without inventing a purpose', () => {
  const f = viewFixture()
  const catalog = [
    { name: 'ask_user_question', group: 'questions', available: true },
    { name: 'read', group: 'files', available: false, reason: 'not-loaded' },
    { name: 'third_party', group: 'external', available: true, description: 'Search project notes. More instructions follow.' },
    { name: 'missing', group: 'external', available: true },
    { name: 'blank', group: 'external', available: true, description: '  \n ' },
    { name: 'long', group: 'external', available: true, description: '用'.repeat(150) },
    { name: 'chinese', group: 'external', available: true, description: '读取网页内容。后续使用说明。' },
    { name: 'markup', group: 'external', available: true, description: '<script>alert(1)</script>' },
  ]
  f.editor.receive({ ...f.stored(), catalog })
  const nodes = f.render()
  const hint = (name: string) => nodes.find(node => node.props.id === `super-code-tool-${name}` && node.props.hint).props.hint.children
  assert.equal(hint('ask_user_question')[0].children[0], 'tools.summary.ask_user_question')
  assert.equal(hint('read')[0].children[0], 'tools.summary.read')
  assert.equal(hint('read')[1].children[0], 'tools.notLoaded')
  assert.equal(hint('third_party')[0].children[0], 'Search project notes.')
  assert.equal(hint('third_party')[1], false)
  for (const name of ['missing', 'blank']) assert.equal(hint(name)[0].children[0], 'tools.summary.unknown')
  assert.equal(hint('long')[0].children[0], '用'.repeat(119) + '…')
  assert.equal(hint('chinese')[0].children[0], '读取网页内容。')
  assert.equal(hint('markup')[0].children[0], '<script>alert(1)</script>')
  assert.equal(f.writes(), 0)
})
test('actual Tools component confirms deleting an active custom profile and enforces the 30-profile button limit', async () => {
  const f = viewFixture()
  const config = f.stored().configuration
  f.editor.receive({ ...f.stored(), configuration: { ...config, activeId: 'custom:one' } })
  let nodes = f.render()
  nodes.find(node => node.children.includes('tools.delete') && node.props.onClick).props.onClick()
  nodes = f.render()
  const confirmation = nodes.find(node => node.props.role === 'alertdialog')
  assert(confirmation)
  assert.equal(f.writes(), 0)
  confirmation.children.find((node: any) => node.props?.onClick && node.children.includes('tools.delete')).props.onClick()
  await f.editor.flush()
  assert.equal(f.stored().configuration.activeId, 'builtin:super-code')
  assert.equal(f.stored().configuration.custom.length, 0)
  const custom = Array.from({ length: 25 }, (_, index) => ({ ...configuration().custom[0], id: 'custom:' + index }))
  f.editor.receive({ ...f.stored(), configuration: { ...config, custom } })
  nodes = f.render()
  for (const label of ['tools.copy', 'tools.new']) assert.equal(nodes.find(node => node.children.includes(label)).props.disabled, true)
})
test('custom external switches save exclusions, retain unavailable names and re-enable without activating a preview', async () => {
  const f = viewFixture()
  let nodes = f.render()
  nodes.find(node => node.props.id === 'super-code-tool-profile' && node.props.onChange).props.onChange('custom:one')
  nodes = f.render()
  const switchOf = () => nodes.find(node => node.props.id === 'super-code-tool-third_party' && node.props.onChange)
  assert.equal(switchOf().props.disabled, false)
  switchOf().props.onChange(false); await f.editor.flush(); nodes = f.render()
  assert.deepEqual(f.stored().configuration.custom[0].disabledExternalTools, ['third_party'])
  assert.equal(f.stored().configuration.activeId, 'builtin:ptc')
  assert.equal(switchOf().props.checked, false)
  f.editor.receive({ ...f.stored(), configuration: { ...f.stored().configuration,
    custom: [{ ...f.stored().configuration.custom[0], disabledExternalTools: ['third_party', 'missing_plugin'] }] } })
  nodes = f.render(); switchOf().props.onChange(true); await f.editor.flush(); nodes = f.render()
  assert.deepEqual(f.stored().configuration.custom[0].disabledExternalTools, ['missing_plugin'])
  assert.equal(switchOf().props.checked, true)
})
test('hidden Tools component performs no configuration reads or status polling', () => {
  const f = viewFixture(); f.render(false)
  for (const effect of f.effects) assert.equal(effect(), undefined)
  assert.equal(f.reads(), 0)
})
test('actual Tools component reports a failed status response without replaying a write', async () => {
  const f = viewFixture(false)
  f.render()
  const cleanups = f.effects.map(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  await f.scheduled.at(-1)!()
  assert(f.render().some(node => node.children.includes('tools.error.connection')))
  assert.equal(f.writes(), 0)
  assert.deepEqual(f.editor.getSnapshot().draft, configuration())
  for (const cleanup of cleanups) cleanup?.()
})
