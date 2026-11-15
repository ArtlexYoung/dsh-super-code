import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeTarget, scopeOf, bindScopeParent } from '@deepseek-ai/dsh-scope'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as presentation from '../../src/dsh/tool-presentation.js'
import superCode from '../../src/dsh/super-code.js'
import { installTaskMemory } from '../task-memory-fixture.js'

interface CapturedExecutor {
  describe(tools: { name: string }[]): { schemas: { name: string }[] }
  sections: { text(tools: { name: string }[]): string }[]
  execute(input: object): Promise<{ provider: string; input: object }>
}

async function fixture(t: test.TestContext, existing = false, modern = false) {
  const ctx = new Context(), root = await mkdtemp(join(tmpdir(), 'super-code-remote-'))
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  new SessionStore(ctx); await ctx.plugin(Projections)
  await installTaskMemory(ctx)
  // 运行真实旧版工具注册表；宿主展示插件的唯一行为是 presentAs。
  const directory = join(root, 'node_modules/@deepseek-ai/dsh-agent-tool-presentation')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  await writeFile(join(directory, 'index.js'), 'export const inject = ["tools"]; export function apply(ctx, config) { ctx.tools.presentAs(config.mode) }')
  let executor: CapturedExecutor
  const scopedExecutors = new Map<object | undefined, CapturedExecutor>()
  if (modern) {
    Object.defineProperty(ctx.get('tools'), 'setExecutor', { configurable: true,
      value: function (this: { ctx: Context }, value: CapturedExecutor) {
        const scope = scopeOf(this.ctx)
        scopedExecutors.set(scope, value)
        if (scope === scopeOf(preset.ctx)) executor = value
        return () => { scopedExecutors.delete(scope) }
      } })
    for (const [suffix, constructor] of [['native', 'NativeToolExecutor'], ['ptc', 'PtcExecutor']]) {
      const directory = join(root, 'node_modules/@deepseek-ai/dsh-tool-executor-' + suffix)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
      await writeFile(join(directory, 'index.js'), `export class ${constructor} {
        sections = ${suffix === 'ptc' ? '[{ name: "tools:sdk", order: 10, text: tools => tools.map(t => t.name).join(",") }]' : '[]'};
        describe(tools) { return { schemas: ${suffix === 'ptc' ? '[{ name: "run_code" }]' : 'tools'} } }
        async execute(input) { return { provider: ${JSON.stringify(suffix)}, input } }
      }`)
    }
  }
  ctx.provide('profileContext', { installAnchor: join(root, 'package.json') })
  ctx.provide('codeRuntime', { language: 'typescript' })
  const agents: Agent[] = []
  ctx.provide('agents', { list: () => agents })
  const preset = createScope(ctx, {})
  await preset.ctx.plugin(superCode)
  let localCalls = 0, remoteCalls = 0, disconnected = false, denied = false
  for (const name of ['bash', 'subagent', 'subagent_fork', 'terminal', 'job_list', 'read_file']) {
    preset.ctx.get('tools')!.register(defineTool({ name, description: name, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { if (name === 'bash') localCalls++; return name },
    }))
  }
  preset.ctx.get('systemPrompt')!.section({ name: 'tool:bash', order: 50, text: 'Local Bash guidance' })
  preset.ctx.get('systemPrompt')!.section({ name: 'super-code:windows-shell', order: 94, text: 'Windows local environment' })
  const make = (id: string, context = preset.ctx, cwd?: string) => {
    const agent = { id, session: ctx.get('sessions')!.create(SessionId(id), cwd === undefined ? {} : { meta: { cwd } }) } as Agent
    const scope = createScope(context, agent)
    bindScopeParent(agent, scopeOf(context))
    Object.assign(agent, { ctx: scope.ctx }); agents.push(agent)
    return agent
  }
  const bind = (agent: Agent) => agent.ctx.get('tools')!.register(defineTool({
    name: 'remote_bash', description: 'Remote Bash', parameters: { wait: { type: 'boolean' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      remoteCalls++
      if (args.wait) await new Promise<void>(resolve => exec.signal.addEventListener('abort', () => resolve(), { once: true }))
      return 'remote result'
    },
  }))
  const initial = existing ? make('existing') : undefined
  if (initial) bind(initial)
  const mounted = preset.ctx.plugin(presentation)
  await mounted
  const names = async (agent: Agent) => (await ctx.get('systemPrompt')!.assemble({ agent, scope: agent })).tools.map(tool => tool.name)
  const call = (agent: Agent, name: string, args = {}, signal = new AbortController().signal) => ctx.get('tools')!.execute({
    agent, name, arguments: args, callId: ToolCallId(crypto.randomUUID()), signal,
  })
  const guard = (agent: Agent) => agent.ctx.get('tools')!.guard(exec => {
    if (disconnected) return 'remote disconnected'
    if (denied && exec.name === 'remote_bash') return 'approval rejected'
    if (['run_code', 'bash', 'subagent'].includes(exec.name)) return 'use remote_bash'
  })
  return { ctx, preset, initial, make, bind, names, call, guard, mounted,
    executor: (agent?: Agent) => agent && scopedExecutors.get(agent) || executor,
    counts: () => ({ local: localCalls, remote: remoteCalls }),
    disconnect: (value: boolean) => { disconnected = value }, deny: (value: boolean) => { denied = value } }
}

test('late remote tool registration switches only that session and removal restores local PTC', async t => {
  const f = await fixture(t), local = f.make('local'), remote = f.make('remote')
  assert.deepEqual(await f.names(local), ['run_code'])
  assert.deepEqual(await f.names(remote), ['run_code'])
  const unbind = f.bind(remote)
  assert.ok((await f.names(remote)).includes('remote_bash'))
  for (const name of ['run_code', 'bash', 'terminal', 'subagent', 'subagent_fork', 'job_list']) assert.ok(!(await f.names(remote)).includes(name), name)
  assert.ok((await f.names(remote)).includes('read_file'))
  assert.deepEqual(await f.names(local), ['run_code'])
  const assembly = await f.ctx.get('systemPrompt')!.assemble({ agent: remote, scope: remote })
  assert.ok(assembly.sections.some(section => section.text.includes('lightweight remote project')))
  assert.ok(!assembly.sections.some(section => /Local Bash guidance|Windows local environment/.test(section.text)))
  unbind()
  assert.deepEqual(await f.names(remote), ['run_code'])
  f.bind(remote)
  assert.ok((await f.names(remote)).includes('remote_bash'))
})

test('Windows long working directories use native tools without changing other sessions or guards', async t => {
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32' })
  t.after(() => Object.defineProperty(process, 'platform', { value: platform }))
  const f = await fixture(t)
  for (const length of [258, 259, 260, 303, 510]) {
    const agent = f.make('path-' + length, f.preset.ctx, '/' + 'd'.repeat(length - 1))
    await f.ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'fresh' as never })
    if (length < 259) assert.deepEqual(await f.names(agent), ['run_code'])
    else {
      assert.ok((await f.names(agent)).includes('read_file'))
      assert.ok(!(await f.names(agent)).includes('run_code'))
      agent.ctx.get('tools')!.guard(exec => exec.name === 'read_file' ? 'read denied' : undefined)
      assert.equal((await f.call(agent, 'read_file')).isError, true)
      assert.equal((await f.call(agent, 'super_code_task', { action: 'list' })).isError, false)
    }
  }
  const other = f.make('other-preset', f.ctx, '/' + 'd'.repeat(300))
  await f.ctx.serial(scopeTarget(other, other), 'agent/created', { agent: other, source: 'fresh' as never })
  assert.ok((await f.names(other)).every(name => name !== 'run_code'))
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const linux = f.make('linux', f.preset.ctx, '/' + 'd'.repeat(300))
  await f.ctx.serial(scopeTarget(linux, linux), 'agent/created', { agent: linux, source: 'fresh' as never })
  assert.deepEqual(await f.names(linux), ['run_code'])
})

test('scoped host executors select native for Windows long cwd and still filter remote tools', async t => {
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32' })
  t.after(() => Object.defineProperty(process, 'platform', { value: platform }))
  const f = await fixture(t, false, true)
  const short = f.make('short-cwd', f.preset.ctx, '/short')
  const long = f.make('long-cwd', f.preset.ctx, '/' + 'd'.repeat(258))
  await f.ctx.serial(scopeTarget(long, long), 'agent/created', { agent: long, source: 'fresh' as never })
  assert.deepEqual(f.executor(short).describe([{ name: 'read_file' }]).schemas.map(x => x.name), ['run_code'])
  assert.deepEqual(f.executor(long).describe([{ name: 'read_file' }]).schemas.map(x => x.name), ['read_file'])
  f.bind(long)
  assert.deepEqual(f.executor(long).describe([{ name: 'read_file' }, { name: 'remote_bash' }, { name: 'bash' }]).schemas.map(x => x.name), ['read_file', 'remote_bash'])
  const input = { agent: long, calls: [], signal: new AbortController().signal }
  const result = await f.executor(long).execute(input)
  assert.equal(result.provider, 'native')
  assert.equal(result.input, input)
})

test('separate host executors keep programs and native batches unchanged and select from visible tools', async t => {
  const f = await fixture(t, false, true), local = f.make('local-modern'), remote = f.make('remote-modern')
  f.bind(remote)
  const executor = f.executor(), definitions = [{ name: 'remote_bash' }, { name: 'bash' }, { name: 'read_file' }]
  assert.deepEqual(executor.describe(definitions).schemas.map((tool: { name: string }) => tool.name), ['remote_bash', 'read_file'])
  assert.deepEqual(executor.describe(definitions.slice(1)).schemas.map((tool: { name: string }) => tool.name), ['run_code'])
  assert.equal(executor.sections[0].text(definitions), '')
  assert.match(executor.sections[0].text(definitions.slice(1)), /read_file/)
  for (const [agent, provider] of [[local, 'ptc'], [remote, 'native']] as const) {
    const input = { agent, calls: [{ name: provider === 'ptc' ? 'run_code' : 'remote_bash', arguments: '{"command":"literal"}' }], signal: new AbortController().signal }
    const result = await executor.execute(input)
    assert.equal(result.provider, provider)
    assert.equal(result.input, input, '参数、取消信号及宿主返回值不经转译')
  }
  // rc.3 的展示事件只包含文本，工具声明由执行器持有。
  const textOnly = { sections: [], contexts: [], variables: {} }
  const result = await f.ctx.waterfall(scopeTarget(remote, remote), 'system-prompt/assemble', textOnly as never,
    { agent: remote, scope: remote }, async () => textOnly as never)
  assert.equal('tools' in result, false)
})

test('existing remote sessions are selected at mount and another preset remains native', async t => {
  const f = await fixture(t, true)
  assert.ok((await f.names(f.initial!)).includes('remote_bash'))
  const other = f.make('standard', f.ctx)
  f.bind(other)
  assert.deepEqual(await f.names(other), ['remote_bash'])
  const agent = f.make('created')
  f.bind(agent)
  await f.ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'fresh' as never })
  assert.ok((await f.names(agent)).includes('remote_bash'))
})

test('native remote execution retains guards, disconnection and task/memory tools', async t => {
  const f = await fixture(t), agent = f.make('guarded')
  f.bind(agent); f.guard(agent)
  assert.equal((await f.call(agent, 'remote_bash')).isError, false)
  assert.equal((await f.call(agent, 'super_code_task', { action: 'list' })).isError, false)
  assert.equal((await f.call(agent, 'super_code_memory', { action: 'help', forAction: 'read' })).isError, false)
  assert.equal((await f.call(agent, 'bash')).isError, true)
  f.deny(true)
  assert.equal((await f.call(agent, 'remote_bash')).isError, true)
  f.deny(false); f.disconnect(true)
  assert.equal((await f.call(agent, 'remote_bash')).isError, true)
  assert.equal((await f.call(agent, 'read_file')).isError, true)
  assert.ok((await f.names(agent)).includes('remote_bash'), '断连不能恢复本机执行')
  assert.deepEqual(f.counts(), { local: 0, remote: 1 })
  f.disconnect(false)
  assert.equal((await f.call(agent, 'remote_bash')).isError, false)
})

test('cancellation reaches the remote body and unloading releases native overrides', async t => {
  const f = await fixture(t), agent = f.make('cancel')
  f.bind(agent); f.guard(agent)
  const abort = new AbortController()
  const pending = f.call(agent, 'remote_bash', { wait: true }, abort.signal)
  while (!f.counts().remote) await new Promise(resolve => setImmediate(resolve))
  abort.abort()
  assert.equal((await pending).isError, true)
  assert.deepEqual(f.counts(), { local: 0, remote: 1 })
  await f.mounted.dispose()
  assert.ok(!(await f.ctx.get('systemPrompt')!.assemble({ agent, scope: agent })).sections.some(section => section.name === 'super-code:remote-tools'))
  assert.ok((await f.names(agent)).includes('remote_bash'))
  assert.ok((await f.names(agent)).includes('bash'), '卸载恢复宿主默认展示')
})
