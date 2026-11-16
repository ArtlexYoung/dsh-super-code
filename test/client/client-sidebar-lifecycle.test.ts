import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'

function fixture(missing?: string, failAt?: string) {
  const ctx = new Context(), slots = new Map<string, any>(), tabs = new Map<string, object>()
  let styles = 0, plugin: any
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, setTimeout, clearTimeout, console,
    document: { createElement: () => ({ dataset: {}, remove: () => { styles-- } }), head: { appendChild: () => { styles++ } } },
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((name: string) => {
      if (name === 'react') return { forwardRef: () => 'button' }
      throw new Error('Unexpected eager import: ' + name)
    }) } },
  })
  class Slots extends Service {
    constructor(owner: Context) { super(owner, 'slots') }
    inject(_name: string, register: () => any) { this.ctx.effect(register) }
    register(config: any, component: unknown) {
      const key = config.name + ':' + (config.key || config.id), entry = { config, component }
      slots.set(key, entry)
      return () => { if (slots.get(key) === entry) slots.delete(key) }
    }
  }
  class Tabs extends Service {
    constructor(owner: Context) { super(owner, 'sidebarRightTabs') }
    register(config: { id: string }) {
      if (config.id === failAt) throw new Error('Unsupported sidebar registration')
      tabs.set(config.id, config)
      return () => { tabs.delete(config.id) }
    }
  }
  new Slots(ctx)
  const provide = (name: string, value: object) => ctx.provide(name as never, value as never)
  provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  provide('remote', { $mount: async () => {} })
  for (const name of ['remote.session', 'sessions', 'sidebarRight']) if (name !== missing) provide(name, {})
  const mountSidebar = () => ctx.plugin({ apply(owner: Context) { new Tabs(owner) } })
  const sidebar = missing === 'sidebarRightTabs' ? undefined : mountSidebar()
  return { ctx, slots, tabs, plugin, sidebar, mountSidebar, styles: () => styles }
}

for (const dependency of ['remote.session', 'sessions', 'sidebarRightTabs', 'sidebarRight']) {
  test(`settings stay mounted without optional ${dependency}`, async t => {
    const f = fixture(dependency)
    t.after(() => f.ctx.fiber.dispose())
    await f.ctx.plugin(f.plugin)
    assert.ok(f.slots.has('settings.section:super-code'))
    assert.equal(f.styles(), 1)
    assert.equal(f.tabs.size, 0)
  })
}

for (const tab of ['dsh-super-code', 'dsh-super-code-memory', 'dsh-super-code-detail']) {
  test(`failed ${tab} registration releases earlier tabs without removing settings`, async t => {
    const f = fixture(undefined, tab)
    t.after(() => f.ctx.fiber.dispose())
    await f.ctx.plugin(f.plugin)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(f.slots.has('settings.section:super-code'))
    assert.equal(f.styles(), 1)
    assert.equal(f.tabs.size, 0)
    assert.equal([...f.slots.keys()].some(key => key.startsWith('sidebar.')), false)
  })
}

test('sidebar dependency recovery retains all view state and the failed settings draft', async t => {
  const f = fixture()
  t.after(() => f.ctx.fiber.dispose())
  const client = f.ctx.plugin(f.plugin)
  await client
  const body = () => f.slots.get('sidebar.right.pane.tab:dsh-super-code').config.inject()
  const before = body()
  const detail = f.slots.get('sidebar.right.pane.tab:dsh-super-code-detail').config.inject().detailStates
  const settings = f.slots.get('settings.section:super-code').config.inject()
  const editor = settings.budgetApi.editors.shell, tab = {}
  editor.receive({ revision: 1, writable: true, configuration: {} })
  editor.change({ windowsBash: false })
  await editor.flush()
  assert.equal(editor.getSnapshot().error, 'save-failed')
  before.memoryStates.set(tab, { draft: 'unsaved' })
  await f.sidebar!.dispose()
  assert.equal(f.tabs.size, 0)
  assert.equal(f.slots.has('sidebar.right.pane.tab:dsh-super-code'), false)
  assert.equal(f.slots.get('settings.section:super-code').config.inject().budgetApi.editors.shell, editor)
  await f.mountSidebar()
  await new Promise(resolve => setImmediate(resolve))
  const after = body()
  for (const key of ['memoryStates', 'workspaceStates', 'treeStates']) assert.equal(after[key], before[key])
  assert.equal(f.slots.get('sidebar.right.pane.tab:dsh-super-code-detail').config.inject().detailStates, detail)
  assert.deepEqual(after.memoryStates.get(tab), { draft: 'unsaved' })
  assert.equal(editor.getSnapshot().draft.windowsBash, false)
  assert.equal(editor.getSnapshot().error, 'save-failed')
  await client.dispose()
  assert.equal(f.styles(), 0)
  assert.equal(f.tabs.size, 0)
  assert.equal(f.slots.size, 0)
})
