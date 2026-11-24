import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { createScope, bindScopeParent, scopeTarget, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as runtime from '../../src/dsh/tool-runtime.js'
import { builtinToolProfiles } from '../../src/dsh/tool-profiles.js'
import { toolAllowed } from '../../src/dsh/tool-access.js'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

test('tool profiles inherit published child ownership before first-step tool admission', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-tool-ownership-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(directory + '/').href
  for (const module of ['dsh-agent-tool-presentation', 'dsh-tool-bash']) {
    const location = join(directory, 'node_modules', '@deepseek-ai', module)
    await mkdir(location, { recursive: true })
    await writeFile(join(location, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
    await writeFile(join(location, 'index.js'), 'export function apply() {}')
  }
  class Tools extends Service {
    constructor(ctx: Context) { super(ctx, 'tools') }
    register() { return () => {} }
    schemas() { return [] } get() {} guard() {} restrict() {} execute() {} presentAs() { return () => {} }
  }
  new Tools(ctx)
  ctx.provide('systemPrompt', { section() {} } as any)
  ctx.provide('shell', {} as any)
  let current = builtinToolProfiles.find(profile => profile.id === 'builtin:standard')!, status: () => { sessionId: string; profileId: string }[]
  ctx.provide('superCodeTools', { profile: () => current,
    attach: (observer: { status: typeof status }) => { status = observer.status; return () => {} }, watch: () => () => {},
  } as any)
  const agents: Agent[] = [], active = new Set<Agent>()
  ctx.provide('agents', { list: () => agents } as any)
  let failure: Error | undefined
  let parent: Agent
  const pending = Object.assign(new Error('ownership pending'), { code: 'UNAUTHORIZED' })
  ctx.provide('subagents', { rootOf(agent: Agent) {
    if (failure) throw failure
    if (!active.has(agent)) throw pending
    return parent
  }, namesOf(agent: Agent) { return { self: String(agent.id), parent: agent === parent ? undefined : String(parent.id) } } } as any)
  const generation = {}, preset = createScope(ctx, generation)
  await preset.ctx.plugin(runtime)
  const make = (id: string) => {
    const agent = { id, whenIdle: async () => {} } as unknown as Agent
    const scope = createScope(preset.ctx, agent)
    bindScopeParent(agent, generation); Object.assign(agent, { ctx: scope.ctx }); agents.push(agent)
    return agent
  }
  const created = (agent: Agent) => ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'fresh' } as any)
  const step = (agent: Agent) => ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', { agent } as any, async () => 'step')
  parent = make('parent'); active.add(parent); await created(parent)
  current = builtinToolProfiles.find(profile => profile.id === 'builtin:minimal')!
  const child = make('child'); await created(child)
  assert(!status!().some(item => item.sessionId === 'child'))
  await assert.rejects(step(child), error => error instanceof Error && error.cause === pending)
  active.add(child)
  ctx.emit(scopeTarget(parent, parent), 'subagent/start' as never, { id: child.id, local: true } as never)
  assert.equal(toolAllowed(preset.ctx, child, 'bash'), true, 'the host resolves the first tool set before pre-step')
  assert.equal(toolAllowed(preset.ctx, child, 'workflow'), true, 'inherit Standard from the parent, not the new Minimal default')
  await step(child)
  assert.equal(status!().find(item => item.sessionId === 'child')!.profileId, 'builtin:standard')
  failure = Object.assign(new Error('ownership storage failed'), { code: 'EIO' })
  await assert.rejects(created(make('broken')), error => error === failure)
})

test('tool profile prompts describe effective remote execution and retain only local persistent shell guidance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'super-code-tool-prompts-')), ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(directory + '/').href
  const location = join(directory, 'node_modules/@deepseek-ai/dsh-agent-tool-presentation')
  await mkdir(location, { recursive: true })
  await writeFile(join(location, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  await writeFile(join(location, 'index.js'), 'export function apply() {}')
  const renderer = join(directory, 'node_modules/@deepseek-ai/dsh-tools')
  await mkdir(renderer, { recursive: true })
  await writeFile(join(renderer, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  await writeFile(join(renderer, 'index.js'), 'export const renderToolsSdk = () => ""')
  class Tools extends Service {
    constructor(ctx: Context) { super(ctx, 'tools') }
    register() { return () => {} }
    schemas() { return [] }
    get(name: string, agent?: Agent) { return name === 'remote_bash' && String(agent?.id).startsWith('remote') ? { name } : undefined }
    guard() {} restrict() {} execute() {} presentAs() { return () => {} }
  }
  new Tools(ctx)
  await ctx.plugin(SystemPrompt)
  let current = builtinToolProfiles.find(profile => profile.id === 'builtin:super-code')!
  ctx.provide('superCodeTools', { profile: () => current, attach: () => () => {}, watch: () => () => {} } as never)
  ctx.provide('agents', { list: () => [] } as never)
  const preset = createScope(ctx, {})
  await preset.ctx.plugin(runtime)
  const make = (id: string) => {
    const agent = { id, session: { header: { cwd: '/project' } } } as unknown as Agent
    const scope = createScope(preset.ctx, agent)
    bindScopeParent(agent, scopeOf(preset.ctx)); Object.assign(agent, { ctx: scope.ctx })
    return agent
  }
  const remote = make('remote-prompts'), local = make('local-prompts')
  const prompt = async (agent: Agent) => (await ctx.get('systemPrompt')!.assemble({ agent, scope: agent })).sections
    .find(section => section.name === 'super-code:tool-profile')!.text
  assert.match(await prompt(remote), /uses native execution/)
  assert.doesNotMatch(await prompt(remote), /persistent shell|Shell state persists/)
  assert.match(await prompt(local), /uses ptc execution/)
  current = builtinToolProfiles.find(profile => profile.id === 'builtin:minimal')!
  assert.doesNotMatch(await prompt(remote), /persistent shell|Shell state persists/)
  assert.match(await prompt(local), /Shell state persists/)
})
