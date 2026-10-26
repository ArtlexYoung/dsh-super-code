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
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
  })
  plugin.apply({
    effect: (callback: Function, label: string) => { if (label === 'dsh-super-code: dictionaries') callback() },
    locale: { register: (_ns: string, values: any) => Object.assign(dictionaries, values), bind: () => (key: string) => key },
    remote: { $mount: async () => () => {} },
    inject: () => {},
    slots: { inject: (_: string, callback: Function) => {
      const result = callback()
      if (result?.[Symbol.iterator]) for (const _dispose of result) { /* Consume slot registration effects. */ }
    }, register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  })
  return { plugin, dictionaries, slots }
}

test('preset settings registration does not wait on the Remote mount lifecycle', () => {
  let plugin: any
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL,
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {}) } },
  })
  let injected = false
  const mounts: any[] = []
  plugin.apply({
    effect: () => {},
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $mount: (contribution: any) => { mounts.push(contribution); return new Promise(() => {}) } },
    inject: (dependencies: string[]) => {
      assert.ok(['remote.superCodePresets', 'remote.superCodeMemory', 'remote.superCodeConnection', 'uiWorkspace'].includes(dependencies[0]!))
      if (dependencies[0] === 'remote.superCodePresets') injected = true
    },
    slots: { inject: () => {} }, sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  })
  assert.equal(injected, true)
  assert.equal(mounts.length, 1, 'The registry accepts one contribution per package')
  assert.deepEqual([...new Set(mounts[0].descriptors.map((row: any) => row.namespace))].sort(), ['superCodeBudgets', 'superCodeConnection', 'superCodeMemory', 'superCodePresets'])
  for (const descriptor of mounts[0].descriptors) for (const parameter of descriptor.parameters) {
    assert.equal(parameter.codec.create().parse('valid'), 'valid')
    assert.equal(parameter.codec.schema.parse('legacy'), 'legacy')
    assert.throws(() => parameter.codec.create().parse(42))
  }
})

test('budget fields round-trip units, retain blank defaults and reject contradictory limits', () => {
  const { plugin } = fixture()
  const config = { deletionProtection: 'strict', deletionProtectionForOfficialPresets: false, applyToOfficialPresets: true, maxTasks: 48, maxContextBytes: 65536, budgets: { pressureBasis: 'window',
    thresholdRatio: 0.8, retainRatio: 0.16, summaryMaxTokens: 8192, compactionRetries: 0,
    ptcTimeoutMs: 123, ptcMaxTimeoutMs: 600000 } }
  const draft = plugin.budgetDraft(config)
  assert.equal(draft.thresholdRatio, '80')
  assert.equal(draft.ptcTimeoutMs, '0.123')
  assert.equal(draft.ptcMaxTimeoutMs, '600')
  assert.equal(draft.compactionRetries, '0')
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.budgetConfiguration(draft))), { ok: true, configuration: config })
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.budgetConfiguration(plugin.budgetDraft({})))), { ok: true, configuration: { deletionProtection: 'relaxed', deletionProtectionForOfficialPresets: false, applyToOfficialPresets: false } })
  for (const [key, value, error] of [['retainRatio', '90', 'retain'], ['ptcTimeoutMs', '601', 'ptc-order'],
    ['summaryMaxTokens', '-1', 'invalid'], ['maxTasks', '1.5', 'invalid'], ['thresholdRatio', 'NaN', 'invalid'], ['applyToOfficialPresets', 'true', 'invalid']]) {
    assert.equal(plugin.budgetConfiguration({ ...draft, [key!]: value }).error, error)
  }
})

test('deletion modes default to relaxed and preserve legacy choices and independent opt-ins', () => {
  const { plugin, dictionaries } = fixture()
  const draft = plugin.budgetDraft({ applyToOfficialPresets: true })
  assert.equal(draft.deletionProtection, 'relaxed')
  assert.equal(draft.deletionProtectionForOfficialPresets, false)
  assert.equal(plugin.budgetDraft({ deletionProtection: true }).deletionProtection, 'strict')
  assert.equal(plugin.budgetDraft({ deletionProtection: false }).deletionProtection, 'off')
  for (const mode of ['off', 'relaxed', 'strict']) {
    const parsed = JSON.parse(JSON.stringify(plugin.budgetConfiguration({ ...draft, deletionProtection: mode, deletionProtectionForOfficialPresets: true })))
    assert.deepEqual(parsed, { ok: true, configuration: { deletionProtection: mode, deletionProtectionForOfficialPresets: true, applyToOfficialPresets: true } })
  }
  for (const value of ['true', '', 'invalid', 1, true, false]) {
    assert.equal(plugin.budgetConfiguration({ ...draft, deletionProtection: value }).error, 'invalid')
  }
  assert.equal(plugin.budgetConfiguration({ ...draft, deletionProtectionForOfficialPresets: 'true' }).error, 'invalid')
  assert.match(dictionaries.zh['delete.hint.relaxed'], /脚本.*建议.*明确要求.*rm/)
  assert.match(dictionaries.en['delete.hint.relaxed'], /scripts.*Explicit user requests.*rm/)
  assert.match(dictionaries.zh['delete.hint.strict'], /脚本.*禁止.*rm/)
  assert.match(dictionaries.en['delete.hint.strict'], /scripts.*must not.*rm/)
})

test('all plugin labels have both languages and sidebar slots subscribe to locale changes', () => {
  const { dictionaries, slots } = fixture()
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
  for (const slot of slots) {
    assert.equal(slot.config.locale, 'dshSuperCode')
    assert.equal('t' in (slot.config.inject?.() ?? {}), false)
  }
  assert.equal(dictionaries.zh['preset.title'], 'Super Code 模式')
  assert.equal(dictionaries.en['preset.title'], 'Super Code')
  assert.equal(dictionaries.zh['preset.description'], '更快、更省、更聪明的编码模式。')
  assert.equal(dictionaries.en['preset.description'], 'A faster, more efficient, smarter coding mode.')
  assert.equal(dictionaries.zh['preset.confirmHint'], '以下是通过本插件安装的预设，将会被移除并按照新名称重新安装，旧内容会保留恢复备份。对于需要保留的预设可以手动在列表中移除。')
  assert.match(dictionaries.en['preset.confirmHint'], /Remove any preset you want to keep/)
})

test('open tab titles switch languages without changing user titles or tab identity', () => {
  const { dictionaries, slots } = fixture()
  const titles = slots.filter(slot => slot.config.name === 'sidebar.right.pane.tab.title')
  assert.equal(titles.length, 3)
  const labels: Record<string, string> = { 'dsh-super-code': 'workspace.title', 'dsh-super-code-memory': 'workspace.title' }
  const tab = { contentId: 'dsh-resource://super-agent/root' }
  let catalog = { byId: { root: { id: 'root', title: '保留用户任务 / User task' } } }
  for (const language of ['zh', 'en', 'zh']) {
    const t = (key: string) => dictionaries[language][key]
    for (const slot of titles) {
      assert.equal(slot.config.locale, 'dshSuperCode')
      const props = { ...slot.config.inject?.(), t, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select(catalog) }
      assert.equal(slot.component(props), slot.config.key === 'dsh-super-code-detail'
        ? catalog.byId.root.title || t('detail.title') : t(labels[slot.config.key]!))
    }
  }
  catalog = { byId: { root: { id: 'root', title: '' } } }
  const detail = titles.find(slot => slot.config.key === 'dsh-super-code-detail')!
  for (const language of ['zh', 'en']) {
    const t = (key: string) => dictionaries[language][key]
    assert.equal(detail.component({ t, useTabInfo: () => ({ tab }), useSessions: (select: Function) => select(catalog) }), t('detail.title'))
  }
  assert.equal(tab.contentId, 'dsh-resource://super-agent/root')
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

test('live execution switches from idle to running and back in both host catalog shapes', () => {
  const { plugin } = fixture()
  const root = { id: 'root' }, child = { id: 'child' }
  const projection = { byId: { root, child }, projectionsBySession: {
    root: { state: 'ready', values: { subagentCatalog: [{ id: 'child', mode: 'one-shot' }] } },
    child: { state: 'ready', values: { subagentCatalog: [] } },
  } }
  for (const running of [false, true, false]) {
    const statuses = new Map([['root', { running }], ['child', { running }]])
    const projected = plugin.buildAgentView(plugin.agentSessionState(projection, 'root', statuses))
    const navigation = plugin.buildAgentView(plugin.agentSessionState({
      byId: { root: { ...root, running } },
      subagentsByParent: { root: { state: 'ready', entries: [{ id: 'child', kind: 'child', mode: 'one-shot', activity: running ? 'running' : 'inactive' }] } },
    }, 'root'))
    for (const view of [projected, navigation]) {
      assert.equal(plugin.agentExecutionStatus(view.nodes.get('root'), true).tone, running ? 'active' : 'idle')
      assert.equal(plugin.agentExecutionStatus(view.nodes.get('child'), false).tone, running ? 'active' : 'stopped')
    }
  }
  assert.equal('running' in root, false)
  assert.equal('running' in child, false)
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

test('tool calls and old/new results retranslate while preserving arguments and public output', () => {
  const { plugin, dictionaries } = fixture()
  const records = [
    { type: 'tool/call', data: { callId: 'read-1', name: 'read_file', arguments: '{"path":"中文文件.txt"}' } },
    { type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'read-1', content: [{ type: 'text', text: '文件内容' }] } } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'read-1', isError: true,
      content: [{ type: 'text', text: '读取失败' }, { type: 'reasoning', text: 'Private' }, { type: 'image' }] }] } } },
  ]
  for (const language of ['zh', 'en']) {
    const t = (key: string) => dictionaries[language][key]
    const items = records.map(event => plugin.detailRecord({ event: { seq: 1, time: 1, ...event } }, t))
    assert.equal(items[0].label, `${t('detail.toolCall')} · read_file`)
    assert.equal(items[0].text, '{\n  "path": "中文文件.txt"\n}')
    assert.equal(items[1].label, t('detail.toolResult'))
    assert.equal(items[1].text, '文件内容')
    assert.equal(items[2].kind, 'error')
    assert.equal(items[2].label, t('detail.toolError'))
    assert.equal(items[2].text, `读取失败\n\n${t('image')}`)
    assert.ok(items.every(item => item.callId === 'read-1'))
  }
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

test('preset display waits for the host preference instead of rewriting a provisional browser locale', async () => {
  const { plugin } = fixture()
  let active = 'en', preference: object | undefined
  let localeChanged = () => {}, preferenceChanged = () => {}, detached = 0
  const calls: string[] = []
  const stop = plugin.synchronizePresetDisplay({ synchronize: async (language: string) => {
    calls.push(language)
    return { ok: true, value: { changed: false } }
  } }, { getSnapshot: () => ({ active }), subscribe: (callback: () => void) => {
    localeChanged = callback; return () => { detached++ }
  } }, () => assert.fail('unchanged display must not reload'), (error: unknown) => { throw error }, {
    getSnapshot: () => ({ status: preference ? 'ready' : 'loading', value: preference }), subscribe: (callback: () => void) => {
      preferenceChanged = callback; return () => { detached++ }
    },
  })
  localeChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [])
  preference = { preference: 'zh' }; active = 'zh'
  localeChanged(); preferenceChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['zh'])
  active = 'en'; localeChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['zh'], 'optimistic locale changes wait for the host preference write')
  preference = { preference: 'en' }; preferenceChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['zh', 'en'])
  stop()
  assert.equal(detached, 2)
})

test('display synchronization waits for the first language preference write before reloading', async () => {
  const { plugin } = fixture()
  let active = 'zh', accepted: string | undefined, localeChanged = () => {}, preferenceChanged = () => {}, reloads = 0
  const calls: string[] = []
  const stop = plugin.synchronizePresetDisplay({ synchronize: async (language: string) => {
    calls.push(language); return { ok: true, value: { changed: language === 'en' } }
  } }, { getSnapshot: () => ({ active }), subscribe: (listener: () => void) => { localeChanged = listener; return () => {} } },
  () => { reloads++ }, (error: unknown) => { throw error }, {
    getSnapshot: () => ({ status: 'ready', mode: 'host', value: { preference: accepted } }),
    subscribe: (listener: () => void) => { preferenceChanged = listener; return () => {} },
  })
  await new Promise(resolve => setImmediate(resolve))
  active = 'en'; localeChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['zh']); assert.equal(reloads, 0)
  accepted = 'en'; preferenceChanged()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['zh', 'en']); assert.equal(reloads, 1)
  stop()
})

test('preset settings declare the available host preference service before reading it', () => {
  for (const service of ['configForms', 'settingsScope']) {
    const { plugin } = fixture()
    const registered: string[] = [], dependencies: string[][] = []
    const preferenceScope = { getSnapshot: () => ({ status: 'unavailable' }), subscribe: () => () => {} }
    const preference = service === 'configForms'
      ? { get: (namespace: string) => { assert.equal(namespace, 'locale'); return preferenceScope } }
      : { bind: (spec: any) => { assert.equal(spec.namespace, 'locale'); return preferenceScope } }
    const ready = new Proxy({
      [service]: preference,
      remote: { superCodePresets: {} }, effect: () => {},
      slots: { inject: (_: string, callback: Function) => callback(), register: (config: any) => { registered.push(config.id); return () => {} } },
    }, { get: (target, key) => {
      if (key === 'configForms' || key === 'settingsScope') assert.ok(dependencies.at(-1)?.includes(String(key)), 'Cordis services require injection')
      return Reflect.get(target, key)
    } })
    plugin.apply({
      [service]: preference, effect: () => {},
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      remote: { $mount: async () => () => {} },
      inject: (names: string[], callback: Function) => {
        if (names[0] !== 'remote.superCodePresets') return
        dependencies.push(names); callback(ready)
      },
      slots: { inject: () => {} }, sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
    })
    assert.deepEqual([...dependencies[0]!], ['remote.superCodePresets', 'remote.superCodeBudgets', 'remote.superCodeConnection', service])
    assert.deepEqual(registered, ['super-code'])
  }
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


test('unified memory navigation retains list state and acts on repeated explicit opens', () => {
  const { plugin } = fixture()
  const tab = { contentId: 'sidebar://super-agent-agents', navigation: { revision: 1, params: {} as any } }
  const saved = { scope: 'project', query: 'shell', topicFilter: 'compat-memory', selected: null, top: 152, detailTop: 90 }
  const initial = plugin.memoryLibraryNavigation(saved, tab, 'root')
  assert.equal(initial.query, 'shell'); assert.equal(initial.top, 152)
  assert.equal(initial.selected, null)
  assert.equal(plugin.memoryLibraryNavigation(initial, tab, 'root'), initial)
  tab.navigation = { revision: 2, params: { memory: plugin.memoryLibraryAddress('child', { scope: 'global', topic: 'preferences', id: 'rule' }) } }
  const opened = plugin.memoryLibraryNavigation(initial, tab, 'root')
  assert.equal(opened.scope, 'global'); assert.equal(opened.topicFilter, ''); assert.equal(opened.top, 0)
  assert.equal(opened.query, 'shell'); assert.equal(opened.detailTop, 0)
  assert.equal(JSON.stringify(opened.selected), JSON.stringify({ topic: 'preferences', id: 'rule' }))
  const returned = { ...opened, selected: null, top: 76, detailTop: 45 }
  assert.equal(plugin.memoryLibraryNavigation(returned, tab, 'root'), returned, 'a hidden tab remount does not reopen the entry')
  tab.navigation.revision++
  const reopened = plugin.memoryLibraryNavigation(returned, tab, 'root')
  assert.equal(reopened.selected.id, 'rule'); assert.equal(reopened.top, 76); assert.equal(reopened.detailTop, 0)
  tab.navigation = { revision: 4, params: {} }
  const revealed = plugin.memoryLibraryNavigation(reopened, tab, 'root')
  assert.equal(revealed.selected, reopened.selected, 'revealing the guide entry retains the reader')
  assert.equal(revealed.query, 'shell')
})

test('restored memory resource addresses still locate their entry in the unified page', () => {
  const { plugin } = fixture()
  const tab = { contentId: plugin.memoryLibraryAddress('历史 / session', { topic: 'code', id: 'fact' }) }
  const opened = plugin.memoryLibraryNavigation({}, tab, 'root')
  assert.equal(opened.scope, 'project'); assert.equal(opened.selected.id, 'fact')
  assert.equal(plugin.memoryLibraryTarget(tab.contentId, 'root').sessionId, '历史 / session')
  assert.equal(plugin.memoryLibraryNavigation(opened, tab, 'root'), opened)
  const invalid = plugin.memoryLibraryNavigation({ query: 'preserve', selected: null }, { contentId: 'sidebar://super-agent-agents', navigation: { params: { memory: 42 } } }, 'root')
  assert.equal(invalid.selected, null); assert.equal(invalid.query, 'preserve')
})

test('memory drafts, failed saves, hidden completion, and delete cancellation have no unintended writes', async () => {
  const { plugin } = fixture()
  let finish: (value: any) => void = () => {}, calls = 0, fail = false
  const api = { saveEntry: async () => { calls++; return await new Promise(resolve => { finish = resolve }) },
    deleteEntry: async () => { calls++; if (fail) throw new Error('offline'); return { ok: true, value: { kind: 'removed' } } } }
  const saved: any = { selected: { topic: 'notes', id: 'existing' }, scope: 'project', query: 'find', top: 152 }
  const store = plugin.createMemoryEditor(saved, api)
  const draft = { sessionId: 'root', scope: 'project', topic: 'notes', id: 'new', expected: '', kind: 'fact', summary: '  Title  ', detail: 'Detail' }
  store.update({ draft })
  assert.equal(calls, 0, 'opening and editing a form does not write')
  assert.equal(plugin.createMemoryEditor(saved, api), store, 'hidden tab remount reuses its draft and pending operation')
  store.update({ draft: null })
  assert.equal(calls, 0, 'cancel does not write')
  assert.equal(saved.selected.id, 'existing')
  store.update({ draft })
  const pending = store.save()
  assert.equal(store.getSnapshot().busy, true)
  assert.equal((await store.save()).kind, 'busy'); assert.equal(calls, 1)
  finish({ ok: true, value: { kind: 'conflict' } }); await pending
  assert.equal(store.getSnapshot().draft.summary, '  Title  ')
  assert.equal(store.getSnapshot().error, 'memory.conflict')
  const retry = store.save()
  finish({ ok: false }); await retry
  assert.equal(store.getSnapshot().error, 'memory.writeError')
  const hidden = store.save()
  finish({ ok: true, value: { kind: 'saved' } }); await hidden
  assert.equal(saved.selected.id, 'new'); assert.equal(store.getSnapshot().draft, null)
  assert.equal(store.getSnapshot().refresh, 1); assert.equal(saved.query, 'find'); assert.equal(saved.top, 152)
  const confirmation = { sessionId: 'root', scope: 'project', topic: 'notes', id: 'new', expected: 'token' }
  store.update({ confirmation }); const beforeCancel = calls
  store.update({ confirmation: null }); assert.equal(calls, beforeCancel)
  store.update({ confirmation }); fail = true
  assert.equal((await store.remove()).kind, 'error')
  assert.equal(store.getSnapshot().confirmation.id, 'new'); assert.equal(saved.selected.id, 'new')
  fail = false; assert.equal((await store.remove()).kind, 'removed')
  assert.equal(saved.selected, null); assert.equal(store.getSnapshot().confirmation, null)
})

 test('connection drafts preserve a disabled default and validate independent settings', () => {
  const { plugin, dictionaries } = fixture()
  const config = { enabled: false, port: 23457, maxConcurrent: 4, maxConnections: 4, directoriesConfigured: true, knownDirectories: [], allowedDirectories: [] }
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.connectionConfiguration(plugin.connectionDraft(config)))), { ok: true, configuration: config })
  const enabled = { ...plugin.connectionDraft(config), enabled: true, allowedDirectories: ['/project', '/project two'] }
  assert.equal(plugin.connectionConfiguration(enabled).ok, true)
  for (const change of [{ port: '0' }, { port: '1.5' }, { maxConnections: '33' }, { allowedDirectories: [] }]) assert.equal(plugin.connectionConfiguration({ ...enabled, ...change }).ok, false)
  assert.equal(dictionaries.zh['settings.connectionTab'], '连接')
  assert.equal(dictionaries.en['settings.connectionTab'], 'Connection')
  assert.equal(dictionaries.zh['connection.client'], '连接 Prompt')
  for (const language of ['zh', 'en']) {
    const prompt = dictionaries[language]!['connection.prompt']!
    assert.ok(prompt.includes('{url}'))
    for (const tool of ['dsh_run', 'dsh_wait', 'dsh_send', 'dsh_cancel']) assert.ok(prompt.includes(tool))
    assert.equal(/codex/i.test(prompt), false)
  }
 })

test('connection conversation counts follow live MCP connections rather than execution status', () => {
  const { plugin, dictionaries } = fixture()
  const sessions = [
    { sessionId: 'finished-online', connectionId: 'online', status: 'finished' },
    { sessionId: 'running-online', connectionId: 'online', status: 'running' },
    { sessionId: 'running-offline', connectionId: 'old', status: 'running' },
    { sessionId: 'old-record', status: 'finished' },
  ]
  const overview = { connections: [{ id: 'online' }], sessions }
  const groups = plugin.connectionSessions(overview)
  assert.equal(groups.connected.map((row: any) => row.sessionId).join(','), 'finished-online,running-online')
  assert.equal(groups.history.map((row: any) => row.sessionId).join(','), 'running-offline,old-record')
  assert.equal(plugin.connectionSessions({ ...overview, connections: [] }).history.length, 4)
  assert.equal(plugin.connectionSessions({ connections: [], sessions: [] }).connected.length, 0)
  assert.equal(overview.sessions.length, 4)
  assert.equal(dictionaries.zh['home.connectedSessions'], '正在连接的对话')
  assert.equal(dictionaries.zh['home.historySessions'], '历史对话')
})
