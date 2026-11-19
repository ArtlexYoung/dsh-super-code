import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import { waitFor } from '../wait-for.js'

function fixture() {
  const ctx = new Context(), settings = new Set<string>(), sources = new Set<any>(), warnings: unknown[] = []
  const scope = {}, skillUi = { apply: () => { starts++ } }
  let plugin: any, starts = 0, menus = 0
  runInNewContext(readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8'), {
    AbortController,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory((name: string) => {
      if (name === 'react') return { forwardRef: () => 'button' }
      if (name === '@deepseek-ai/dsh-client-ui-skill') return skillUi
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        rankByName: (items: { name: string }[], query: string) => items.filter(item => item.name.includes(query)),
      }
      return {}
    }) } },
  })
  class Slots extends Service {
    constructor(owner: Context) { super(owner, 'slots') }
    inject(_name: string, register: () => any) { this.ctx.effect(register) }
    register(config: { name: string; id: string }) {
      const key = config.name + ':' + config.id
      settings.add(key)
      return () => { settings.delete(key) }
    }
  }
  new Slots(ctx)
  const provide = (owner: Context, name: string, value: object) => owner.provide(name as never, value as never)
  const budgets = { readConfig: async () => ({ ok: true, value: { namespace: 'skill-test', configuration: {} } }) }
  const skills = { list: async () => ({ ok: true, value: { skills: [
    { name: 'opsx-propose', description: 'proposal', path: '/workspace/builtin/skills/openspec/skills/opsx-propose/SKILL.md' },
  ] } }) }
  provide(ctx, 'locale', { register: () => () => {}, bind: () => (key: string) => key })
  provide(ctx, 'remote', { superCodeBudgets: budgets, skills, $mount: async () => {}, $on: () => () => {} })
  provide(ctx, 'remote.superCodeBudgets', budgets)
  provide(ctx, 'remote.skills', skills)
  provide(ctx, 'inputTriggers', {
    sessionOf: (value: unknown) => {
      assert.equal(value, scope)
      return { refreshOpenMenu: () => { menus++ } }
    },
    registerSource: (source: unknown) => { sources.add(source); return () => { sources.delete(source) } },
  })
  const mountSessions = () => ctx.plugin({ apply(owner: Context) {
    provide(owner, 'sessions', {
      list: { getSnapshot: () => ({ byId: { live: {} } }) },
      scope: () => scope,
      subagentAddress: () => undefined,
    })
  } })
  return { ctx, plugin, skillUi, mountSessions, settings, sources, warnings, counts: () => ({ starts, menus }) }
}

test('native Skill refresh and package search use the injected session service', async t => {
  const f = fixture()
  t.after(() => f.ctx.fiber.dispose())
  await f.ctx.plugin(f.skillUi)
  await f.mountSessions()
  await f.ctx.plugin(f.plugin)
  await waitFor(() => f.counts().menus === 1 || f.warnings.length > 0)
  assert.deepEqual(f.warnings, [])
  assert.deepEqual(f.counts(), { starts: 2, menus: 1 })
  assert.equal(f.sources.size, 1)
  const result = await [...f.sources][0].candidates({ sessionId: 'live' }, { query: 'openspec', signal: new AbortController().signal })
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'opsx-propose')
  assert.ok(f.settings.has('settings.section:super-code'))
})

test('missing and reloaded sessions isolate Skill lifetimes from settings', async t => {
  const f = fixture()
  t.after(() => f.ctx.fiber.dispose())
  await f.ctx.plugin(f.skillUi)
  await f.ctx.plugin(f.plugin)
  assert.ok(f.settings.has('settings.section:super-code'))
  assert.equal(f.sources.size, 0)
  assert.deepEqual(f.counts(), { starts: 1, menus: 0 })
  const sessions = f.mountSessions()
  await sessions
  await waitFor(() => f.counts().menus === 1)
  assert.equal(f.sources.size, 1)
  await sessions.dispose()
  assert.equal(f.sources.size, 0)
  assert.ok(f.settings.has('settings.section:super-code'))
  await f.mountSessions()
  await waitFor(() => f.counts().menus === 2)
  assert.equal(f.sources.size, 1)
  assert.deepEqual(f.warnings, [])
})
