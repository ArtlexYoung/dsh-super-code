import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)

test('工作台独立初始化、随开关登记，并在卸载时撤销登记', () => {
  let plugin: any
  const storage = new Map<string, string>()
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }
  const entries = new Map<string, any>(), effects: (() => void)[] = []
  let activateWorkbench: (owner: any) => void = () => {}
  const remote = { $mount: async () => {}, superCodeWorkbench: {} }
  const ctx: any = {
    remote,
    locale: { register: () => () => {}, bind: () => (key: string) => key, getLocale: () => ({ active: 'zh', locales: [{ id: 'zh', label: '中文' }] }) },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } }, sidebarRightTabs: { register: () => () => {} },
    slots: {
      entries: () => [],
      inject(name: string, callback: () => unknown) { if (['settings.section', 'conversation.view', 'conversation.session.header.actions', 'sidebar.right.pane.tab'].includes(name)) { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose as () => void) } },
      register(contribution: any, component: unknown) { entries.set(contribution.id, { contribution, component }); return () => entries.delete(contribution.id) },
    },
    effect(callback: () => unknown) { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose as () => void) },
    inject(names: string[], callback: (ctx: any) => void) {
      if (names.join(',') === 'sessions,sidebarRightTabs') activateWorkbench = callback
      else if (names.every(name => ['remote.superCodeWorkbench', 'remote.session', 'remote.skills'].includes(name))) callback(this)
    },
  }
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, AbortController, localStorage, setTimeout, clearTimeout, console,
    document: { documentElement: { style: {} }, createElement: () => ({ dataset: {}, style: {}, remove() {} }), head: { append() {}, appendChild() {} } },
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id.startsWith('@deepseek-ai/') ? {} : require(id)) } } },
  })
  plugin.apply(ctx)
  const start = () => {
    const childEffects: (() => void)[] = []
    const child = Object.create(ctx)
    child.effect = (callback: () => unknown) => { const dispose = callback(); if (typeof dispose === 'function') childEffects.push(dispose as () => void) }
    child.slots = { ...ctx.slots, inject(name: string, callback: () => unknown) { const dispose = callback(); if (typeof dispose === 'function') childEffects.push(dispose as () => void) } }
    activateWorkbench(child)
    return () => { for (const dispose of childEffects.reverse()) dispose() }
  }
  const stop = start()
  const settings = entries.get('super-code').contribution.inject()
  const workflow = entries.get('super-code-workflows').contribution.inject()
  const preference = settings.workbenchState.snapshot()?.preference
  assert.ok(preference)
  assert.equal(entries.has('super-code-workbench'), false)
  assert.equal(workflow.hasWorkbench(), false)
  preference.save({ enabled: true })
  assert.equal(workflow.hasWorkbench(), true, '工作流文件入口读取工作台现有开关')
  assert.equal(entries.get('super-code-workbench').contribution.name, 'conversation.view')
  assert.ok(entries.has('super-code'))
  preference.save({ enabled: false })
  assert.equal(entries.has('super-code-workbench'), false)
  assert.equal(workflow.hasWorkbench(), false)
  preference.save({ enabled: true })
  const changes: unknown[] = []
  const unsubscribe = settings.workbenchState.subscribe(() => changes.push(settings.workbenchState.snapshot()))
  stop()
  assert.equal(settings.workbenchState.snapshot(), null)
  assert.equal(workflow.hasWorkbench(), false)
  assert.equal(entries.has('super-code-workbench'), false)
  const stopAgain = start()
  assert.equal(settings.workbenchState.snapshot().preference.snapshot().enabled, true)
  assert.equal(entries.has('super-code-workbench'), true)
  assert.equal(workflow.hasWorkbench(), true)
  assert.equal(changes.length, 2)
  unsubscribe()
  stopAgain()
  for (const dispose of effects.reverse()) dispose()
  assert.equal(entries.size, 0)
})

test('真实 Cordis 工作台初始化失败时释放已登记的资源，其他设置保留', async t => {
  const { Context, Service } = await import('@deepseek-ai/cordis')
  const { waitFor } = await import('../wait-for.js')
  const ctx = new Context(), registrations = new Map<string, any>()
  const storage = new Map<string, string>(), localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }
  let plugin: any, workbenchStyles = 0, workbenchLocales = 0, failed = false
  const hostRequire = (id: string) => id.startsWith('@deepseek-ai/') ? {} : require(id)
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    URL, AbortController, localStorage, setTimeout, clearTimeout, console,
    document: { documentElement: { style: {} }, createElement: () => ({ dataset: {}, style: {}, remove() { if (this.dataset.superCodeWorkbench) workbenchStyles-- } }),
      head: { append(element: any) { if (element.dataset.superCodeWorkbench) workbenchStyles++ }, appendChild() {} } },
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory(hostRequire) } } },
  })
  class Slots extends Service {
    constructor(owner: InstanceType<typeof Context>) { super(owner, 'slots') }
    entries() { return [] }
    inject(_name: string, callback: () => any) { this.ctx.effect(callback) }
    register(config: any, component: unknown) {
      const id = config.id || config.key, entry = { config, component }; registrations.set(id, entry)
      return () => { if (registrations.get(id) === entry) registrations.delete(id) }
    }
  }
  class Tabs extends Service {
    constructor(owner: InstanceType<typeof Context>) { super(owner, 'sidebarRightTabs') }
    register(config: any) {
      if (config.id === 'super-code-workbench-file') { failed = true; throw new Error('预期的工作台注册失败') }
      return () => {}
    }
  }
  new Slots(ctx); new Tabs(ctx)
  ctx.provide('locale' as never, { register: (namespace: string) => { if (namespace === 'dsh-super-code-workbench') { workbenchLocales++; return () => { workbenchLocales-- } } return () => {} }, bind: () => (key: string) => key } as never)
  ctx.provide('remote' as never, { $mount: async () => {} } as never)
  ctx.provide('sessions' as never, { list: { getSnapshot: () => ({ byId: {} }) } } as never)
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(plugin)
  await waitFor(() => failed && workbenchStyles === 0 && workbenchLocales === 0)
  assert.ok(registrations.has('super-code'), '工作台失败不能撤销现有设置')
  const settings = registrations.get('super-code').config.inject()
  assert.equal(settings.workbenchState.snapshot(), null)
  assert.equal(registrations.has('super-code-workbench-file'), false)
})
