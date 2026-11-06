import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ConnectionService } from '../src/connection/service.js'
import { ConnectionStore } from '../src/connection/store.js'
import { SuperCodeConnection } from '../src/dsh/connection.js'
import type { DelegationHost } from '../src/connection/types.js'

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children || []).flatMap(nodes)]
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const initial = () => ({ revision: 2, writable: true, state: 'error', error: 'cleanup-failed',
  url: 'http://127.0.0.1:23457/mcp', configuration: { enabled: true, allowNewConversations: true,
    allowCallerApproval: false, port: 23457, maxConnections: 3, maxConcurrent: 3,
    allowedDirectories: ['/project'], knownDirectories: [], directoriesConfigured: true } })

function fixture(api: any, options: { home?: boolean; budgetApi?: any; budgetSection?: string } = {}) {
  let plugin: any, Settings: any, current: any
  const instances = new Map<Function, any>()
  const react = {
    Fragment: 'fragment', forwardRef: () => 'button',
    createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item !== false && item != null) }),
    useState: (initial: any) => {
      const state = current, i = state.cursor++
      if (!(i in state.hooks)) state.hooks[i] = typeof initial === 'function' ? initial() : initial
      return [state.hooks[i], (value: any) => { state.hooks[i] = typeof value === 'function' ? value(state.hooks[i]) : value }]
    },
    useRef: (initial: any) => { const i = current.cursor++; return current.hooks[i] ||= { current: initial } },
    useMemo: (factory: Function, deps: any[]) => {
      const i = current.cursor++, old = current.hooks[i]
      if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) current.hooks[i] = { deps, value: factory() }
      return current.hooks[i].value
    },
    useEffect: (effect: Function, deps: any[] = []) => {
      const state = current, i = state.cursor++, old = state.hooks[i]
      if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) {
        state.effects.push(() => { old?.cleanup?.(); state.hooks[i] = { deps, cleanup: effect() } })
      }
    },
    useSyncExternalStore: (_subscribe: Function, read: Function) => read(),
  }
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    window: { addEventListener() {}, removeEventListener() {},
      __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? react : {}) } } },
  })
  const ctx: any = {
    effect() {}, locale: { bind: () => (key: string) => key }, remote: { $mount: async () => {} },
    settingsScope: { bind: () => ({}) },
    inject: (dependencies: string[], callback: Function) => { if (dependencies[0] === 'remote.superCodePresets') callback(ctx) },
    slots: { inject: (_: string, callback: Function) => callback(), register: (config: any, component: any) => { if (config.name === 'settings.section') Settings = component } },
    sidebarRightTabs: { register: () => () => {} }, sessions: {}, sidebarRight: {},
  }
  plugin.apply(ctx)
  const render = (component: Function, props: any, effects = true) => {
    current = instances.get(component) || { hooks: [] }; instances.set(component, current)
    current.cursor = 0; current.effects = []
    const tree = component(props)
    if (effects) for (const effect of current.effects) effect()
    return tree
  }
  const parent = render(Settings, { connectionApi: api, budgetApi: options.budgetApi, t: (key: string) => key }, false)
  const element = nodes(parent).find(row => typeof row.type === 'function'
    && (options.home ? row.props.connectionApi === api : options.budgetSection
      ? row.props.api === options.budgetApi && (row.props.section ?? 'context') === options.budgetSection : row.props.api === api))!
  return () => render(element.type, { ...element.props, active: true })
}
const button = (tree: any) => nodes(tree).find(row => row.type === 'button' && row.children.includes('save.retry'))

test('connection runtime failure offers an explicit retry using the saved configuration and revision', async () => {
  const stored = initial(), calls: any[] = []
  const api = {
    readConfig: async () => ({ ok: true, value: stored }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    revealToken: async () => ({ ok: true, value: { token: '' } }),
    saveConfig: async (content: string, revision: string) => {
      calls.push({ configuration: JSON.parse(content), revision })
      return { ok: true, value: { ok: true, snapshot: { ...stored, revision: 3, state: 'listening', error: '', configuration: JSON.parse(content) } } }
    },
  }
  const render = fixture(api); render(); await tick()
  const retry = button(render())
  assert.ok(retry, 'runtime errors must provide a recovery action without a permanent Save button')
  assert.equal(retry.props.disabled, false)
  retry.props.onClick(); await tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].revision, '2')
  assert.deepEqual(calls[0].configuration.allowedDirectories, ['/project'])
  assert.equal(calls[0].configuration.enabled, true)
  assert.equal(button(render()), undefined, 'successful recovery removes the action')
})

test('runtime retry cannot write while settings are read-only or contain an unsaved invalid draft', async () => {
  for (const writable of [false, true]) {
    const stored = { ...initial(), writable }
    let writes = 0
    const render = fixture({
      readConfig: async () => ({ ok: true, value: stored }),
      directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
      revealToken: async () => ({ ok: true, value: { token: '' } }),
      saveConfig: async () => { writes++; throw new Error('must not write') },
    })
    render(); await tick()
    if (writable) {
      const port = nodes(render()).find(row => row.props.id === 'super-code-connection-port')
      port.props.onChange({ target: { value: '' } }); port.props.onBlur(); await tick()
    }
    const retry = button(render())
    assert.ok(retry); assert.equal(retry.props.disabled, true)
    retry.props.onClick(); await tick()
    assert.equal(writes, 0)
  }
})

test('failed automatic saves retain the draft and expose a user-driven retry without blind writes', async () => {
  const stored = { ...initial(), state: 'listening', error: '' }, calls: any[] = []
  const render = fixture({
    readConfig: async () => ({ ok: true, value: stored }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    revealToken: async () => ({ ok: true, value: { token: '' } }),
    saveConfig: async (content: string, revision: string) => {
      calls.push({ configuration: JSON.parse(content), revision })
      return calls.length === 1 ? { ok: true, value: { ok: false, error: 'save-failed' } }
        : { ok: true, value: { ok: true, snapshot: { ...stored, revision: 3, configuration: JSON.parse(content) } } }
    },
  })
  render(); await tick()
  const port = nodes(render()).find(row => row.props.id === 'super-code-connection-port')
  port.props.onChange({ target: { value: '24568' } }); port.props.onBlur(); await tick()
  assert.equal(calls.length, 1)
  const retry = button(render())
  assert.ok(retry); assert.equal(retry.props.disabled, false)
  assert.equal(nodes(render()).find(row => row.props.id === 'super-code-connection-port').props.value, '24568')
  retry.props.onClick(); await tick()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].revision, '2')
  assert.equal(calls[1].configuration.port, 24568)
  assert.equal(button(render()), undefined)
})

test('home keeps confirmed saves and their revisions when the follow-up read fails', async () => {
  for (const kind of ['protection', 'connection']) {
    let failReads = false
    const writes: any[] = []
    const connection = { ...initial(), state: 'disabled', configuration: { ...initial().configuration, enabled: false } }
    const budget = { revision: 4, writable: true, configuration: { deletionProtection: 'relaxed' } }
    const api = (snapshot: any, target: string) => ({
      readConfig: async () => failReads ? { ok: false } : { ok: true, value: snapshot },
      overview: async () => ({ ok: true, value: { connections: [], sessions: [] } }),
      saveConfig: async (content: string, revision: string) => {
        writes.push({ target, revision, configuration: JSON.parse(content) })
        failReads = true
        return { ok: true, value: { ok: true, snapshot: { ...snapshot, revision: Number(revision) + 1, configuration: JSON.parse(content) } } }
      },
    })
    const render = fixture(api(connection, 'connection'), { home: true, budgetApi: api(budget, 'protection') })
    render(); await tick()
    const control = () => nodes(render()).find(row => typeof row.props.onChange === 'function' && (kind === 'protection'
      ? row.props.label === 'delete.mode' : row.props['aria-label'] === 'home.mcp'))
    control().props.onChange(kind === 'protection' ? 'strict' : true)
    await tick()
    assert.equal(writes.length, 1)
    assert.equal(kind === 'protection' ? control().props.value : control().props.checked, kind === 'protection' ? 'strict' : true,
      'an acknowledged save must not appear to roll back after an unrelated read failure')
    assert.ok(nodes(render()).some(row => row.props.role === 'alert'))
    control().props.onChange(kind === 'protection' ? 'off' : false)
    await tick()
    assert.equal(writes[1].revision, kind === 'protection' ? '5' : '3', 'next save uses the acknowledged revision')
  }
})

test('picked directory aliases become one checked row and stay removed after reloading settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-directory-ui-'))
  const target = join(root, '中文 目录'), alias = join(root, '目录 别名')
  await mkdir(target); await symlink(target, alias, 'junction')
  const ctx = new Context(), service = new ConnectionService(new ConnectionStore(join(root, 'profile')), {} as DelegationHost)
  t.after(async () => { await ctx.fiber.dispose(); await service.close(); await rm(root, { recursive: true, force: true }) })
  await service.initialize()
  const remote = new SuperCodeConnection(ctx, () => service, { workspaces: false,
    picker: { capability: () => ({ kind: 'native', pick: async () => alias }) } })
  const api = {
    readConfig: async () => ({ ok: true, value: remote.readConfig() }),
    directories: async () => ({ ok: true, value: await remote.directories() }),
    revealToken: async () => ({ ok: true, value: remote.revealToken() }),
    pickDirectory: async () => ({ ok: true, value: await remote.pickDirectory(new AbortController().signal) }),
    saveConfig: async (content: string, revision: string) => ({ ok: true, value: await remote.saveConfig(content, revision) }),
  }
  const rows = (tree: any) => nodes(tree).filter(row => row.props.className === 'dsh-super-code-directory-row')
  const wait = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(condition(), 'directory operation did not finish')
  }
  let render = fixture(api); render()
  await wait(() => nodes(render()).some(row => row.children.includes('connection.addDirectory') && !row.props.disabled))
  nodes(render()).find(row => row.children.includes('connection.addDirectory')).props.onClick()
  await wait(() => service.read().revision === 1 && !nodes(render()).some(row => row.props['aria-busy'] === true))
  const canonical = await realpath(target)
  assert.equal(rows(render()).length, 1, 'canonical and picker paths must not produce duplicate rows')
  assert.deepEqual(service.read().configuration.knownDirectories, [canonical])
  assert.equal(nodes(rows(render())[0]).find(row => row.type === 'input').props.checked, true)

  // Loading the catalog again must not resurrect the selected spelling of the same path.
  nodes(render()).find(row => row.children.includes('connection.reload')).props.onClick()
  await wait(() => !nodes(render()).some(row => row.props.disabled && row.children.includes('connection.reload')))
  assert.equal(rows(render()).length, 1)
  const remove = nodes(rows(render())[0]).find(row => row.props['aria-label']?.startsWith('connection.removeDirectory:'))
  remove.props.onClick()
  await wait(() => service.read().revision === 2 && !nodes(render()).some(row => row.props['aria-busy'] === true))
  assert.deepEqual(service.read().configuration.allowedDirectories, [])
  assert.deepEqual(service.read().configuration.knownDirectories, [])
  render = fixture(api); render()
  await wait(() => nodes(render()).some(row => row.children.includes('connection.addDirectory') && !row.props.disabled))
  assert.equal(rows(render()).length, 0, 'removed aliases must stay absent after reopening settings')
})

const budgetInitial = () => ({ revision: 4, writable: true, ptcMaxTimeoutMs: false, defaults: {}, configuration: {
    windowsBash: false, windowsBashForOfficialPresets: true, deletionProtection: 'strict',
    deletionProtectionForOfficialPresets: true, applyToOfficialPresets: true, maxTasks: 48,
    budgets: { summaryMaxTokens: 4096 },
  } })

for (const section of ['context', 'protection']) test(`${section} reset claims the operation before waiting for a pending autosave`, async () => {
  let stored = budgetInitial()
  const writes: any[] = []
  let finish!: () => void
  const api = {
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string, revision: string) => {
      writes.push({ configuration: JSON.parse(content), revision })
      if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve })
      if (revision !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  }
  const render = fixture(api, { budgetApi: api, budgetSection: section })
  const action = (key: string) => nodes(render()).find(row => row.children.includes(key) && typeof row.props.onClick === 'function')
  const field = () => section === 'context' ? nodes(render()).find(row => row.props.id === 'super-code-budget-maxTasks').children[0]()
    : nodes(render()).find(row => row.props.name === 'super-code-deletion-mode')
  render(); await tick()
  const input = field()
  if (section === 'context') { input.props.onChange({ target: { value: '49' } }); input.props.onBlur() }
  else input.props.onChange('off')
  assert.equal(writes.length, 1)
  action('budget.reset').props.onClick()
  const resetting = action('budget.resetConfirm').props.onClick()
  const busyInput = field()
  const again = action('budget.reset')
  // Use only enabled actions, as a user can while the original save is delayed.
  if (!again.props.disabled) {
    again.props.onClick()
    action('budget.resetConfirm').props.onClick()
  }
  finish(); await resetting; await tick()
  assert.equal(writes.length, 2, 'one autosave and one reset; repeated confirmation must not submit a stale revision')
  assert.equal(busyInput.props.disabled, true, 'reset must disable edits while waiting for the prior save')
  assert.deepEqual(writes.map(row => row.revision), ['4', '5'])
  assert.deepEqual(stored.configuration, section === 'context' ? { windowsBash: false, windowsBashForOfficialPresets: true,
    deletionProtection: 'strict', deletionProtectionForOfficialPresets: true }
    : { ...budgetInitial().configuration, deletionProtection: 'relaxed', deletionProtectionForOfficialPresets: false })
  assert.equal(nodes(render()).some(row => row.children.includes('budget.error.conflict')), false)
})

test('reset cancellation makes no write and a failed reset unlocks an explicit retry', async () => {
  let stored = budgetInitial(), fail = true
  const writes: any[] = [], api = {
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string, revision: string) => {
      writes.push({ configuration: JSON.parse(content), revision })
      if (fail) return { ok: true, value: { ok: false, error: 'save-failed' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  }
  const render = fixture(api, { budgetApi: api, budgetSection: 'context' })
  const action = (key: string) => nodes(render()).find(row => row.children.includes(key) && typeof row.props.onClick === 'function')
  render(); await tick()
  action('budget.reset').props.onClick(); action('preset.cancel').props.onClick()
  assert.equal(writes.length, 0)
  action('budget.reset').props.onClick(); await action('budget.resetConfirm').props.onClick()
  assert.deepEqual(stored, budgetInitial())
  assert.equal(nodes(render()).some(row => row.children.includes('budget.error.save-failed')), true)
  assert.equal(action('budget.reset').props.disabled, false)
  fail = false
  action('budget.reset').props.onClick(); await action('budget.resetConfirm').props.onClick()
  assert.deepEqual(writes.map(row => row.revision), ['4', '4'])
  assert.equal(stored.revision, 5)
  assert.equal(nodes(render()).some(row => row.children.includes('budget.resetDone')), true)
})

test('a reset stops if its pending autosave returns a read-only snapshot', async () => {
  const initial = budgetInitial(), writes: any[] = []
  let finish!: (value: any) => void
  const api = {
    readConfig: async () => ({ ok: true, value: initial }),
    saveConfig: async (content: string, revision: string) => {
      writes.push({ content, revision })
      return new Promise(resolve => { finish = resolve })
    },
  }
  const render = fixture(api, { budgetApi: api, budgetSection: 'context' })
  const action = (key: string) => nodes(render()).find(row => row.children.includes(key) && typeof row.props.onClick === 'function')
  render(); await tick()
  const input = nodes(render()).find(row => row.props.id === 'super-code-budget-maxTasks').children[0]()
  input.props.onChange({ target: { value: '49' } }); input.props.onBlur()
  action('budget.reset').props.onClick(); const resetting = action('budget.resetConfirm').props.onClick()
  finish({ ok: true, value: { ok: true, snapshot: { ...initial, revision: 5, writable: false,
    configuration: JSON.parse(writes[0].content) } } })
  await resetting; await tick()
  assert.equal(writes.length, 1, 'read-only response prevents the reset write')
  assert.equal(action('budget.reset').props.disabled, true)
  assert.equal(nodes(render()).some(row => row.children.includes('budget.resetDone')), false)
})
