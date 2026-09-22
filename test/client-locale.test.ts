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
    slots: { inject: (_: string, callback: Function) => callback(), register: (config: any, component: any) => { slots.push({ config, component }); return () => {} } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  })
  return { plugin, dictionaries, slots }
}

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
