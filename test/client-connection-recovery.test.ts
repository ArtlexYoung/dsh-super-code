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

function fixture(api: any, options: { home?: boolean; budgetApi?: any; budgetSection?: string; timers?: Function[] } = {}) {
  let plugin: any, Settings: any, settingsProps: any, current: any
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
  Object.assign(react, { useLayoutEffect: react.useEffect })
  runInNewContext(readFileSync(new URL('../client/index.js', import.meta.url), 'utf8'), {
    URL, setTimeout, clearTimeout, setInterval: (callback: Function) => { options.timers?.push(callback); return 1 }, clearInterval() {},
    window: { addEventListener() {}, removeEventListener() {},
      __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((id: string) => id === 'react' ? react : {}) } } },
  })
  const ctx: any = {
    effect() {}, locale: { bind: () => (key: string) => key }, remote: { $mount: async () => {}, superCodeConnection: api, superCodeBudgets: options.budgetApi },
    settingsScope: { bind: () => ({}) },
    inject: (dependencies: string[], callback: Function) => { if (dependencies[0] === 'remote.superCodePresets') callback(ctx) },
    slots: { inject: (_: string, callback: Function) => callback(), register: (config: any, component: any) => {
      if (config.name === 'settings.section') { Settings = component; settingsProps = config.inject }
    } },
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
  const mount = () => {
    const parent = render(Settings, { ...settingsProps(), t: (key: string) => key }, false)
    return nodes(parent).find(row => typeof row.type === 'function'
      && (options.home ? row.props.connectionApi === api : options.budgetSection
        ? row.props.api?.editors && (row.props.section ?? 'context') === options.budgetSection : row.props.api === api))!
  }
  let element = mount()
  const show = (active = true) => render(element.type, { ...element.props, active })
  return Object.assign(Object.defineProperty(show, 'props', { get: () => element.props }) as typeof show & { props: any }, {
    reopen() {
      for (const state of instances.values()) for (const hook of state.hooks) hook?.cleanup?.()
      instances.clear(); element = mount()
    },
  })
}
const button = (tree: any) => nodes(tree).find(row => row.type === 'button' && row.children.includes('save.retry'))

for (const failure of ['response', 'transport']) test(`a ${failure} credential failure after rotation removes the invalid token and recovers on reveal`, async () => {
  let stored = initial(), rotated = false, fail = true, saves = 0
  const render = fixture({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    rotateToken: async (expected: string) => {
      assert.equal(expected, String(stored.revision))
      rotated = true
      stored = { ...stored, revision: stored.revision + 1 }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
    revealToken: async () => {
      if (rotated && fail) {
        if (failure === 'transport') throw new Error('credential service unavailable')
        return { ok: false }
      }
      return { ok: true, value: { token: rotated ? 'new-fixture-token' : 'old-fixture-token' } }
    },
  })
  render.props.onSaved = () => { saves++ }
  const token = () => nodes(render()).find(row => row.props['aria-label'] === 'connection.token')
  const action = (key: string) => nodes(render()).find(row => row.children.includes(key) && row.props.onClick)!
  render(); await tick()
  assert.equal(token().props.value, 'old-fixture-token')
  await action('connection.rotate').props.onClick(); await tick()
  assert.equal(token(), undefined, 'a successfully rotated token is no longer valid and must not remain visible')
  assert.equal(action('connection.copyToken'), undefined)
  assert.equal(nodes(render()).some(row => row.children.includes('connection.error.unavailable')), true)
  assert.equal(nodes(render()).some(row => row.children.includes('connection.rotated')), false)
  assert.equal(saves, 1, 'the successful rotation changes state even if fetching its credential fails')
  fail = false
  await action('connection.showToken').props.onClick(); await tick()
  assert.equal(token().props.value, 'new-fixture-token')
  assert.equal(nodes(render()).some(row => row.children.includes('connection.error.unavailable')), false)
})

test('pending rotation clears the old credential, rejects duplicate actions and keeps a late credential hidden', async () => {
  let stored = initial(), rotated = false, rotations = 0, release!: () => void
  const render = fixture({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    rotateToken: async () => {
      rotations++
      await new Promise<void>(resolve => { release = resolve })
      rotated = true
      stored = { ...stored, revision: stored.revision + 1 }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
    revealToken: async () => ({ ok: true, value: { token: rotated ? 'new-fixture-token' : 'old-fixture-token' } }),
  })
  render(); await tick()
  const rotate = nodes(render()).find(row => row.children.includes('connection.rotate') && row.props.onClick)!
  const pending = rotate.props.onClick()
  await rotate.props.onClick()
  const hiddenWhilePending = !nodes(render()).some(row => row.props['aria-label'] === 'connection.token')
  render(false); release(); await pending; await tick()
  assert.equal(hiddenWhilePending, true)
  assert.equal(rotations, 1)
  assert.equal(nodes(render(false)).some(row => row.props['aria-label'] === 'connection.token'), false)
  render(true); await tick()
  assert.equal(nodes(render()).find(row => row.props['aria-label'] === 'connection.token').props.value, 'new-fixture-token')
})

for (const failure of ['response', 'transport']) test(`a ${failure} rotation failure allows revealing the unchanged credential again`, async () => {
  const stored = initial()
  let saves = 0
  const render = fixture({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    rotateToken: async () => {
      if (failure === 'transport') throw new Error('rotation unavailable')
      return { ok: true, value: { ok: false, error: 'save-failed' } }
    },
    revealToken: async () => ({ ok: true, value: { token: 'unchanged-fixture-token' } }),
  })
  render.props.onSaved = () => { saves++ }
  const action = (key: string) => nodes(render()).find(row => row.children.includes(key) && row.props.onClick)!
  render(); await tick()
  await action('connection.rotate').props.onClick(); await tick()
  assert.equal(saves, 0)
  assert.equal(render.props.settings.editors.connection.getSnapshot().snapshot.revision, stored.revision)
  assert.equal(nodes(render()).some(row => row.children.includes(`connection.error.${failure === 'transport' ? 'unavailable' : 'save-failed'}`)), true)
  assert.equal(nodes(render()).some(row => row.children.includes('connection.rotated')), false)
  await action('connection.showToken').props.onClick(); await tick()
  assert.equal(nodes(render()).find(row => row.props['aria-label'] === 'connection.token').props.value, 'unchanged-fixture-token')
})

test('connection settings show the actual unavailable service state when credentials cannot be revealed', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let available = false
  const remote = new SuperCodeConnection(ctx, () => available ? {
    read: () => initial(), reveal: () => ({ token: 'fixture-token' }),
  } as ConnectionService : false)
  const api = {
    readConfig: async () => ({ ok: true, value: remote.readConfig() }),
    directories: async () => ({ ok: true, value: await remote.directories() }),
    revealToken: async () => { try { return { ok: true, value: remote.revealToken() } } catch { return { ok: false } } },
  }
  const render = fixture(api)
  render(); await tick()
  assert.equal(nodes(render()).some(row => row.props.role === 'status' && row.children.includes('connection.state.error')), true,
    'a failed credential read must not hide a successfully read unavailable-service snapshot behind loading')
  assert.equal(nodes(render()).find(row => row.props.id === 'super-code-connection-port').props.disabled, true)
  assert.equal(nodes(render()).some(row => row.children.includes('connection.error.unavailable')), true)
  available = true
  const reload = nodes(render()).find(row => row.children.includes('connection.reload') && row.props.onClick)!
  await reload.props.onClick(); await tick()
  assert.equal(nodes(render()).find(row => row.props.id === 'super-code-connection-port').props.disabled, false)
  assert.equal(nodes(render()).some(row => row.props['aria-label'] === 'connection.token' && row.props.value === 'fixture-token'), true)
})

for (const failure of ['response', 'transport']) test(`a ${failure} credential failure clears an old token without hiding current settings permissions`, async () => {
  let stored = initial(), unavailable = false
  const render = fixture({
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    revealToken: async () => {
      if (unavailable) {
        if (failure === 'transport') throw new Error('credential service unavailable')
        return { ok: false }
      }
      return { ok: true, value: { token: 'current-fixture-token' } }
    },
  })
  render(); await tick()
  const token = () => nodes(render()).find(row => row.props['aria-label'] === 'connection.token')
  assert.equal(token().props.value, 'current-fixture-token')
  render(false)
  stored = { ...stored, writable: false, revision: stored.revision + 1 }
  unavailable = true
  render(true); await tick()
  assert.equal(token(), undefined)
  assert.equal(nodes(render()).find(row => row.props.id === 'super-code-connection-port').props.disabled, true)
  assert.equal(nodes(render()).some(row => row.children.includes('connection.error.unavailable')), true)
  stored = { ...stored, writable: true }
  unavailable = false
  const reload = nodes(render()).find(row => row.children.includes('connection.reload') && row.props.onClick)!
  await reload.props.onClick(); await tick()
  assert.equal(nodes(render()).find(row => row.props.id === 'super-code-connection-port').props.disabled, false)
  assert.equal(token().props.value, 'current-fixture-token')
})

for (const first of ['protection', 'connection']) test(`home disables both quick controls while its ${first} save is pending`, async () => {
  let budget = { revision: 1, writable: true, configuration: { deletionProtection: 'relaxed' } }
  let connection = { ...initial(), configuration: { ...initial().configuration, enabled: false } }
  let release!: () => void
  const held = () => new Promise<void>(resolve => { release = resolve })
  const budgetApi = {
    readConfig: async () => ({ ok: true, value: structuredClone(budget) }),
    saveConfig: async (content: string) => {
      if (first === 'protection') await held()
      budget = { ...budget, revision: budget.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(budget) } }
    },
  }
  const render = fixture({
    readConfig: async () => ({ ok: true, value: structuredClone(connection) }),
    overview: async () => ({ ok: true, value: { connections: [], sessions: [] } }),
    saveConfig: async (content: string) => {
      if (first === 'connection') await held()
      connection = { ...connection, revision: connection.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(connection) } }
    },
  }, { home: true, budgetApi })
  const controls = () => ({
    protection: nodes(render()).find(row => row.props.label === 'delete.mode')!,
    connection: nodes(render()).find(row => row.props['aria-label'] === 'home.mcp' && typeof row.props.onChange === 'function')!,
  })
  render(); await tick()
  const saving = controls()[first as 'protection' | 'connection'].props.onChange(first === 'protection' ? 'strict' : true)
  await tick()
  const other = controls()[first === 'protection' ? 'connection' : 'protection']
  const disabled = other.props.disabled || Boolean(other.props.busy)
  release(); await saving; await tick()
  assert.equal(disabled, true, 'an action rejected by the shared pending-write guard must not look available')
  assert.equal(controls().protection.props.disabled, false)
  assert.equal(controls().connection.props.disabled, false)
  controls()[first === 'protection' ? 'connection' : 'protection'].props.onChange(first === 'protection' ? true : 'strict')
  await tick()
  assert.equal(budget.configuration.deletionProtection, 'strict')
  assert.equal(connection.configuration.enabled, true)
})

for (const section of ['context', 'connection']) for (const failure of ['invalid', 'save-failed']) {
  test(`${section} refreshes read-only permissions without discarding a retained ${failure} draft or rebasing it`, async () => {
    let stored: any = section === 'context'
      ? { revision: 1, writable: true, defaults: {}, configuration: { maxTasks: 32 } }
      : initial()
    let fail = failure === 'save-failed', writes = 0
    const api = {
      readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
      directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
      revealToken: async () => ({ ok: true, value: { token: '' } }),
      saveConfig: async (content: string, expected: string) => {
        writes++
        if (fail) { fail = false; return { ok: true, value: { ok: false, error: 'save-failed' } } }
        assert.equal(stored.writable, true, 'known read-only settings must not submit another write')
        if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
        stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
        return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
      },
    }
    const render = fixture(api, { budgetApi: api, budgetSection: section === 'context' ? section : undefined })
    const input = () => section === 'context'
      ? nodes(render()).find(row => row.props.id === 'super-code-budget-maxTasks').children[0]()
      : nodes(render()).find(row => row.props.id === 'super-code-connection-port')
    const actions = () => nodes(render()).flatMap(row => row.props.action ? [row, row.props.action] : [row])
    const edit = (value: string) => { input().props.onChange({ target: { value } }); input().props.onBlur() }
    const editor = section === 'context' ? render.props.api.editors.context : render.props.settings.editors.connection
    render(); await tick()
    const originalRevision = stored.revision
    const draft = failure === 'invalid' ? '0' : section === 'context' ? '49' : '24567'
    edit(draft); await tick()
    assert.equal(editor.getSnapshot().error, failure)
    const previousWrites = writes
    render(false)
    stored = { ...stored, writable: false, revision: stored.revision + 1,
      configuration: { ...stored.configuration, [section === 'context' ? 'maxTasks' : 'port']: section === 'context' ? 64 : 24680 } }
    render(true); await tick()
    assert.equal(input().props.disabled, true, 'a retained draft must not hide a change to read-only permissions')
    for (const retry of actions().filter(row => row.children.includes('save.retry') && row.props.onClick)) {
      assert.equal(retry.props.disabled, true, 'retry controls also respect the current read-only permission')
    }
    assert.equal(input().props.value, draft)
    assert.equal(editor.getSnapshot().snapshot.revision, originalRevision, 'permission refresh must not rebase external configuration')
    assert.equal(writes, previousWrites)
    render(false); stored = { ...stored, writable: true }; render(true); await tick()
    assert.equal(input().props.disabled, false)
    assert.equal(input().props.value, draft)
    edit(section === 'context' ? '50' : '24568'); await tick()
    assert.equal(editor.getSnapshot().error, 'conflict', 'external changes still require an explicit reload')
    const reload = actions().find(row => row.children.includes(section === 'context' ? 'budget.reload' : 'connection.reload') && row.props.onClick)
    await reload.props.onClick(); await tick()
    assert.equal(input().props.value, section === 'context' ? '64' : '24680')
    assert.equal(editor.getSnapshot().error, '')
    edit(section === 'context' ? '50' : '24568'); await tick()
    assert.equal(editor.getSnapshot().error, '')
  })
}

for (const failure of ['invalid', 'save-failed']) test(`a retained ${failure} budget draft waits for another tab's pending save on return`, async () => {
  let stored = { revision: 1, writable: true, defaults: {}, configuration: { maxTasks: 32 } as Record<string, unknown> }
  let fail = failure === 'save-failed', hold = false, release!: () => void
  const writes: string[] = []
  const api = {
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    saveConfig: async (content: string, expected: string) => {
      writes.push(expected)
      if (fail) { fail = false; return { ok: true, value: { ok: false, error: 'save-failed' } } }
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  }
  const render = fixture(api, { budgetApi: api, budgetSection: 'context' })
  const input = () => nodes(render()).find(row => row.props.id === 'super-code-budget-maxTasks').children[0]()
  const edit = (value: string) => { input().props.onChange({ target: { value } }); input().props.onBlur() }
  render(); await tick()
  edit(failure === 'invalid' ? '0' : '49'); await tick()
  assert.equal(render.props.api.editors.context.getSnapshot().error, failure)
  render(false)
  const { skills } = render.props.api.editors
  skills.receive((await render.props.api.readConfig()).value)
  hold = true; skills.change({ openspecSkills: true })
  render(true)
  const waiting = input().props.disabled
  if (!waiting) { edit('50'); await tick() }
  release(); await skills.flush(); await tick()
  if (waiting) { edit('50'); await tick() }
  assert.equal(stored.configuration.openspecSkills, true, 'correcting a retained draft must not cause the pending Skill choice to fail')
  assert.equal(waiting, true, 'returning to a retained draft must wait for the other local writer')
  assert.equal(stored.configuration.maxTasks, 50)
  assert.equal(render.props.api.editors.context.getSnapshot().error, '')
  assert.equal(skills.getSnapshot().error, '')
})

for (const section of ['skills', 'connection']) test(`${section} saves remain coordinated after closing and reopening settings`, async () => {
  let stored = section === 'skills' ? { revision: 1, writable: true, configuration: {} } : initial()
  let release!: () => void, writes = 0
  const api = {
    readConfig: async () => ({ ok: true, value: structuredClone(stored) }),
    directories: async () => ({ ok: true, value: { items: [], picker: 'unavailable' } }),
    revealToken: async () => ({ ok: true, value: { token: '' } }),
    saveConfig: async (content: string, expected: string) => {
      if (++writes === 1) await new Promise<void>(resolve => { release = resolve })
      if (expected !== String(stored.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  }
  const render = fixture(api, { budgetApi: api, budgetSection: section === 'skills' ? section : undefined })
  render(); await tick()
  const edit = (key: string, value: boolean) => {
    if (section === 'skills') nodes(render()).find(row => row.props.id === `super-code-skill-${key}`).children[0]().props.onChange(value)
    else nodes(render()).find(row => row.children.includes(`connection.${key}`) && row.props.onChange).props.onChange(value)
  }
  edit(section === 'skills' ? 'openspecSkills' : 'allowNewConversations', section === 'skills')
  render.reopen(); render(); await tick()
  if (section === 'skills') edit('mattpocockSkills', true)
  assert.equal(writes, 1, 'reopening must not create a second writer for the same settings document')
  release(); await tick()
  if (section === 'connection') edit('allowCallerApproval', true)
  await tick()
  assert.equal(writes, 2)
  const configuration = stored.configuration as Record<string, unknown>
  assert.equal(configuration[section === 'skills' ? 'openspecSkills' : 'allowNewConversations'], section === 'skills')
  assert.equal(configuration[section === 'skills' ? 'mattpocockSkills' : 'allowCallerApproval'], true)
  assert.equal(nodes(render()).some(row => row.children.includes(`${section === 'skills' ? 'budget' : 'connection'}.error.conflict`)), false)
})

test('returning home waits for a pending Skill save before allowing another budget write', async () => {
  let budget = { revision: 1, writable: true, configuration: { deletionProtection: 'relaxed' } as Record<string, unknown> }
  let release!: () => void, hold = true
  const writes: string[] = []
  const render = fixture({
    readConfig: async () => ({ ok: true, value: initial() }),
    overview: async () => ({ ok: true, value: { connections: [], sessions: [] } }),
  }, { home: true, budgetApi: {
    readConfig: async () => ({ ok: true, value: structuredClone(budget) }),
    saveConfig: async (content: string, expected: string) => {
      writes.push(expected)
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      if (expected !== String(budget.revision)) return { ok: true, value: { ok: false, error: 'conflict' } }
      budget = { ...budget, revision: budget.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(budget) } }
    },
  } })
  const control = () => nodes(render()).find(row => row.props.label === 'delete.mode')!
  render(); await tick(); render(false)
  const { skills } = render.props.budgetApi.editors
  skills.receive((await render.props.budgetApi.readConfig()).value)
  skills.change({ openspecSkills: true })
  render(true)
  assert.equal(control().props.disabled || control().props.busy, true)
  control().props.onChange('strict'); await tick()
  assert.equal(writes.length, 1, 'even a stale event cannot start another write while the read is waiting')
  release(); await skills.flush(); await tick()
  assert.equal(control().props.disabled || Boolean(control().props.busy), false)
  control().props.onChange('strict'); await tick()
  assert.deepEqual(writes, ['1', '2'])
  assert.equal(budget.configuration.openspecSkills, true)
  assert.equal(budget.configuration.deletionProtection, 'strict')
})

test('returning home starts a fresh connection read and ignores the previous visit response', async () => {
  let stored = { ...initial(), configuration: { ...initial().configuration, enabled: false } }
  let hold = false, release!: () => void
  const writes: string[] = []
  const render = fixture({
    readConfig: async () => {
      const captured = structuredClone(stored)
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      return { ok: true, value: captured }
    },
    overview: async () => ({ ok: true, value: { connections: [], sessions: [] } }),
    saveConfig: async (content: string, expected: string) => {
      writes.push(expected)
      assert.equal(expected, String(stored.revision))
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  }, { home: true, budgetApi: { readConfig: async () => ({ ok: true, value: { configuration: {}, revision: 1, writable: true } }) } })
  const control = () => nodes(render()).find(row => row.props['aria-label'] === 'home.mcp' && typeof row.props.onChange === 'function')!
  render(); await tick(); render(false)
  hold = true; render(true); await tick(); render(false)
  stored = { ...stored, revision: 3, configuration: { ...stored.configuration, enabled: true } }
  render(true); await tick()
  assert.equal(control().props.checked, true)
  release(); await tick()
  assert.equal(control().props.checked, true, 'the previous visit response must not undo the current one')
  control().props.onChange(false); await tick()
  assert.deepEqual(writes, ['3'])
  assert.equal(stored.configuration.enabled, false)
})

test('home background polling keeps controls usable and cannot undo a user save', async () => {
  let stored = { revision: 1, writable: true, configuration: { deletionProtection: 'relaxed' } }
  let hold = false, release!: () => void
  const timers: Function[] = []
  const render = fixture({
    readConfig: async () => ({ ok: true, value: initial() }),
    overview: async () => ({ ok: true, value: { connections: [], sessions: [] } }),
  }, { home: true, timers, budgetApi: {
    readConfig: async () => {
      const captured = structuredClone(stored)
      if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
      return { ok: true, value: captured }
    },
    saveConfig: async (content: string, expected: string) => {
      assert.equal(expected, String(stored.revision))
      stored = { ...stored, revision: stored.revision + 1, configuration: JSON.parse(content) }
      return { ok: true, value: { ok: true, snapshot: structuredClone(stored) } }
    },
  } })
  const control = () => nodes(render()).find(row => row.props.label === 'delete.mode')!
  render(); await tick()
  hold = true; const poll = timers[0](); await tick()
  assert.equal(control().props.disabled, false)
  control().props.onChange('strict'); await tick()
  assert.equal(stored.configuration.deletionProtection, 'strict')
  release(); await poll; await tick()
  assert.equal(control().props.value, 'strict')
  assert.equal(control().props.disabled, false)
})

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
