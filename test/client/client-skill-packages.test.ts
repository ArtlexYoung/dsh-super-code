import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// 夹具只提供宿主按名称或标签匹配有序子序列的约定。
function rankByName(items: any[], query: string) {
  const pattern = new RegExp([...query].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i')
  return items.filter(item => pattern.test(item.name) || item.label && pattern.test(item.label))
}

function fixture() {
  let plugin: any, skills: any[] = [], calls = 0, subagent = false
  runInNewContext(readFileSync(new URL('../../client/index.js', import.meta.url), 'utf8'), {
    AbortController,
    __ModuleLoader__: { load: ({ factory }: any) => {
      plugin = factory((id: string) => id === 'react' ? { forwardRef: () => 'button' }
        : id === '@deepseek-ai/dsh-client-ui-primitives' ? { rankByName } : {})
    } },
  })
  const session = { sessionId: 'session-a' }, abort = new AbortController()
  const api = { list: async (request: any, signal: AbortSignal): Promise<any> => {
    calls++; assert.equal(request.sessionId, session.sessionId); assert.equal(signal, abort.signal)
    return { ok: true, value: { skills } }
  } }
  const ctx = { remote: { skills: api }, sessions: { subagentAddress: () => subagent ? {} : undefined } }
  const source = plugin.skillPackageSource(ctx)
  return { source, api, session, abort, calls: () => calls,
    catalog: (next: any[]) => { skills = next }, subagent: () => { subagent = true },
    query: (query: string) => source.candidates(session, { query, signal: abort.signal }),
  }
}

function skill(name: string, relative: string, root = '/profile/skills/dsh-super-code/') {
  return { name, path: `${root}${relative}/SKILL.md`, description: `description:${name}`, modelInvocable: false }
}

test('package search discovers PStack workflows without duplicating native name matches', async () => {
  const f = fixture()
  f.catalog([skill('poteto-mode', 'pstack/dsh/skills/poteto-mode'), skill('setup-pstack', 'pstack/dsh/skills/setup-pstack')])
  const candidates = await f.query('pstack')
  assert.deepEqual(Array.from(candidates, (item: any) => item.name), ['poteto-mode'])
  assert.equal(candidates[0].description, 'description:poteto-mode')
  assert.equal(f.source.trigger, '/')
  assert.deepEqual({ ...f.source.onPick({ candidate: candidates[0] }) }, { text: '/poteto-mode ' })
  assert.deepEqual(Array.from(await f.query('poteto')), [], 'specific-name search stays with the native source')
})

test('all package entries use the resolved native catalog, including both grill-me entrypoints', async () => {
  const f = fixture()
  f.catalog([skill('grill-me', 'mattpocock/skills/grill-me'), skill('grilling', 'mattpocock/skills/grilling'),
    skill('implement', 'mattpocock/skills/implement'), skill('openspec-propose', 'openspec/skills/openspec-propose'),
    skill('oil-ui', 'oil-ui')])
  assert.deepEqual(Array.from(await f.query('mattpocock'), (item: any) => item.name), ['grill-me', 'grilling', 'implement'])
  assert.deepEqual(Array.from(await f.query('grill-me'), (item: any) => item.name), ['grilling'])
  for (const query of ['openspec', 'oil-ui']) assert.deepEqual(Array.from(await f.query(query)), [], 'native name matches are not duplicated')
  assert.deepEqual(Array.from(await f.query('')), [], 'the ordinary / menu stays unchanged')
  assert.deepEqual(Array.from(await f.query('unrelated')), [])
})

test('managed and bundled paths work on POSIX and Windows without claiming user overrides', async () => {
  const f = fixture()
  const win = skill('architect', 'pstack/dsh/skills/architect', 'C:/DSH 目录/skills/dsh-super-code/')
  win.path = win.path.replaceAll('/', '\\')
  f.catalog([win, skill('arena', 'pstack/dsh/skills/arena', '/plugin/builtin/skills/'),
    skill('review', 'pstack/dsh/skills/review', '/project/.dsh/skills/'),
    skill('tdd', 'mattpocock/skills/tdd'), skill('custom', 'pstack/dsh/skills/custom', '/project/not-builtin/skills/')])
  assert.deepEqual(Array.from(await f.query('PSTACK'), (item: any) => item.name), ['architect', 'arena'])
  assert.deepEqual(Array.from(await f.query('mattpocock'), (item: any) => item.name), ['tdd'])
})

test('switching the native catalog takes effect in an existing conversation without a second cache', async () => {
  const f = fixture()
  f.catalog([skill('poteto-mode', 'pstack/dsh/skills/poteto-mode')])
  assert.equal((await f.query('pstack')).length, 1)
  f.catalog([])
  assert.equal((await f.query('pstack')).length, 0)
  f.catalog([skill('poteto-mode', 'pstack/dsh/skills/poteto-mode', '/project/.dsh/skills/')])
  assert.equal((await f.query('pstack')).length, 0, 'a resolved project override is not relabelled as a bundled Skill')
})

test('cancelled and subagent menus do not fetch, and late responses are discarded', async () => {
  for (const kind of ['cancelled', 'subagent', 'empty', 'unrelated']) {
    const f = fixture()
    if (kind === 'cancelled') f.abort.abort()
    if (kind === 'subagent') f.subagent()
    assert.equal((await f.query(kind === 'empty' ? '' : kind === 'unrelated' ? 'xyz' : 'pstack')).length, 0)
    assert.equal(f.calls(), 0, kind)
  }
  const f = fixture(), response = Promise.withResolvers<any>()
  f.api.list = async () => response.promise
  const pending = f.query('pstack')
  f.abort.abort()
  response.resolve({ ok: true, value: { skills: [skill('poteto-mode', 'pstack/dsh/skills/poteto-mode')] } })
  assert.equal((await pending).length, 0)
})

test('catalog failures surface and a later attempt recovers', async () => {
  const f = fixture(), original = f.api.list
  f.api.list = async () => ({ ok: false, error: { code: 'unavailable' } })
  await assert.rejects(f.query('pstack'), /Skill catalog/)
  f.api.list = original
  f.catalog([skill('poteto-mode', 'pstack/dsh/skills/poteto-mode')])
  assert.equal((await f.query('pstack')).length, 1)
})

test('virtual native Skills without filesystem paths do not break package discovery', async () => {
  const f = fixture()
  f.catalog([{ name: 'virtual', description: 'native provider', modelInvocable: true },
    skill('poteto-mode', 'pstack/dsh/skills/poteto-mode')])
  assert.deepEqual(Array.from(await f.query('pstack'), (item: any) => item.name), ['poteto-mode'])
})
