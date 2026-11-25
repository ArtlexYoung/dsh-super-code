import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import { waitFor } from '../../wait-for.js'

test('工作台页面随开关实时登记，官方和第三方预设共用同一个入口', async () => {
  const result = await build({ entryPoints: [new URL('../../../builtin/workbench/index.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'text', '.woff2': 'dataurl' } })
  const module = { exports: {} as any }, require = createRequire(import.meta.url)
  const data = new Map(), storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => data.set(key, value) }
  runInNewContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { localStorage: storage, setTimeout, clearTimeout, AbortController, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } }, window: { addEventListener() {}, removeEventListener() {} } })(require, module, module.exports)
  for (const agentPreset of [undefined, 'minimal', 'standard', 'super-code', 'third-party/custom-preset']) {
    const active = new Map<string, any>(), disposers: (() => void)[] = [], preference = module.exports.createWorkbenchPreference(storage)
    preference.save({ enabled: false })
    const ctx: any = {
      effect(run: () => unknown) { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose as () => void) },
      inject(names: string[], run: (ctx: unknown) => void) { if (names.includes('remote.superCodeWorkbench')) run(ctx) },
      locale: { register: () => () => {}, bind: () => (key: string) => key }, remote: { superCodeWorkbench: {} },
      sessions: { list: { getSnapshot: () => ({ byId: { demo: { cwd: '/demo', agentPreset } } }) } },
      sidebarRightTabs: { register: () => () => {} },
      slots: {
        entries: () => [], inject(_name: string, run: () => () => void) { disposers.push(run()) },
        register(contribution: any, component: unknown) { active.set(contribution.id, { contribution, component }); return () => active.delete(contribution.id) },
      },
    }
    module.exports.apply(ctx, { Button: 'button', Select: 'select', MarkdownText: 'div', Conversation: 'div', preference })
    assert.equal(active.has('super-code-workbench'), false)
    preference.save({ enabled: true })
    assert.equal(active.get('super-code-workbench').contribution.name, 'conversation.view')
    const view = active.get('super-code-workbench').component({ t: (key: string) => key })
    assert.equal(view.type.name, 'FeatureBoundary')
    preference.save({ enabled: false }); assert.equal(active.has('super-code-workbench'), false)
    for (const dispose of disposers.reverse()) dispose()
  }
})

test('工作台对话通过真实 Cordis 声明会话接口，并随接口恢复重新登记', async t => {
  const result = await build({ entryPoints: [new URL('../../../builtin/workbench/index.jsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'text', '.woff2': 'dataurl' } })
  const module = { exports: {} as { apply: (ctx: Context, options: object) => void; createWorkbenchPreference: (storage: object) => { save: (value: { enabled: boolean }) => void } } }
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) }
  runInNewContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { localStorage: storage, setTimeout, clearTimeout, AbortController, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} }, addEventListener() {}, removeEventListener() {} }, window: { addEventListener() {}, removeEventListener() {} } })(createRequire(import.meta.url), module, module.exports)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  type Contribution = { id: string; inject: (sessionId: string) => { conversationRemote: { session: { page: () => string } } } }
  const active = new Map<string, Contribution>()
  class Slots extends Service {
    constructor() { super(ctx, 'slots') }
    entries() { return [] }
    inject(_name: string, run: () => () => void) { this.ctx.effect(run) }
    register(contribution: Contribution) {
      active.set(contribution.id, contribution)
      return () => { active.delete(contribution.id) }
    }
  }
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    get session() { return Reflect.get(this.ctx, 'remote.session') }
    get superCodeWorkbench() { return Reflect.get(this.ctx, 'remote.superCodeWorkbench') }
  }
  new Slots()
  new Remote()
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }) } })
  ctx.provide('sidebarRightTabs', { register: () => () => {} })
  ctx.provide('remote.superCodeWorkbench', {})
  const mountSession = () => ctx.plugin({ apply(owner: Context) { owner.provide('remote.session', { page: () => 'history' }) } })
  const session = mountSession()
  await session
  const preference = module.exports.createWorkbenchPreference(storage)
  preference.save({ enabled: true })
  await ctx.plugin({ inject: ['slots', 'remote', 'locale', 'sessions', 'sidebarRightTabs'], apply(owner) { module.exports.apply(owner, { Button: 'button', Select: 'select', MarkdownText: 'div', Conversation: 'div', preference }) } })
  await waitFor(() => active.has('super-code-workbench'))
  const conversation = () => active.get('super-code-workbench')!.inject('demo').conversationRemote.session.page()
  assert.equal(conversation(), 'history')
  await session.dispose()
  assert.equal(active.has('super-code-workbench'), false)
  await mountSession()
  await waitFor(() => active.has('super-code-workbench'))
  assert.equal(conversation(), 'history')
})
