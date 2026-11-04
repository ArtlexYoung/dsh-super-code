import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children || []).flatMap(nodes)]
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const initial = () => ({ revision: 2, writable: true, state: 'error', error: 'cleanup-failed',
  url: 'http://127.0.0.1:23457/mcp', configuration: { enabled: true, allowNewConversations: true,
    allowCallerApproval: false, port: 23457, maxConnections: 3, maxConcurrent: 3,
    allowedDirectories: ['/project'], knownDirectories: [], directoriesConfigured: true } })

function fixture(api: any) {
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
    URL, setTimeout, clearTimeout, window: { addEventListener() {}, removeEventListener() {},
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
  const parent = render(Settings, { connectionApi: api, t: (key: string) => key }, false)
  const component = nodes(parent).find(row => typeof row.type === 'function' && row.props.api === api)!.type
  return () => render(component, { api, t: (key: string) => key, active: true })
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
