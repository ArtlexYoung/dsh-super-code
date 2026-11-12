import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function client() {
  let plugin: any
  runInNewContext(readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8'), {
    AbortController,
    __ModuleLoader__: { load: ({ factory }: any) => {
      plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' } : {})
    } },
  })
  return plugin
}
async function settled() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)) }

function fixture() {
  const p = client(), handlers = new Map<string, Function>()
  const skillUi = {}, scope = {}, draft = { text: '/poteto-mode 继续检查', revision: 7 }
  let configuration: Record<string, unknown> = {}, namespace = 'entry:super-code', reads = 0, restarts = 0, menus = 0
  const errors: unknown[] = []
  const remote = { $on: (event: string, listener: Function) => { handlers.set(event, listener); return () => handlers.delete(event) } }
  const api = { readConfig: async (): Promise<any> => { reads++; return { ok: true, value: { namespace, configuration: structuredClone(configuration) } } } }
  const fiber = { restart: async () => { restarts++ } }
  const ctx = { remote, registry: { get: (plugin: unknown) => { assert.equal(plugin, skillUi); return { fibers: [fiber] } } },
    on: (event: string, listener: Function) => { handlers.set(event, listener); return () => handlers.delete(event) },
    sessions: { list: { getSnapshot: () => ({ byId: { live: {}, archived: {} } }) }, scope: (id: string) => id === 'live' ? scope : undefined },
    inputTriggers: { sessionOf: (value: unknown) => { assert.equal(value, scope); return { refreshOpenMenu: () => { menus++ } } } },
  }
  return { p, ctx, api, fiber, skillUi, errors, handlers, draft,
    start: () => p.synchronizeSkillMenus(ctx, api, skillUi, (error: unknown) => errors.push(error)),
    change: (next: Record<string, unknown>, ns = namespace) => { configuration = next; handlers.get('settings/document-updated')?.(ns, 2) },
    newNamespace: (value: string) => { namespace = value },
    counts: () => ({ reads, restarts, menus }),
  }
}

test('all package switches refresh retained conversations without a page reload or input mutation', async () => {
  const f = fixture(), stop = f.start()
  await settled()
  assert.deepEqual(f.counts(), { reads: 1, restarts: 1, menus: 1 })
  for (const key of ['grillMeSkill', 'oilUiSkill', 'openspecSkills', 'mattpocockSkills', 'pstackSkills']) {
    const before = f.counts().restarts
    f.change({ [key]: true }); await settled()
    assert.equal(f.counts().restarts, before + 1, key)
    f.change({}); await settled()
    assert.equal(f.counts().restarts, before + 2, key)
  }
  assert.deepEqual(f.draft, { text: '/poteto-mode 继续检查', revision: 7 })
  assert.deepEqual(f.errors, [])
  stop(); assert.equal(f.handlers.size, 0)
})

test('unrelated documents, budgets and explicit default values do not restart the Skill interface', async () => {
  const f = fixture(), stop = f.start(); await settled()
  f.change({}, 'locale'); await settled()
  assert.equal(f.counts().reads, 1)
  f.change({ grillMeSkill: false, oilUiSkill: false, openspecSkills: false, mattpocockSkills: false, pstackSkills: false, maxTasks: 48 }); await settled()
  assert.equal(f.counts().restarts, 1)
  stop()
})

test('a change during discovery discards the old read and applies the latest accepted settings', async () => {
  const f = fixture()
  const first = Promise.withResolvers<any>()
  const original = f.api.readConfig
  f.api.readConfig = async () => { f.api.readConfig = original; return first.promise }
  const stop = f.start()
  f.change({ pstackSkills: true })
  first.resolve({ ok: true, value: { configuration: {} } }); await settled()
  assert.equal(f.counts().restarts, 1)
  f.change({ pstackSkills: true }); await settled()
  assert.equal(f.counts().restarts, 1, 'the obsolete initial read must not be installed')
  stop()
})

test('rapid settings changes serialize native UI restarts and converge during an in-flight restart', async () => {
  const f = fixture(), stop = f.start(); await settled()
  const release = Promise.withResolvers<void>()
  let active = 0, maximum = 0, runs = 0
  f.fiber.restart = async () => { active++; maximum = Math.max(maximum, active); if (++runs === 1) await release.promise; active-- }
  f.change({ pstackSkills: true }); await settled()
  f.change({ pstackSkills: false, mattpocockSkills: true })
  f.change({ pstackSkills: false }); release.resolve(); await settled()
  assert.equal(maximum, 1)
  assert.equal(runs, 2)
  f.change({}); await settled()
  assert.equal(runs, 2)
  stop()
})

test('a service failure leaves the menu untouched and a subsequent notification can recover', async () => {
  const f = fixture(), stop = f.start(); await settled()
  const read = f.api.readConfig
  f.api.readConfig = async () => ({ ok: false })
  f.change({ pstackSkills: true }); await settled()
  assert.equal(f.counts().restarts, 1)
  assert.equal(f.errors.length, 1)
  f.api.readConfig = read
  f.change({ pstackSkills: true }); await settled()
  assert.equal(f.counts().restarts, 2)
  stop()
})

test('failed native refresh is retried for the same accepted selection on the next notification', async () => {
  const f = fixture(), stop = f.start(); await settled()
  const restart = f.fiber.restart
  f.fiber.restart = async () => { throw new Error('native UI failed to reload') }
  f.change({ openspecSkills: true }); await settled()
  assert.equal(f.errors.length, 1)
  f.fiber.restart = restart
  f.change({ openspecSkills: true }); await settled()
  assert.equal(f.counts().restarts, 2)
  stop()
})

test('disposal during discovery or native restart stops late UI mutations', async () => {
  for (const boundary of ['read', 'restart']) {
    const f = fixture(), release = Promise.withResolvers<any>()
    if (boundary === 'read') f.api.readConfig = async () => release.promise
    else f.fiber.restart = async () => release.promise
    const stop = f.start(); await settled(); stop()
    release.resolve({ ok: true, value: { configuration: { pstackSkills: true } } }); await settled()
    assert.equal(f.counts().menus, 0, boundary)
    assert.deepEqual(f.errors, [])
    assert.equal(f.handlers.size, 0)
  }
})

test('connection reset rediscovers the settings namespace without resetting any conversation', async () => {
  const f = fixture(), stop = f.start(); await settled()
  f.newNamespace('new-profile-entry')
  f.handlers.get('connection/reset')!(); await settled()
  f.change({ pstackSkills: true }); await settled()
  assert.equal(f.counts().restarts, 2)
  stop()
})

test('a pre-reset settings read cannot filter notifications from the reconnected profile', async () => {
  const f = fixture(), stop = f.start(); await settled()
  const original = f.api.readConfig
  const oldRead = Promise.withResolvers<void>(), newRead = Promise.withResolvers<void>()
  let reads = 0
  f.api.readConfig = async () => {
    const response = await original()
    if (++reads === 1) await oldRead.promise
    else if (reads === 2) await newRead.promise
    return response
  }
  try {
    f.change({ openspecSkills: true }); await settled()
    f.newNamespace('reconnected-profile-entry')
    f.handlers.get('connection/reset')!()
    f.change({})
    oldRead.resolve(); await settled()
    assert.equal(reads, 2, 'the new profile read is in flight')
    f.change({ pstackSkills: true })
    newRead.resolve(); await settled()
    assert.equal(reads, 3, 'accepted changes during reconnection require a fresh read')
    assert.equal(f.counts().restarts, 2, 'the current profile selection must reach the native menu')
    f.change({ pstackSkills: true }); await settled()
    assert.equal(f.counts().restarts, 2, 'the settled selection is not restarted again')
    const before = f.counts().reads
    f.change({}, 'entry:super-code'); await settled()
    assert.equal(f.counts().reads, before, 'the retired namespace is ignored after reconnection')
    assert.deepEqual(f.errors, [])
    assert.deepEqual(f.draft, { text: '/poteto-mode 继续检查', revision: 7 })
  } finally {
    oldRead.resolve(); newRead.resolve(); stop()
  }
})
