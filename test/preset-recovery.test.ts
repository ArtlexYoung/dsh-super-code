import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import yaml from 'js-yaml'
import { RecoveryState, installRecovery } from '../src/dsh/preset-recovery-runtime.js'
import { prepareRecovery } from '../src/dsh/preset-recovery.js'
import { declarationSchema } from '../src/dsh/preset-declaration.js'

async function fixture(t: test.TestContext, forms = false) {
  const root = await mkdtemp(join(tmpdir(), 'super-code-recovery-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const config = { statePath: join(root, 'state.json'), packagePath: join(root, 'package.json') }
  const state = await RecoveryState.open(config.statePath)
  const records = new Map<string, { id: string; broken?: string; content: string }>([
    ['standard', { id: 'standard', content: 'official standard' }],
    ['renamed-code', { id: 'renamed-code', content: 'owned composition' }],
  ])
  const mounts: string[] = [], bound = new WeakMap<Context, string>()
  const registry = {
    async resolve(id = 'standard') { const preset = records.get(id); if (!preset) throw new Error('Missing ' + id); return preset },
    async list() { return [...records.values()] },
    async readDocument(id: string) { const row = records.get(id); if (!row) throw new Error('Missing'); return { agentPreset: id, content: row.content } },
    async mount(ctx: Context, id = 'standard') { const row = records.get(id); if (!row || row.broken) throw new Error('Unusable ' + id); mounts.push(id); bound.set(ctx, id); return row },
    composedPreset(ctx: Context) { return bound.get(ctx) },
  }
  ctx.provide('agentPresets', registry)
  ctx.provide('sessionProjections', { stateOf(session: Session) {
    let id = session.header.agentPreset
    for (const e of session.snapshotEvents()) if (e.type === 'agent-preset/selected') id = e.data.agentPreset
    return id
  } })
  ctx.provide('tools', { get: (_name: string, agent: Agent) => bound.has(agent.ctx) })
  let language = 'zh'
  ctx.provide('settings', forms ? { describe: () => [{ ns: 'locale', value: { preference: language } }] }
    : { get: () => ({ preference: language }) })
  const agent = (id = 'owned-session', preset = 'renamed-code') => {
    const who = { session: Session.create(SessionId(id), [], { version: SESSION_FORMAT_VERSION, id: SessionId(id),
      createdAt: Date.now(), isSeeded: false, agentPreset: preset, cwd: root }) } as Agent
    Object.assign(who, { ctx: createScope(ctx, who).ctx })
    bound.set(who.ctx, preset)
    return who
  }
  const owner = ctx.plugin({ apply() {} }).ctx
  const service = installRecovery(owner, state, config, { scopeOf, message: createUserMessage })
  return { ctx, root, config, state, registry, service, owner, agent, records, mounts, language: (value: string) => { language = value } }
}

test('cold uninstall continues an owned renamed session with standard, preserving history and one visible notice', async t => {
  const f = await fixture(t), agent = f.agent()
  agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '原始历史' }] }), { surfaceOp: 'append' })
  const before = agent.session.snapshotEvents()
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  assert.equal((await f.registry.resolve('renamed-code')).id, 'renamed-code')
  await f.registry.mount(agent.ctx, 'renamed-code')
  assert.deepEqual(f.mounts, ['standard'])
  assert.deepEqual(agent.session.snapshotEvents().slice(0, before.length), before)
  const events = agent.session.snapshotEvents(), notice = events.find(e => e.type === 'command/done')
  assert.match(JSON.stringify(notice), /Super Code 插件已卸载.*官方标准/)
  const run = events.find(e => e.type === 'command/run')!
  assert.equal(run.type, 'command/run')
  if (run.type === 'command/run' && notice?.type === 'command/done') {
    assert.deepEqual(run.data.source, { kind: 'dsh-super-code/preset-recovery' })
    assert.equal(run.data.commandId, notice.data.commandId)
    assert.equal(notice.data.kind, 'success')
  }
  assert.equal(events.at(-1)?.type, 'command/done')
  assert.equal(events.filter(e => e.type === 'user/message').length, 1, 'recovery adds no model-facing message')
  assert.equal(events.filter(e => e.type === 'turn/start').length, 0, 'recovery starts no model turn')
  assert.equal(f.ctx.sessionProjections.stateOf(agent.session, 'agentPreset'), 'standard')
  await f.registry.mount(agent.ctx, 'standard')
  assert.equal(agent.session.snapshotEvents().length, events.length)
  const reopened = await RecoveryState.open(f.config.statePath)
  assert.equal(reopened.value.sessions[agent.session.id]?.preset, 'renamed-code')
})

test('broken directory copies fall back only if their complete original composition matches', async t => {
  const f = await fixture(t), original = f.agent()
  await f.service.remember(original)
  f.records.get('renamed-code')!.broken = 'Removed plugin modules'
  await f.registry.mount(original.ctx, 'renamed-code')
  assert.deepEqual(f.mounts, ['standard'])
  const changed = f.agent('changed-session')
  await f.service.remember(changed)
  f.records.get('renamed-code')!.content = 'Unrelated replacement'
  await assert.rejects(f.registry.mount(changed.ctx, 'renamed-code'), /Unusable/)
  assert.equal(changed.session.seq, 1)
})

test('healthy replacement presets and installed plugin sessions retain their own composition', async t => {
  const f = await fixture(t), healthy = f.agent()
  await f.service.remember(healthy)
  await f.registry.mount(healthy.ctx, 'renamed-code')
  assert.deepEqual(f.mounts, ['renamed-code'])
  assert.equal(healthy.session.seq, 1)
  await writeFile(f.config.packagePath, '{}')
  f.records.delete('renamed-code')
  await assert.rejects(f.registry.resolve('renamed-code'), /Missing/)
  await assert.rejects(f.registry.mount(healthy.ctx, 'renamed-code'), /Unusable/)
  assert.equal(healthy.session.seq, 1)
})

test('live main plugin, unknown sessions, changed identities and unrelated missing presets never gain a fallback', async t => {
  const f = await fixture(t), owned = f.agent()
  await f.service.remember(owned)
  f.records.delete('renamed-code')
  const release = f.ctx.provide('superCodeConfiguration', {})
  await assert.rejects(f.registry.mount(owned.ctx, 'renamed-code'), /Unusable/)
  release()
  await assert.rejects(f.registry.resolve('unrelated'), /Missing/)
  const unrelated = f.agent('new-session')
  await assert.rejects(f.registry.mount(unrelated.ctx, 'renamed-code'), /Unusable/)
  f.state.value.sessions[owned.session.id]!.cwd = '/different'
  await assert.rejects(f.registry.mount(owned.ctx, 'renamed-code'), /Unusable/)
  assert.equal(owned.session.seq, 1)
  assert.equal(unrelated.session.seq, 1)
})

test('missing or broken official standard leaves the original history and selection untouched', async t => {
  const f = await fixture(t), agent = f.agent()
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  f.records.get('standard')!.broken = 'Unavailable standard tools'
  await assert.rejects(f.registry.mount(agent.ctx, 'renamed-code'), /Unusable standard/)
  f.records.delete('standard')
  await assert.rejects(f.registry.mount(agent.ctx, 'renamed-code'), /Unusable standard/)
  assert.equal(agent.session.seq, 1)
})

test('concurrent mounts append one paired result and one durable selection', async t => {
  const f = await fixture(t), agent = f.agent()
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  await Promise.all([f.registry.mount(agent.ctx, 'renamed-code'), f.registry.mount(agent.ctx, 'renamed-code')])
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter(e => e.type === 'command/run').length, 1)
  assert.equal(events.filter(e => e.type === 'command/done').length, 1)
  assert.equal(events.filter(e => e.type === 'user/message').length, 0)
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'agent-preset/selected').length, 1)
})

test('English recovery result is log-only and attributed to the plugin', async t => {
  const f = await fixture(t), agent = f.agent()
  f.language('en')
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  await f.registry.mount(agent.ctx, 'renamed-code')
  const event = agent.session.snapshotEvents().find(e => e.type === 'command/done')!
  assert.equal(event.type, 'command/done')
  assert.match(JSON.stringify(event), /official Standard preset/)
  assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'user/message' || e.type === 'assistant/message').length, 0)
})

test('new host settings forms select the notice language without the removed get API', async t => {
  const f = await fixture(t, true), agent = f.agent()
  f.language('en-US')
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  await f.registry.mount(agent.ctx, 'renamed-code')
  assert.match(JSON.stringify(agent.session.snapshotEvents()), /conversation will continue with the official Standard/)
})

test('a newly created same-name session cannot use another session recovery record', async t => {
  const f = await fixture(t), previous = f.agent()
  await f.service.remember(previous)
  f.records.delete('renamed-code')
  const fresh = f.agent('fresh-same-preset')
  assert.equal((await f.registry.resolve('renamed-code')).id, 'renamed-code')
  await assert.rejects(f.registry.mount(fresh.ctx, 'renamed-code'), /Unusable/)
  assert.equal(fresh.session.seq, 1)
})

test('changed session creation time cannot inherit recovery even with the same id and directory', async t => {
  const f = await fixture(t), previous = f.agent()
  await f.service.remember(previous)
  f.records.delete('renamed-code')
  f.state.value.sessions[previous.session.id]!.createdAt--
  await assert.rejects(f.registry.mount(previous.ctx, 'renamed-code'), /Unusable/)
  assert.equal(previous.session.seq, 1)
})

test('upgrading registers existing owned sessions without modifying their event log', async t => {
  const f = await fixture(t), agent = f.agent(), unrelated = f.agent('unrelated', 'standard')
  f.ctx.provide('sessionQuery', { listSessions: async () => [{ header: agent.session.header }, { header: unrelated.session.header }],
    readSession: async (id: string) => { const who = id === agent.session.id ? agent : unrelated; return { session: who.session.header, events: who.session.snapshotEvents() } } })
  await f.service.backfill(['renamed-code'])
  assert.equal(f.state.value.sessions[agent.session.id]?.preset, 'renamed-code')
  assert.equal(f.state.value.sessions[unrelated.session.id], undefined)
  assert.equal(agent.session.seq, 1)
})

test('upgrade registration uses the latest selection and continues past an unreadable history', async t => {
  const f = await fixture(t), switched = f.agent('switched', 'standard'), official = f.agent('official', 'renamed-code')
  switched.session.append('agent-preset/selected', { agentPreset: 'renamed-code' })
  official.session.append('agent-preset/selected', { agentPreset: 'standard' })
  const unreadable = f.agent('unreadable'), sessions = [unreadable, switched, official]
  f.ctx.provide('sessionQuery', {
    listSessions: async () => sessions.map(who => ({ header: who.session.header })),
    readSession: async (id: string) => {
      if (id === unreadable.session.id) throw new Error('Corrupt history')
      const who = sessions.find(who => who.session.id === id)!
      return { session: who.session.header, events: who.session.snapshotEvents() }
    },
  })
  const before = sessions.map(who => who.session.snapshotEvents())
  await f.service.backfill(['renamed-code'])
  assert.deepEqual(Object.keys(f.state.value.sessions), ['switched'])
  assert.deepEqual(sessions.map(who => who.session.snapshotEvents()), before)
})

test('upgrade refreshes an existing recovery record after selecting another owned preset without running it', async t => {
  const f = await fixture(t), agent = f.agent()
  await f.service.remember(agent)
  f.records.set('another-code', { id: 'another-code', content: 'another owned composition' })
  agent.session.append('agent-preset/selected', { agentPreset: 'another-code' })
  const before = agent.session.snapshotEvents()
  f.ctx.provide('sessionQuery', { listSessions: async () => [{ header: agent.session.header }],
    readSession: async () => ({ session: agent.session.header, events: agent.session.snapshotEvents() }) })
  await f.service.backfill(['renamed-code', 'another-code'])
  assert.equal(f.state.value.sessions[agent.session.id]?.preset, 'another-code')
  assert.deepEqual(agent.session.snapshotEvents(), before)
  f.records.delete('another-code')
  await f.registry.mount(agent.ctx, 'another-code')
  assert.deepEqual(f.mounts, ['standard'])
})

test('recovery wrapper disposal restores original descriptors', async t => {
  const f = await fixture(t), agent = f.agent()
  await f.service.remember(agent)
  f.records.delete('renamed-code')
  await f.owner.fiber.dispose()
  await assert.rejects(f.registry.resolve('renamed-code'), /Missing/)
})

test('profile recovery is independent of the removed package, idempotent and preserves YAML expressions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-prepare-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'cordis.patch.yml'), original = '# existing setting\n- id: existing\n  config:\n    value: !!js process.platform\n'
  await writeFile(path, original)
  const first = await prepareRecovery(path, join(root, 'package.json'), 'export const name = "fixture";')
  assert.equal(await readFile(first.modulePath, 'utf8'), 'export const name = "fixture";')
  const patch = await readFile(path, 'utf8')
  assert.ok(patch.startsWith(original))
  assert.equal((yaml.load(patch, { schema: declarationSchema }) as any[]).length, 2)
  await prepareRecovery(path, join(root, 'package.json'), 'export const name = "fixture";')
  assert.equal(await readFile(path, 'utf8'), patch)
  await prepareRecovery(path, join(root, 'package.json'), 'export const name = "updated";')
  const entries = yaml.load(await readFile(path, 'utf8'), { schema: declarationSchema }) as any[]
  assert.equal(entries.at(-1).id, 'super-code-session-recovery')
  const backups = (await readdir(dirname(first.modulePath))).filter(name => name.startsWith('patch-before-'))
  assert.equal(backups.length, 2)
})

test('corrupt, foreign or symlinked recovery state and conflicting profile entries fail closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'super-code-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'state.json')
  await writeFile(path, '{invalid')
  await assert.rejects(RecoveryState.open(path))
  await writeFile(path, JSON.stringify({ plugin: 'other', format: 1, sessions: {} }))
  await assert.rejects(RecoveryState.open(path), /Invalid/)
  const link = join(root, 'linked.json')
  await symlink(path, link)
  await assert.rejects(RecoveryState.open(link), /Unsafe/)
  const patch = join(root, 'cordis.patch.yml'), original = '- insert:\n  - id: super-code-session-recovery\n    name: another-plugin\n'
  await writeFile(patch, original)
  await assert.rejects(prepareRecovery(patch, join(root, 'package.json'), 'export const name = "fixture";'), /conflict/)
  assert.equal(await readFile(patch, 'utf8'), original)
})

test('serialized concurrent session records survive a cold read', async t => {
  const f = await fixture(t), a = f.agent('first'), b = f.agent('second')
  await Promise.all([f.service.remember(a), f.service.remember(b)])
  const restored = await RecoveryState.open(f.config.statePath)
  assert.deepEqual(Object.keys(restored.value.sessions).sort(), ['first', 'second'])
})

test('uninstalled recovery revokes official minimal rules before downstream hooks and respects live installations', async t => {
  const f = await fixture(t), agent = f.agent('minimal-history', 'minimal')
  const removeConfig = f.ctx.provide('superCodeConfiguration', { get: () => ({}), forAgent: () => ({}) })
  const original = agent.session.append('user/message', createUserMessage({ source: { kind: 'dsh-super-code/deletion-protection' },
    content: [{ type: 'text', text: 'Use trash for deletions. ORIGINAL_POLICY' }] }), { surfaceOp: 'append' })
  let downstream = ''
  f.ctx.on('agent/pre-step', async ({ agent }, next) => { downstream = JSON.stringify(agent.session.deriveMessages()); return next() })
  const step = (signal = new AbortController().signal) => f.ctx.waterfall(scopeTarget({}, agent), 'agent/pre-step',
    { agent, messages: [], turn: 1, step: 1, signal } as any, async () => ({ kind: 'enter' as const, messages: [] }))
  await writeFile(f.config.packagePath, '{}')
  await step()
  assert.match(downstream, /ORIGINAL_POLICY/)
  await rm(f.config.packagePath)
  await step()
  assert.match(downstream, /ORIGINAL_POLICY/, 'a live policy owner survives a transient package replacement')
  await removeConfig()
  const signal = AbortSignal.abort()
  await assert.rejects(step(signal))
  assert.equal(agent.session.seq, original.seq + 1, 'aborted recovery writes nothing')
  await step()
  assert.doesNotMatch(downstream, /ORIGINAL_POLICY/)
  assert.match(downstream, /have been revoked/)
  assert.deepEqual(agent.session.eventAt(original.seq), original)
  const size = agent.session.seq
  await step()
  assert.equal(agent.session.seq, size)
  const reenabled = f.ctx.provide('superCodeConfiguration', { get: () => ({}), forAgent: () => ({}) })
  agent.session.append('user/message', createUserMessage({ source: { kind: 'dsh-super-code/deletion-protection' },
    content: [{ type: 'text', text: 'REENABLED_PLUGIN_CURRENT_RULE' }] }), { surfaceOp: 'append' })
  await step()
  assert.match(downstream, /REENABLED_PLUGIN_CURRENT_RULE/)
  await reenabled()
  await step()
  assert.doesNotMatch(downstream, /REENABLED_PLUGIN_CURRENT_RULE/)
})

test('disabling the host plugin revokes minimal rules while its package is still installed', async t => {
  const f = await fixture(t), agent = f.agent('disabled-minimal', 'minimal')
  await writeFile(f.config.packagePath, '{}')
  const removeConfig = f.ctx.provide('superCodeConfiguration', { get: () => ({}), forAgent: () => ({}) })
  const original = agent.session.append('user/message', createUserMessage({ source: { kind: 'dsh-super-code/deletion-protection' },
    content: [{ type: 'text', text: 'DISABLED_PLUGIN_OLD_RULE' }] }), { surfaceOp: 'append' })
  let downstream = ''
  f.ctx.on('agent/pre-step', async ({ agent }, next) => { downstream = JSON.stringify(agent.session.deriveMessages()); return next() })
  const step = () => f.ctx.waterfall(scopeTarget({}, agent), 'agent/pre-step',
    { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal } as any,
    async () => ({ kind: 'enter' as const, messages: [] }))
  await step()
  assert.match(downstream, /DISABLED_PLUGIN_OLD_RULE/)
  await removeConfig()
  await step()
  assert.doesNotMatch(downstream, /DISABLED_PLUGIN_OLD_RULE/)
  assert.match(downstream, /have been revoked/)
  assert.deepEqual(agent.session.eventAt(original.seq), original)
  assert.equal(await readFile(f.config.packagePath, 'utf8'), '{}', 'the package remains installed')
  const size = agent.session.seq
  await step()
  assert.equal(agent.session.seq, size)
})
