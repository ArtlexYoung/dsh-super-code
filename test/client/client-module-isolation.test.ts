import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function fixture() {
  let plugin: any, settings: any
  const slots: any[] = []
  const callbacks: { names: string[]; run: Function }[] = [], warnings: unknown[] = [], requests: string[] = []
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, setTimeout, clearTimeout,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((name: string) => {
      requests.push(name)
      if (name === 'react') return { forwardRef: () => 'button' }
      throw new Error('Optional host package unavailable: ' + name)
    }) } },
  })
  const ctx = {
    effect() {}, locale: { bind: () => (key: string) => key }, remote: { $mount: async () => {} },
    inject: (names: string[], run: Function) => {
      callbacks.push({ names, run })
      if (names.join(',') !== 'sessions,sidebarRightTabs' && names.every(name => ['slots', 'remote', 'remote.session', 'sessions', 'locale', 'sidebarRightTabs', 'sidebarRight'].includes(name))) run(ctx)
    },
    slots: { inject: (_: string, run: Function) => {
      const result = run()
      if (result?.[Symbol.iterator]) for (const _ of result) { /* Register keyed sidebar views. */ }
    }, register: (config: any) => {
      slots.push(config)
      if (config.name === 'settings.section') settings = config.inject()
      return () => {}
    } }, sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  }
  plugin.apply(ctx)
  const connect = (name: string, api: object) => {
    const cleanup: Function[] = []
    const callback = callbacks.filter(row => row.names.length === 1 && row.names[0] === 'remote.' + name).at(-1)!
    callback.run({ remote: { [name]: api }, effect: (run: Function) => { cleanup.push(run()) } })
    return () => cleanup.forEach(run => run())
  }
  return { settings, connect, requests, warnings, slots }
}

test('optional host packages can fail while settings register without any feature Remote', async () => {
  const f = fixture()
  assert.ok(f.settings.budgetApi.editors.context)
  const sidebar = f.slots.find(row => row.name === 'sidebar.right.pane.tab' && row.key === 'dsh-super-code')
  assert.ok(sidebar, 'task and Agent views register without the memory Remote')
  await assert.rejects(sidebar.inject().api.list('root', 'project'), /unavailable/)
  assert.ok(f.warnings.length)
  assert.equal(f.requests.includes('@deepseek-ai/dsh-api-session-controller'), false)
  assert.equal(f.requests.includes('@deepseek-ai/dsh-client-ui-skill'), false)
  await assert.rejects(f.settings.api.status(), /unavailable/)
  await assert.rejects(f.settings.connectionApi.overview(), /unavailable/)
  const stop = f.connect('superCodeBudgets', { readConfig: async () => ({ ok: true, value: { configuration: {}, revision: 1 } }) })
  assert.equal((await f.settings.budgetApi.readConfig()).ok, true)
  await assert.rejects(f.settings.connectionApi.overview(), /unavailable/)
  stop()
})

test('Remote removal retains a failed draft and reconnect does not replay an unconfirmed save', async () => {
  const f = fixture(), editor = f.settings.budgetApi.editors.shell
  const original = { revision: 1, generation: 'first', writable: true, configuration: {} }
  editor.receive(original)
  editor.change({ windowsBash: false })
  await editor.flush()
  assert.equal(editor.getSnapshot().draft.windowsBash, false)
  assert.equal(editor.getSnapshot().error, 'save-failed')
  let writes = 0
  const detach = f.connect('superCodeBudgets', { readConfig: async () => ({ ok: true, value: original }),
    saveConfig: async () => { writes++; return { ok: true, value: { ok: false, error: 'conflict' } } } })
  await f.settings.budgetApi.readConfig()
  assert.equal(writes, 0)
  assert.equal(f.settings.budgetApi.editors.shell, editor)
  assert.equal(editor.getSnapshot().draft.windowsBash, false)
  await editor.retry()
  assert.equal(writes, 1)
  assert.equal(editor.getSnapshot().error, 'conflict')
  detach()
  await assert.rejects(f.settings.budgetApi.readConfig(), /unavailable/)
  assert.equal(editor.getSnapshot().draft.windowsBash, false)
})

test('stable Remote adapters preserve the stream iterator and reject unavailable streams synchronously', () => {
  const f = fixture(), stream = { async *[Symbol.asyncIterator]() { yield [] } }
  const detach = f.connect('superCodeConnection', { watchDirectories: () => stream })
  assert.equal(f.settings.connectionApi.watchDirectories(), stream)
  detach()
  assert.throws(() => f.settings.connectionApi.watchDirectories(), /unavailable/)
})
