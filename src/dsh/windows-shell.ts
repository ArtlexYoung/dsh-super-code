/** Select the host's standard shell tool; Windows can use the bundled Bash executable. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { configurationOf } from './budgets.js'
import { prepareWindowsRuntime, windowsRuntimeEnvironment } from '../core/windows-runtime.js'
import type { WindowsRuntime } from '../core/windows-runtime.js'

interface ShellSpec {
  command: string
  env?: NodeJS.ProcessEnv
  sandboxPolicy?: { mode: string; [key: string]: unknown }
  [key: string]: unknown
}
interface HostShell {
  readonly config: Record<string, unknown>
  readonly sandboxMode?: string
  resolve(request: ShellSpec): ShellSpec
  argv(spec: ShellSpec): string[]
}
interface ShellConstructor {
  new(ctx: Context, config: Record<string, unknown>): HostShell
  readonly inject?: readonly string[]
}

/** Use the host provider's argv extension point, including its sandboxed implementation. */
export function bundledBashProvider(Base: ShellConstructor, runtime: WindowsRuntime | (() => WindowsRuntime)): ShellConstructor {
  const current = (): WindowsRuntime => typeof runtime === 'function' ? runtime() : runtime
  return class extends Base {
    override resolve(request: ShellSpec): ShellSpec {
      const spec = super.resolve(request)
      const mode = spec.sandboxPolicy?.mode ?? this.sandboxMode
      // MSYS needs named pipes that Windows restricted tokens cannot create.
      // The standard tool resolves an approved per-call mode before this point.
      if (process.platform === 'win32' && mode !== undefined && mode !== 'danger-full-access') {
        throw new Error('SUPER_CODE_BASH_SANDBOX: The Windows sandbox cannot start bundled Bash because MSYS requires internal named pipes. '
          + 'This command was not executed. If it is still needed and approvals are available, request DSH approval for the exact same command '
          + 'with sandbox_permissions="danger-full-access" and a justification. Approval applies only to that invocation; do not change the session permission or switch shells. '
          + 'If approval is rejected, cancelled or disabled, stop this command.')
      }
      return { ...spec, env: windowsRuntimeEnvironment(current(), spec.env) }
    }
    override argv(spec: ShellSpec): string[] {
      return [current().bash, '--noprofile', '--norc', '-c', spec.command]
    }
  }
}

/** Resolve the running host's modules, including installed directory presets and Desktop profiles. */
async function hostModule(ctx: Context, name: string): Promise<Record<string, unknown>> {
  const profile = ctx.get('profileContext') as { installAnchor?: string } | undefined
  const require = createRequire(profile?.installAnchor ?? new URL('../../package.json', import.meta.url))
  return await import(pathToFileURL(require.resolve(name)).href)
}

async function hostTool(ctx: Context, name: string): Promise<Plugin.Object> {
  const module = await hostModule(ctx, name)
  if (typeof module.apply !== 'function') throw new Error(`Invalid host shell tool: ${name}`)
  return module as unknown as Plugin.Object
}

export interface ShellStatus {
  readonly platform: string
  readonly state: 'host' | 'pending' | 'ready' | 'error'
  readonly version?: string
  readonly error?: string
}
interface RuntimeService { status(): ShellStatus; prepare(): Promise<WindowsRuntime> }
declare module '@deepseek-ai/cordis' { interface Context { superCodeShell: RuntimeService } }

/** One shared preparation result; no installation subprocess or global environment mutation. */
export function applyWindowsShell(ctx: Context): void {
  let status: ShellStatus = { platform: process.platform, state: process.platform === 'win32' ? 'pending' : 'host' }
  let preparing: Promise<WindowsRuntime> | false = false
  ctx.provide('superCodeShell', {
    status: () => ({ ...status }),
    prepare: () => {
      if (!preparing) {
        status = { platform: process.platform, state: 'pending' }
        preparing = prepareWindowsRuntime().then(runtime => {
          status = { platform: process.platform, state: 'ready', version: runtime.version }
          return runtime
        }, (error: unknown) => {
          preparing = false
          status = { platform: process.platform, state: 'error', error: error instanceof Error ? error.message : 'Bundled Bash preparation failed' }
          throw error
        })
      }
      return preparing
    },
  })
}

export const name = 'super-code-shell'
export const inject: string[] = ['tools', 'systemPrompt', 'shell']

/** Keep tools inherited so both root and child capability restrictions still apply. */
export async function apply(ctx: Context): Promise<void> {
  if (process.platform !== 'win32') {
    await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-bash'))
    return
  }
  const { scopeParentOf } = await hostModule(ctx, '@deepseek-ai/dsh-scope') as { scopeParentOf(key: object): object | undefined }
  const host = ctx.get('shell') as unknown as HostShell
  const provider = await hostModule(ctx, host.sandboxMode === undefined ? '@deepseek-ai/dsh-pwsh-local' : '@deepseek-ai/dsh-pwsh-sandbox')
  const Base = provider.default as ShellConstructor
  if (typeof Base !== 'function' || !(host instanceof Base)) {
    await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-pwsh'))
    const disabled = new WeakSet<object>()
    const check = (agent: Agent): void => {
      for (let current: object | undefined = agent; current; current = scopeParentOf(current)) {
        if (disabled.has(current)) { disabled.add(agent); return }
      }
      if (configurationOf(ctx, agent).windowsBash !== false) {
        agent.ctx.get('tools')!.restrict({ deny: ['pwsh'] })
        throw new Error('Unsupported host shell provider; disable bundled Bash to use the host shell')
      }
      disabled.add(agent)
    }
    ctx.on('agent/created', ({ agent }) => { check(agent) })
    ctx.on('agent/pre-step', async ({ agent }, next) => { check(agent); return next() })
    return
  }
  const installed = new WeakMap<Agent, { enabled: boolean; ready: Promise<void> }>()
  const choice = (agent?: Agent): boolean => {
    for (let current: object | undefined = agent; current; current = scopeParentOf(current)) {
      const state = installed.get(current as Agent)
      if (state) return state.enabled
    }
    return configurationOf(ctx, agent).windowsBash !== false
  }
  let runtime: WindowsRuntime | false = false
  const Bundled = bundledBashProvider(Base, () => {
    if (!runtime) throw new Error('Bundled Bash is not ready for this conversation')
    return runtime
  })
  // The host owns settings; the private provider consumes its existing config.
  const bash = ctx.isolate('shell').isolate('settings')
  await bash.plugin({ inject: [...Base.inject ?? []], apply(scope: Context) { new Bundled(scope, host.config) } })
  await bash.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-bash'))
  await ctx.plugin(await hostTool(ctx, '@deepseek-ai/dsh-tool-pwsh'))
  bash.systemPrompt.section({ name: 'super-code:windows-shell', order: 94,
    text: ({ agent }) => agent && choice(agent)
      ? 'Command environment: Windows with GNU Bash and BusyBox utilities. Native programs still run on Windows.' : '' })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembled = await next()
    const hidden = choice(agent) ? 'tool:pwsh' : 'tool:bash'
    return { ...assembled, sections: assembled.sections.filter(section => section.name !== hidden) }
  })
  const install = (agent: Agent): Promise<void> => {
    const existing = installed.get(agent)
    if (existing) return existing.ready
    // Descendants retain their conversation's shell and capability filters.
    for (let parent = scopeParentOf(agent); parent; parent = scopeParentOf(parent)) {
      const inherited = installed.get(parent as Agent)
      if (inherited) { installed.set(agent, inherited); return inherited.ready }
    }
    const enabled = configurationOf(ctx, agent).windowsBash !== false
    const tools = agent.ctx.get('tools')!
    tools.restrict({ deny: [enabled ? 'pwsh' : 'bash'] })
    const ready = (async () => {
      if (enabled) {
        try {
          const service = ctx.get('superCodeShell')
          if (!service) throw new Error('Super Code shell service is unavailable')
          runtime = await service.prepare()
        } catch (error) {
          // Sibling recovery must not activate a conversation that failed preparation.
          tools.restrict({ deny: ['bash'] })
          throw error
        }
      }
    })()
    installed.set(agent, { enabled, ready })
    return ready
  }
  ctx.on('agent/created', async ({ agent }) => { await install(agent) })
  ctx.on('agent/pre-step', async ({ agent }, next) => { await install(agent); return next() })
}
