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
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { applyBudgetSettings } from '../src/dsh/budget-settings.js'
import * as shell from '../src/dsh/windows-shell.js'

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
async function fixture(t: test.TestContext, options: { platform?: NodeJS.Platform; customProvider?: boolean; preparationGate?: Promise<void>; profileContext?: boolean } = {}) {
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
  const policy = { windowsBash: true }
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
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: options.platform ?? 'win32' })
  try { await preset.ctx.plugin(shell) }
  finally { Object.defineProperty(process, 'platform', { value: platform }) }
  const make = (id: string, parent?: Agent, deny?: string[]) => {
    const agent = { id, session: Session.create(SessionId(id)) } as unknown as Agent
    const scope = createScope(parent?.ctx ?? preset.ctx, agent, { parent: parent ?? generation })
    Object.assign(agent, { ctx: scope.ctx })
    if (deny) scope.ctx.get('tools')!.restrict({ deny })
    return { agent, scope,
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
  return { ctx, policy, make, names, prompt, call, started: started.promise,
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
