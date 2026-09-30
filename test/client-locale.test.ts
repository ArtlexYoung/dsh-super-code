import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function fixture() {
  let plugin: any
  const dictionaries: Record<string, Record<string, string>> = {}
  const slots: any[] = []
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory(() => ({})) } },
  })
  plugin.apply({
    effect: (callback: Function, label: string) => { if (label === 'dsh-super-code: dictionaries') callback() },
    locale: { register: (_ns: string, values: any) => Object.assign(dictionaries, values), bind: () => (key: string) => key },
    remote: { $mount: async () => () => {} },
    inject: () => {},
    slots: { inject: (_: string, callback: Function) => callback(), register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  })
  return { plugin, dictionaries, slots }
}

test('preset settings registration does not wait on the Remote mount lifecycle', () => {
  let plugin: any
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory(() => ({})) } },
  })
  let injected = false
  const mounts: any[] = []
  plugin.apply({
    effect: () => {},
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $mount: (contribution: any) => { mounts.push(contribution); return new Promise(() => {}) } },
    inject: (dependencies: string[]) => {
      assert.ok(['remote.superCodePresets', 'remote.superCodeMemory'].includes(dependencies[0]!))
      if (dependencies[0] === 'remote.superCodePresets') injected = true
    },
    slots: { inject: () => {} }, sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  })
  assert.equal(injected, true)
  assert.equal(mounts.length, 1, 'The registry accepts one contribution per package')
  assert.deepEqual([...new Set(mounts[0].descriptors.map((row: any) => row.namespace))].sort(), ['superCodeMemory', 'superCodePresets'])
  for (const descriptor of mounts[0].descriptors) for (const parameter of descriptor.parameters) {
    assert.equal(parameter.codec.create().parse('valid'), 'valid')
    assert.equal(parameter.codec.schema.parse('legacy'), 'legacy')
    assert.throws(() => parameter.codec.create().parse(42))
  }
})

test('all plugin labels have both languages and sidebar slots subscribe to locale changes', () => {
  const { dictionaries, slots } = fixture()
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
  for (const slot of slots) {
    assert.equal(slot.config.locale, 'dshSuperCode')
    assert.equal('t' in slot.config.inject(), false)
  }
  assert.equal(dictionaries.zh['preset.title'], 'Super Code 模式')
  assert.equal(dictionaries.en['preset.title'], 'Super Code')
  assert.equal(dictionaries.zh['preset.description'], '更快、更省、更聪明的编码模式。')
  assert.equal(dictionaries.en['preset.description'], 'A faster, more efficient, smarter coding mode.')
  assert.equal(dictionaries.zh['preset.confirmHint'], '以下是通过本插件安装的预设，将会被移除并按照新名称重新安装，旧内容会保留恢复备份。对于需要保留的预设可以手动在列表中移除。')
  assert.match(dictionaries.en['preset.confirmHint'], /Remove any preset you want to keep/)
})

test('memory library virtualizes large indexes and keeps the target scope explicit', () => {
  const { plugin } = fixture()
  const items = Array.from({ length: 4000 }, (_, id) => ({ topic: 'topic', id: `entry-${id}`, summary: `Memory ${id}` }))
  const page = plugin.memoryLibraryWindow(items, '', 152000, 600)
  assert.equal(page.count, 4000)
  assert.ok(page.rows.length <= 15)
  assert.equal(page.before + page.rows.length * 76 + page.after, 4000 * 76)
  assert.equal(plugin.memoryLibraryWindow(items, 'Memory 3999', 0, 600).rows[0].id, 'entry-3999')
  const address = plugin.memoryLibraryAddress('child/a', { scope: 'global', topic: 'preferences', id: 'keep-edits' })
  const target = plugin.memoryLibraryTarget(address, 'root')
  assert.equal(target.sessionId, 'child/a'); assert.equal(target.scope, 'global')
  assert.equal(plugin.memoryLibraryTarget('invalid', 'root').sessionId, 'root')
})

test('published projection catalogs preserve scoped identity, child usage and missing state', () => {
  const { plugin } = fixture()
  const usage = { totals: { uncachedInputTokens: 10, cacheReadTokens: 90, outputTokens: 20 } }
  const raw = { byId: { root: { id: 'root', title: 'Root' }, unrelated: { id: 'unrelated' } }, projectionsBySession: {
    root: { state: 'ready', values: { subagentCatalog: [{ id: 'child', mode: 'one-shot', label: 'Reader', createdAt: 1 }], superAgentUsage: usage } },
    child: { state: 'ready', values: { subagentCatalog: [], superAgentUsage: usage } },
  } }
  const state = plugin.agentSessionState(raw, 'root', new Map([['root', { running: true }], ['child', { running: false }]]))
  const view = plugin.buildAgentView(state)
  assert.equal(view.root, 'root'); assert.equal(view.nodes.size, 2)
  assert.equal(view.nodes.get('child').parentId, 'root')
  assert.equal(view.nodes.get('child').running, false)
  assert.equal(view.nodes.get('child').hasChildren, false)
  assert.equal(plugin.agentTreeTotals(view, state.subagentsByParent).get('root').tokens, 240)
  const unknown = plugin.buildAgentView(plugin.agentSessionState(raw, 'root'))
  assert.equal(unknown.nodes.get('child').running, undefined)
  const legacy = plugin.agentSessionState({ current: 'unrelated', byId: raw.byId, subagentsByParent: {} }, 'root')
  assert.equal(legacy.current, 'root')
  assert.equal('current' in raw, false)
})

test('existing and appended detail events retranslate labels and image placeholders without changing user content', () => {
  const { plugin, dictionaries } = fixture()
  let language = 'en', callbacks: any
  const t = (key: string) => dictionaries[language][key]
  const inspector = plugin.createAgentInspector((_target: object, next: any) => {
    callbacks = next
    return { open: async () => {}, dispose: async () => {} }
  }, 'dsh-resource://super-agent/root', async () => ({}), undefined, t)
  const entry = { event: { seq: 1, time: 1, type: 'user/message', data: {
    source: { kind: 'user' }, content: [{ type: 'text', text: '保留原文' }, { type: 'image' }],
  } } }
  callbacks.publish({ type: 'append', entry })
  const stored = inspector.getSnapshot().items[0]
  assert.equal(stored.label, 'Task')
  assert.equal(stored.text, '保留原文\n\n[Image]')
  for (language of ['zh', 'en', 'zh']) {
    const rendered = plugin.detailRecord(stored.entry, t)
    assert.equal(rendered.label, dictionaries[language]['detail.task'])
    assert.equal(rendered.text, `保留原文\n\n${dictionaries[language].image}`)
    callbacks.failed()
    assert.equal(t(inspector.getSnapshot().error), dictionaries[language]['detail.loadError'])
  }
  inspector.dispose()
})

test('standalone display synchronization reloads only after a change and detaches on unload', async () => {
  const { plugin } = fixture()
  let active = 'zh', listener = () => {}, reloads = 0, stopped = false
  const calls: string[] = []
  const locale = { getSnapshot: () => ({ active }), subscribe: (callback: () => void) => {
    listener = callback; return () => { stopped = true }
  } }
  const api = { synchronize: async (language: string) => {
    calls.push(language); return { ok: true, value: { changed: language === 'en' } }
  } }
  const stop = plugin.synchronizePresetDisplay(api, locale, () => { reloads++ }, (error: unknown) => { throw error })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 0)
  listener()
  assert.deepEqual(calls, ['zh'])
  active = 'en'; listener()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 1)
  stop()
  assert.equal(stopped, true)
})

test('failed display synchronization can retry and late completion never reloads an unloaded plugin', async () => {
  const { plugin } = fixture()
  let listener = () => {}, attempts = 0, errors = 0, reloads = 0
  let finish: (value: object) => void = () => {}
  const stop = plugin.synchronizePresetDisplay({ synchronize: async () => {
    if (++attempts === 1) return { ok: false }
    return await new Promise(resolve => { finish = resolve })
  } }, { getSnapshot: () => ({ active: 'zh' }), subscribe: (callback: () => void) => { listener = callback; return () => {} } },
  () => { reloads++ }, () => { errors++ })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors, 1)
  listener(); stop(); finish({ ok: true, value: { changed: true } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reloads, 0)
})
