import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeTarget, scopeParentOf, scopeOf, bindScopeParent } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { applyBudgetSettings } from '../../src/dsh/budget-settings.js'
import * as shell from '../../src/dsh/windows-shell.js'
import { applyOfficialWindowsShell } from '../../src/dsh/official-windows-shell.js'

test('Windows confinement refuses Bash before execution and accepts only the host-approved invocation mode', () => {
  class Provider {
    readonly config = {}
    readonly sandboxMode = 'workspace-write'
    resolve(spec: { command: string; sandboxPolicy?: { mode: string } }) { return spec }
    argv(spec: { command: string }) { return ['original-pwsh', spec.command] }
  }
  const runtime = { root: 'C:\\Runtime', bin: 'C:\\Runtime\\usr\\bin', bash: 'C:\\Runtime\\usr\\bin\\bash.exe', version: 'test', arch: 'x64' }
  let reads = 0
  const Bundled = shell.bundledBashProvider(Provider, () => { reads++; return runtime })
  const provider = new Bundled(new Context(), {}), command = 'printf x >> "审批 文件.txt"'
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    for (const mode of ['read-only', 'workspace-write']) {
      assert.throws(() => provider.resolve({ command, sandboxPolicy: { mode } }), /SUPER_CODE_BASH_SANDBOX.*not executed.*exact same command.*sandbox_permissions="danger-full-access"/)
    }
    assert.equal(reads, 0, 'refusal never resolves the executable or its environment')
    const approved = provider.resolve({ command, sandboxPolicy: { mode: 'danger-full-access' } })
    assert.equal(approved.sandboxPolicy?.mode, 'danger-full-access')
    assert.deepEqual(provider.argv(approved), [runtime.bash, '--noprofile', '--norc', '-c', command])
    assert.throws(() => provider.resolve({ command }), /SUPER_CODE_BASH_SANDBOX/, 'an approved invocation does not grant the next one')
    assert.deepEqual(new Provider().argv({ command }), ['original-pwsh', command])
  } finally { Object.defineProperty(process, 'platform', { value: platform }) }
})

/** Fake host executors avoid platform binaries; the real scope, tool and prompt engines run. */
async function fixture(t: test.TestContext, options: { platform?: NodeJS.Platform; customProvider?: boolean; preparationGate?: Promise<void>; profileContext?: boolean; official?: string; brokenTool?: boolean; sharedGeneration?: boolean } = {}) {
  const ctx = new Context(), root = await mkdtemp(join(tmpdir(), 'super-code-shell-test-'))
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const require = createRequire(import.meta.url)
  const url = (name: string) => pathToFileURL(require.resolve(name)).href
  const module = async (name: string, source: string) => {
    const directory = join(root, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
    await writeFile(join(directory, 'index.js'), source)
    return pathToFileURL(join(directory, 'index.js')).href
  }
  const base = await module('@deepseek-ai/dsh-pwsh-local', `
    export default class Provider {
      constructor(ctx, config) { this.config = config; ctx.provide('shell', this) }
      resolve(spec) { return { workdir: 'host-default', ...spec } }
      argv(spec) { return ['host-pwsh', spec.command] }
    }`)
  await module('@deepseek-ai/dsh-scope', `export * from ${JSON.stringify(url('@deepseek-ai/dsh-scope'))}`)
  for (const name of ['bash', 'pwsh']) await module('@deepseek-ai/dsh-tool-' + name, `
    import { defineTool } from ${JSON.stringify(url('@deepseek-ai/dsh-tools'))}
    export const inject = ['tools', 'systemPrompt', 'shell']
    export function apply(ctx) {
      if (${options.brokenTool && name === 'bash' ? 'true' : 'false'}) throw new Error('Fixture Bash tool registration failed')
      ctx.systemPrompt.section({ name: 'tool:${name}', order: 10, text: '${name} host instructions' })
      ctx.tools.register(defineTool({ name: '${name}', description: 'Fixture executor without subprocesses',
        parameters: { command: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(args) { return ctx.shell.argv(ctx.shell.resolve(args)).join('|') }
      }))
    }`)
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  const { default: Provider } = await import(base)
  if (options.customProvider) ctx.provide('shell', { config: {}, resolve: (request: unknown) => request,
    argv: (spec: { command: string }) => ['custom-shell', spec.command] })
  else new Provider(ctx, {})
  const policy = { windowsBash: true, windowsBashForOfficialPresets: false }
  applyBudgetSettings(ctx, policy)
  let preparations = 0, broken = false
  const started = Promise.withResolvers<void>()
  ctx.provide('superCodeShell', {
    status: () => ({ platform: 'win32', state: 'pending' as const }),
    prepare: async () => {
      preparations++
      started.resolve()
      await options.preparationGate
      if (broken) throw new Error('Fixture payload unavailable')
      return { root, bin: root, bash: 'verified-bash.exe', version: 'fixture', arch: 'x64' }
    },
  })
  if (options.profileContext === false) ctx.baseUrl = pathToFileURL(root + '/').href
  else ctx.provide('profileContext', { installAnchor: join(root, 'package.json') })
  const generation = {}, preset = createScope(ctx, generation)
  const pwshUrl = pathToFileURL(join(root, 'node_modules/@deepseek-ai/dsh-tool-pwsh/index.js')).href
  let stopOfficial = async () => {}, stopShell = async () => {}
  const ids = new WeakMap<object, string>([[generation, options.official ?? 'super-code']])
  const creators = new Map<Agent, Agent | undefined>()
  if (options.official) {
    ctx.provide('agentPresets', { composedPreset(context: Context) {
      const key = scopeParentOf(scopeOf(context)!)
      return key && ids.get(key)
    } })
  }
  if (options.official || options.sharedGeneration) ctx.provide('agents', { list: () => [...creators.keys()], isOwnedBy: (id: string, parent: Agent) =>
    [...creators].some(([agent, creator]) => agent.id === id && creator === parent) })
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: options.platform ?? 'win32' })
  try {
    if (options.official) {
      await preset.ctx.plugin(await import(pwshUrl))
      const feature = ctx.plugin({ apply: applyOfficialWindowsShell })
      const owner = await feature
      stopOfficial = async () => { await feature.dispose() }
      // The wrapper can finish before its injected plugin's dynamic imports.
      for (const runtime of ctx.registry.values()) {
        for (const child of runtime.fibers) if (child.parent.fiber === owner) await child.await()
      }
    } else {
      const feature = preset.ctx.plugin(shell)
      await feature
      stopShell = async () => { await feature.dispose() }
    }
  }
  finally { Object.defineProperty(process, 'platform', { value: platform }) }
  const make = (id: string, parent?: Agent, deny?: string[]) => {
    const agent = { id, session: Session.create(SessionId(id)) } as unknown as Agent
    const scope = createScope(parent?.ctx ?? preset.ctx, agent)
    const binding = bindScopeParent(agent, options.official || options.sharedGeneration ? generation : parent ?? generation)
    Object.assign(agent, { ctx: scope.ctx })
    creators.set(agent, parent)
    scope.ctx.effect(() => () => { creators.delete(agent) })
    if (deny) scope.ctx.get('tools')!.restrict({ deny })
    return { agent, scope, binding,
      ready: () => ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'fresh' as never }),
      step: () => ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', {
        agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
      } as any, async () => ({ kind: 'enter' as const, messages: [] })),
    }
  }
  const names = (agent: Agent) => ctx.systemPrompt.assemble({ agent, scope: agent }).then(value => value.tools.map(tool => tool.name))
  const prompt = (agent: Agent) => ctx.systemPrompt.assemble({ agent, scope: agent }).then(value => value.sections.map(section => section.text).join('\n'))
  const call = (agent: Agent, name: string) => ctx.tools.execute({ name, arguments: { command: 'literal command' },
    callId: ToolCallId('shell-fixture-' + crypto.randomUUID()), agent, signal: new AbortController().signal })
  const anotherPreset = async (id: string) => {
    const key = {}, next = createScope(ctx, key)
    ids.set(key, id)
    await next.ctx.plugin(await import(pwshUrl))
    return key
  }
  return { ctx, policy, make, names, prompt, call, generation, anotherPreset, stopOfficial, stopShell, started: started.promise,
    preparations: () => preparations, broken(value: boolean) { broken = value } }
}

test('pending parent preparation is shared by duplicate events and children without changing their capability filters', async t => {
  const gate = Promise.withResolvers<void>(), f = await fixture(t, { preparationGate: gate.promise })
  const parent = f.make('pending-parent'), parentReady = parent.ready()
  await f.started
  f.policy.windowsBash = false
  const child = f.make('pending-child', parent.agent), denied = f.make('pending-denied', parent.agent, ['bash'])
  const waiting = [parentReady, parent.ready(), parent.step(), child.ready(), child.step(), denied.ready()]
  let completed = 0
  for (const promise of waiting) void promise.then(() => { completed++ })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(f.preparations(), 1)
    assert.equal(completed, 0, 'all lifecycle events must wait for the same preparation')
    assert.equal((await f.call(child.agent, 'bash')).isError, true, 'no executable is available while preparation is pending')
    assert.equal((await f.call(child.agent, 'pwsh')).isError, true)
  } finally { gate.resolve() }
  await Promise.all(waiting)
  assert.equal(f.preparations(), 1)
  assert.deepEqual((await f.names(child.agent)).filter(name => ['bash', 'pwsh'].includes(name)), ['bash'])
  assert.equal((await f.call(child.agent, 'bash')).isError, false)
  assert.equal((await f.call(denied.agent, 'bash')).isError, true)
  const next = f.make('new-disabled-root')
  await next.ready()
  assert.equal((await f.call(next.agent, 'pwsh')).isError, false)
  assert.equal(f.preparations(), 1)
})

test('official presets opt in independently, freeze each conversation and preserve child capability restrictions', async t => {
  for (const official of ['standard', 'ptc', 'cordis']) {
    const f = await fixture(t, { official }), first = f.make(official + '-default')
    await first.ready()
    assert.equal(f.preparations(), 0)
    assert.deepEqual(await f.names(first.agent), ['pwsh'])
    f.policy.windowsBashForOfficialPresets = true
    const enabled = f.make(official + '-on')
    await enabled.ready()
    assert.deepEqual(await f.names(enabled.agent), ['bash'])
    assert.match(JSON.stringify(await f.call(enabled.agent, 'bash')), /verified-bash.exe/)
    assert.match(await f.prompt(enabled.agent), /Windows with GNU Bash/)
    assert.doesNotMatch(await f.prompt(enabled.agent), /pwsh host instructions/)
    assert.deepEqual(await f.names(first.agent), ['pwsh'])
    f.policy.windowsBashForOfficialPresets = false
    const child = f.make(official + '-child', enabled.agent, ['bash'])
    await child.ready()
    assert.deepEqual(await f.names(child.agent), [])
    assert.equal((await f.call(child.agent, 'bash')).isError, true)
    assert.equal((await f.call(child.agent, 'pwsh')).isError, true)
    const host = f.make(official + '-off')
    await host.ready()
    assert.deepEqual(await f.names(host.agent), ['pwsh'])
    assert.doesNotMatch(await f.prompt(host.agent), /Windows with GNU Bash|bash host instructions/)
    assert.equal(f.ctx.tools.get('bash'), undefined)
    await enabled.scope.dispose()
    assert.deepEqual(await f.names(host.agent), ['pwsh'], 'a sibling survives another Agent closing')
    f.policy.windowsBashForOfficialPresets = true; f.policy.windowsBash = false
    const masterOff = f.make(official + '-master-off')
    await masterOff.ready()
    assert.deepEqual(await f.names(masterOff.agent), ['pwsh'])
  }
})

test('official shell excludes custom, Minimal and non-Windows and restores filters on blank preset changes', async t => {
  for (const official of ['minimal', 'custom']) {
    const f = await fixture(t, { official }); f.policy.windowsBashForOfficialPresets = true
    const item = f.make(official)
    await item.ready()
    assert.deepEqual(await f.names(item.agent), ['pwsh'])
    assert.equal(f.preparations(), 0)
    assert.equal(f.ctx.tools.get('bash', f.generation), undefined)
  }
  for (const platform of ['darwin', 'linux'] as const) {
    const f = await fixture(t, { official: 'standard', platform }); f.policy.windowsBashForOfficialPresets = true
    await f.make(platform).ready()
    assert.equal(f.preparations(), 0)
    assert.equal(f.ctx.tools.get('bash', f.generation), undefined)
  }
  const f = await fixture(t, { official: 'standard' }); f.policy.windowsBashForOfficialPresets = true
  const item = f.make('blank-switch')
  await item.ready()
  const other = await f.anotherPreset('custom')
  item.binding.rebind(other); await item.step()
  assert.deepEqual(await f.names(item.agent), ['pwsh'], 'the old deny-pwsh restriction is removed')
  item.binding.rebind(f.generation); await item.step()
  assert.deepEqual(await f.names(item.agent), ['bash'])
})

test('official generation teardown, simultaneous creation and failed runtime recovery remain isolated', async t => {
  const gate = Promise.withResolvers<void>(), f = await fixture(t, { official: 'standard', preparationGate: gate.promise })
  f.policy.windowsBashForOfficialPresets = true
  const first = f.make('official-pending'), second = f.make('official-pending-sibling')
  const pending = [first.ready(), second.ready()]
  await f.started
  assert.equal((await f.call(first.agent, 'pwsh')).isError, true)
  gate.resolve(); await Promise.all(pending)
  await first.scope.dispose()
  assert.equal((await f.call(second.agent, 'bash')).isError, false)
  await second.scope.dispose()
  const fresh = f.make('official-after-last-disposal')
  await fresh.ready()
  assert.equal((await f.call(fresh.agent, 'bash')).isError, false)
  f.broken(true)
  const failed = f.make('official-failed')
  await assert.rejects(failed.ready(), /Fixture payload unavailable/)
  f.broken(false)
  const recovered = f.make('official-recovered')
  await recovered.ready()
  assert.equal((await f.call(recovered.agent, 'bash')).isError, false)
  assert.equal((await f.call(failed.agent, 'bash')).isError, true)
  assert.equal((await f.call(failed.agent, 'pwsh')).isError, true)
  await assert.rejects(failed.step(), /Fixture payload unavailable/)
  const failedChild = f.make('official-failed-child', failed.agent)
  await assert.rejects(failedChild.ready(), /Fixture payload unavailable/)
  assert.equal((await f.call(failedChild.agent, 'bash')).isError, true)
})

test('official shell handles unsupported providers, pending disposal and plugin unload without leaving filters', async t => {
  const unsupported = await fixture(t, { official: 'standard', customProvider: true })
  const off = unsupported.make('custom-provider-off')
  await off.ready()
  assert.deepEqual(await unsupported.names(off.agent), ['pwsh'])
  unsupported.policy.windowsBashForOfficialPresets = true
  const on = unsupported.make('custom-provider-on')
  await assert.rejects(on.ready(), /Unsupported host shell provider/)
  assert.equal((await unsupported.call(on.agent, 'pwsh')).isError, true)
  await unsupported.stopOfficial()
  assert.equal((await unsupported.call(on.agent, 'pwsh')).isError, false)

  const gate = Promise.withResolvers<void>(), f = await fixture(t, { official: 'standard', preparationGate: gate.promise })
  f.policy.windowsBashForOfficialPresets = true
  const item = f.make('dispose-during-prepare'), pending = item.ready()
  await f.started
  await item.scope.dispose()
  gate.resolve(); await pending
  const next = f.make('after-pending-disposal')
  await next.ready()
  assert.deepEqual(await f.names(next.agent), ['bash'])
  await f.stopOfficial()
  assert.deepEqual(await f.names(next.agent), ['pwsh'])
  assert.doesNotMatch(await f.prompt(next.agent), /Windows with GNU Bash/)
})

test('a broken optional Bash tool does not break an official Agent while its scope is off', async t => {
  const f = await fixture(t, { official: 'standard', brokenTool: true })
  const original = f.make('broken-tool-off')
  await original.ready()
  assert.equal((await f.call(original.agent, 'pwsh')).isError, false)
  f.policy.windowsBashForOfficialPresets = true
  const enabled = f.make('broken-tool-on')
  await assert.rejects(enabled.ready(), /Fixture Bash tool registration failed/)
  assert.equal((await f.call(enabled.agent, 'pwsh')).isError, true)
})

test('Super Code shell unload releases only its own restrictions before the live Agent uses the official shell', async t => {
  for (const customProvider of [false, true]) {
    const f = await fixture(t, { customProvider }), item = f.make('super-code-unload'), restricted = f.make('user-denied-pwsh', undefined, ['pwsh'])
    if (customProvider) {
      await assert.rejects(item.ready(), /Unsupported host shell provider/)
      await assert.rejects(restricted.ready(), /Unsupported host shell provider/)
    } else { await item.ready(); await restricted.ready() }
    const official = await f.anotherPreset('standard')
    item.binding.rebind(official); restricted.binding.rebind(official)
    await f.stopShell()
    assert.equal((await f.call(item.agent, 'pwsh')).isError, false)
    assert.equal((await f.call(restricted.agent, 'pwsh')).isError, true, 'the host/user restriction is preserved')
    assert.doesNotMatch(await f.prompt(item.agent), /Windows with GNU Bash/)
  }
})

test('unloading a Super Code shell during failed preparation leaves no new restrictions on the surviving Agent', async t => {
  const gate = Promise.withResolvers<void>(), f = await fixture(t, { preparationGate: gate.promise })
  const item = f.make('unload-during-preparation'), pending = item.ready()
  await f.started
  const official = await f.anotherPreset('standard')
  item.binding.rebind(official)
  await f.stopShell()
  f.broken(true); gate.resolve()
  await pending
  assert.equal((await f.call(item.agent, 'pwsh')).isError, false)
})

test('Super Code children sharing a preset generation retain their live creator shell choice', async t => {
  for (const customProvider of [false, true]) {
    const f = await fixture(t, { sharedGeneration: true, customProvider })
    f.policy.windowsBash = false
    const parent = f.make('shared-disabled-parent')
    await parent.ready()
    f.policy.windowsBash = true
    const child = f.make('shared-child', parent.agent)
    await child.ready()
    assert.deepEqual(await f.names(child.agent), ['pwsh'])
    assert.equal((await f.call(child.agent, 'pwsh')).isError, false)
    if (customProvider) {
      const failed = f.make('shared-unsupported-on')
      await assert.rejects(failed.ready(), /Unsupported host shell provider/)
      f.policy.windowsBash = false
      const failedChild = f.make('shared-unsupported-child', failed.agent)
      await assert.rejects(failedChild.ready(), /Unsupported host shell provider/)
      assert.equal((await f.call(failedChild.agent, 'pwsh')).isError, true)
    }
  }
  const f = await fixture(t, { sharedGeneration: true })
  const parent = f.make('shared-enabled-parent')
  await parent.ready();f.policy.windowsBash = false
  const child = f.make('shared-enabled-child', parent.agent)
  await child.ready()
  assert.deepEqual(await f.names(child.agent), ['bash'])
})

test('a child waiting for failed parent preparation stays blocked after a sibling recovers', async t => {
  const gate = Promise.withResolvers<void>(), f = await fixture(t, { preparationGate: gate.promise })
  f.broken(true)
  const parent = f.make('failing-pending-parent'), parentReady = parent.ready()
  await f.started
  const child = f.make('failing-pending-child', parent.agent), childReady = child.ready()
  const failures = [parentReady, childReady].map(promise => assert.rejects(promise, /Fixture payload unavailable/))
  gate.resolve()
  await Promise.all(failures)
  f.broken(false)
  const recovered = f.make('sibling-after-pending-failure')
  await recovered.ready()
  assert.equal((await f.call(recovered.agent, 'bash')).isError, false)
  for (const agent of [parent, child]) {
    for (const name of ['bash', 'pwsh']) assert.equal((await f.call(agent.agent, name)).isError, true)
    await assert.rejects(agent.step(), /Fixture payload unavailable/)
  }
  assert.equal(f.preparations(), 2, 'failed conversations do not retry implicitly')
})

test('runtime service shares preparation, exposes detached status and retries after a filesystem failure', async t => {
  const ctx = new Context(), root = await mkdtemp(join(tmpdir(), 'super-code-shell-service-'))
  const previous = process.env.LOCALAPPDATA
  t.after(async () => {
    if (previous === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const blocked = join(root, 'not-a-directory')
  await writeFile(blocked, 'fixture')
  process.env.LOCALAPPDATA = blocked
  shell.applyWindowsShell(ctx)
  const service = ctx.superCodeShell, first = service.prepare(), shared = service.prepare()
  assert.equal(first, shared)
  assert.equal(service.status().state, 'pending')
  await assert.rejects(first, (error: NodeJS.ErrnoException) => ['ENOTDIR', 'ENOENT', 'EEXIST'].includes(error.code ?? ''))
  assert.equal(service.status().state, 'error')
  process.env.LOCALAPPDATA = join(root, '中文 目录')
  const retry = service.prepare()
  assert.notEqual(retry, first)
  assert.equal(service.prepare(), retry)
  assert.equal(service.status().state, 'pending')
  const runtime = await retry, snapshot = service.status()
  assert.equal(snapshot.state, 'ready')
  assert.equal(snapshot.version, runtime.version)
  assert.equal(service.status().error, undefined)
  Object.assign(snapshot, { state: 'error', version: 'mutated' })
  assert.equal(service.status().state, 'ready')
  assert.equal(service.status().version, runtime.version)
  assert.equal(service.prepare(), retry)
  assert.ok(runtime.root.startsWith(process.env.LOCALAPPDATA))
})

test('root restrictions, child restrictions and conversation shell choice remain independent', async t => {
  const f = await fixture(t)
  assert.equal(f.preparations(), 0, 'mounting a preset does not unpack the runtime')
  const first = f.make('first'), restricted = f.make('restricted-root', undefined, ['bash'])
  await first.ready(); await restricted.ready()
  assert.deepEqual((await f.names(first.agent)).filter(name => ['bash', 'pwsh'].includes(name)), ['bash'])
  assert.ok(!(await f.names(restricted.agent)).includes('bash'))
  assert.equal((await f.call(restricted.agent, 'bash')).isError, true)
  assert.match(JSON.stringify(await f.call(first.agent, 'bash')), /verified-bash\.exe/)
  assert.doesNotMatch(await f.prompt(first.agent), /pwsh host instructions/)
  f.policy.windowsBash = false
  const second = f.make('second'), child = f.make('child', first.agent), deniedChild = f.make('denied-child', first.agent, ['bash'])
  await second.ready(); await child.ready(); await deniedChild.ready()
  assert.ok((await f.names(second.agent)).includes('pwsh'))
  assert.ok(!(await f.names(second.agent)).includes('bash'))
  assert.match(JSON.stringify(await f.call(second.agent, 'pwsh')), /host-pwsh/)
  assert.doesNotMatch(await f.prompt(second.agent), /Windows with GNU Bash|bash host instructions/)
  assert.ok((await f.names(child.agent)).includes('bash'))
  assert.match(await f.prompt(child.agent), /Windows with GNU Bash/)
  assert.ok(!(await f.names(deniedChild.agent)).includes('bash'))
  assert.equal(f.ctx.tools.get('bash'), undefined, 'no tool is registered globally')
  assert.equal(f.ctx.shell.argv({ command: 'original' } as never)[0], 'host-pwsh')
  await first.scope.dispose()
  assert.ok((await f.names(second.agent)).includes('pwsh'), 'disposing one conversation preserves sibling tools')
})

test('preparation failure runs no tool, allows a disabled conversation and can retry for a new one', async t => {
  const f = await fixture(t)
  f.broken(true)
  const failed = f.make('failed')
  await assert.rejects(failed.ready(), /Fixture payload unavailable/)
  assert.equal((await f.call(failed.agent, 'bash')).isError, true)
  assert.equal((await f.call(failed.agent, 'pwsh')).isError, true, 'failed preparation must not expose the other shell')
  f.policy.windowsBash = false
  const disabled = f.make('disabled')
  await disabled.ready()
  assert.equal(f.preparations(), 1)
  assert.equal((await f.call(disabled.agent, 'pwsh')).isError, false)
  f.policy.windowsBash = true; f.broken(false)
  const recovered = f.make('recovered')
  await recovered.ready()
  assert.equal((await f.call(recovered.agent, 'bash')).isError, false)
  assert.equal((await f.call(failed.agent, 'bash')).isError, true, 'a sibling recovery must not activate the failed Agent')
  assert.equal(f.preparations(), 2)
})

test('non-Windows hosts keep their existing Bash tool without preparing a runtime', async t => {
  for (const platform of ['darwin', 'linux'] as const) {
    const f = await fixture(t, { platform }), first = f.make(platform)
    await first.ready()
    assert.deepEqual((await f.names(first.agent)).filter(name => ['bash', 'pwsh'].includes(name)), ['bash'])
    assert.equal((await f.call(first.agent, 'bash')).isError, false)
    assert.doesNotMatch(await f.prompt(first.agent), /Windows with GNU Bash/)
    assert.equal(f.preparations(), 0)
    assert.equal(f.ctx.shell.argv({ command: 'unchanged' } as never)[0], 'host-pwsh')
  }
})

test('unsupported providers fail explicitly when enabled and preserve a disabled parent choice for children', async t => {
  const f = await fixture(t, { customProvider: true }), failed = f.make('unsupported-enabled')
  await assert.rejects(failed.ready(), /Unsupported host shell provider/)
  assert.equal((await f.call(failed.agent, 'pwsh')).isError, true)
  f.policy.windowsBash = false
  const host = f.make('unsupported-disabled')
  await host.ready()
  assert.deepEqual((await f.names(host.agent)).filter(name => ['bash', 'pwsh'].includes(name)), ['pwsh'])
  assert.equal((await f.call(host.agent, 'pwsh')).isError, false)
  f.policy.windowsBash = true
  const child = f.make('unsupported-child', host.agent)
  await child.ready()
  assert.equal((await f.call(child.agent, 'pwsh')).isError, false)
  const next = f.make('unsupported-next')
  await assert.rejects(next.ready(), /Unsupported host shell provider/)
  assert.equal(f.preparations(), 0)
})

test('directory presets without profileContext resolve shell modules from their owning profile', async t => {
  for (const platform of ['win32', 'darwin'] as const) {
    const f = await fixture(t, { platform, profileContext: false })
    const root = f.make('profile-fallback-' + platform)
    await root.ready()
    assert.deepEqual((await f.names(root.agent)).filter(name => ['bash', 'pwsh'].includes(name)), ['bash'])
    const result = await f.call(root.agent, 'bash')
    assert.equal(result.isError, false)
    assert.match(JSON.stringify(result), platform === 'win32' ? /verified-bash\.exe/ : /host-pwsh/)
  }
})
