import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import { hostModule } from './windows-shell.js'
import { toolAllowed, toolRuntime, installToolPresentation } from './tool-access.js'

export const name = 'super-code-tool-presentation'
export const inject: readonly string[] = ['tools', 'systemPrompt', 'agents']

const localTools = new Set([
  'bash', 'pwsh', 'powershell', 'terminal', 'exec_command', 'write_stdin',
  'subagent', 'spawn_agent', 'delegate_task', 'create_agent', 'create_team',
  'team', 'worktree', 'create_worktree', 'job_output', 'job_list', 'job_kill',
])

// Windows SFTP 挂载不保证支持 DSH 原生写入需要的句柄权限和硬链接操作。
const mountedWriteTools = new Set(['write', 'edit', 'str_replace_editor'])

function remoteUnsupported(name: string): boolean {
  return localTools.has(name) || /(?:^|_)(?:subagent|worktree)(?:_|$)/.test(name)
    || (process.platform === 'win32' && mountedWriteTools.has(name))
}

function remoteTools(tools: readonly ToolDefinition[]): boolean {
  return tools.some(tool => tool.name === 'remote_bash')
}

// Windows 创建进程还需要目录末尾的分隔符和终止字符。
const windowsWorkingDirectoryLimit = 259
function windowsLongDirectory(agent: Agent): boolean {
  return process.platform === 'win32' && (agent.session.header.cwd?.length ?? 0) >= windowsWorkingDirectoryLimit
}

export function toolExecution(ctx: Context, agent: Agent, requested: 'native' | 'ptc'): { execution: 'native' | 'ptc'; reason?: string } {
  if (ctx.tools.get('remote_bash', agent)) return { execution: 'native', reason: 'remote' }
  if (windowsLongDirectory(agent)) return { execution: 'native', reason: 'windows-path' }
  return { execution: requested }
}

// rc.3 将执行器从工具注册表中拆出；旧版仍使用 presentAs。
interface Batch { readonly agent?: Agent }
interface HostExecutor {
  readonly sections?: readonly {
    readonly name: string
    readonly order: number
    readonly interpolate?: boolean
    readonly text: string | ((tools: readonly ToolDefinition[]) => string)
  }[]
  describe(tools: readonly ToolDefinition[]): { schemas: readonly ToolSchema[]; knownNames?: readonly string[] }
  execute(input: Batch): Promise<unknown>
}
interface ExecutorTools { setExecutor(executor: HostExecutor): () => void }

async function applyExecutors(ctx: Context, tools: ExecutorTools): Promise<void> {
  const nativeModule = await hostModule(ctx, '@deepseek-ai/dsh-tool-executor-native')
  const { NativeToolExecutor } = nativeModule as unknown as { NativeToolExecutor: new(ctx: Context) => HostExecutor }
  const native = new NativeToolExecutor(ctx)
  let ptc = native
  let ptcAvailable = false
  try {
    const ptcModule = await hostModule(ctx, '@deepseek-ai/dsh-tool-executor-ptc')
    const { PtcExecutor } = ptcModule as unknown as { PtcExecutor: new(ctx: Context) => HostExecutor }
    ptc = new PtcExecutor(ctx)
    ptcAvailable = true
  } catch (error) { ctx.logger.warn('PTC is unavailable; using the native tool executor.', error) }
  const visible = (definitions: readonly ToolDefinition[], agent?: Agent): readonly ToolDefinition[] => definitions.filter(tool => toolAllowed(ctx, agent, tool.name))
  const executor = (nativeOnly: boolean, agent?: Agent): HostExecutor => ({
    sections: nativeOnly ? [] : ptc.sections?.map(section => ({ ...section, text: definitions => remoteTools(definitions) ? ''
      : typeof section.text === 'function' ? section.text(visible(definitions, agent)) : section.text })),
    describe: definitions => {
      const filtered = visible(definitions, agent)
      return remoteTools(definitions)
        ? { ...native.describe(filtered.filter(tool => !remoteUnsupported(tool.name))), knownNames: definitions.map(tool => tool.name) }
        : { ...(nativeOnly ? native : ptc).describe(filtered), knownNames: definitions.map(tool => tool.name) }
    },
    execute: input => (nativeOnly || ctx.tools.get('remote_bash', input.agent) ? native : ptc).execute(input),
  })
  tools.setExecutor(executor(false))
  const selected = new Map<Agent, { mode: boolean; release: () => void }>(), scope = scopeOf(ctx)
  const select = (agent: Agent, mode: 'native' | 'ptc'): void => {
    const nativeOnly = toolExecution(ctx, agent, mode).execution === 'native'
    if (!nativeOnly && !ptcAvailable) throw new Error('The selected PTC executor is unavailable')
    const previous = selected.get(agent)
    if (previous?.mode === nativeOnly) return
    previous?.release()
    const set = (native: boolean) => (agent.ctx.get('tools') as unknown as ExecutorTools).setExecutor(executor(native, agent))
    try { selected.set(agent, { mode: nativeOnly, release: set(nativeOnly) }) }
    catch (error) {
      if (previous) selected.set(agent, { mode: previous.mode, release: set(previous.mode) })
      throw error
    }
    if (!previous) agent.ctx.effect(() => () => { selected.get(agent)?.release(); selected.delete(agent) })
  }
  installToolPresentation(ctx, select)
  ctx.effect(() => () => { for (const value of selected.values()) value.release(); selected.clear() })
  const install = (agent: Agent): void => {
    if (selected.has(agent) || !windowsLongDirectory(agent) || !scopeChainOf(agent).includes(scope!)) return
    select(agent, 'native')
  }
  ctx.on('agent/created', ({ agent }) => { install(agent); return undefined })
  ctx.on('agent/pre-step', ({ agent }, next) => { install(agent); return next() })
  for (const agent of ctx.agents.list()) install(agent)
}

async function applyLegacy(ctx: Context): Promise<void> {
  const presentation = await hostModule(ctx, '@deepseek-ai/dsh-agent-tool-presentation')
  await ctx.plugin(presentation as unknown as Plugin.Object, { mode: 'ptc' })
  const selected = new Map<Agent, () => void>(), disposed = new WeakSet<Agent>(), scope = scopeOf(ctx)
  const requested = new WeakMap<Agent, 'native' | 'ptc'>(), applied = new WeakMap<Agent, 'native' | 'ptc'>()
  let refreshing = false, active = true
  const refresh = (): void => {
    if (refreshing || !active) return
    refreshing = true
    try {
      for (const agent of ctx.agents.list()) {
        if (disposed.has(agent) || !scopeChainOf(agent).includes(scope!)) continue
        const mode = ctx.tools.get('remote_bash', agent) || windowsLongDirectory(agent) ? 'native' : requested.get(agent)
        if (mode) {
          if (applied.get(agent) === mode && selected.has(agent)) continue
          selected.get(agent)?.()
          // 先占位，避免注册通知重入同一会话。
          selected.set(agent, () => {})
          const release = agent.ctx.get('tools')!.presentAs(mode)
          selected.set(agent, release)
          applied.set(agent, mode)
          agent.ctx.effect(() => () => { disposed.add(agent); selected.delete(agent); release() })
        } else {
          const release = selected.get(agent)
          selected.delete(agent)
          release?.()
        }
      }
    } finally { refreshing = false }
  }
  ctx.on('tools/change', refresh)
  installToolPresentation(ctx, (agent, mode) => { requested.set(agent, mode); refresh() })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembled = await next()
    if (!agent || !toolRuntime(ctx, agent)) return assembled
    const hostTools = await hostModule(ctx, '@deepseek-ai/dsh-tools')
    const schemas = ctx.tools.schemas(agent).filter(tool => toolAllowed(ctx, agent, tool.name))
    const runtime = ctx.get('codeRuntime') as { language?: string } | undefined
    const render = hostTools[runtime?.language === 'python' ? 'renderToolsSdkPy' : 'renderToolsSdk']
    if (typeof render !== 'function') throw new Error('The host SDK renderer is unavailable')
    return { ...assembled, sections: assembled.sections.map(section => section.name === 'tools:sdk'
      ? { ...section, text: String(render(schemas)) } : section) }
  })
  ctx.on('agent/created', () => { refresh(); return undefined })
  ctx.on('agent/pre-step', (_event, next) => { refresh(); return next() })
  ctx.effect(() => () => { active = false; for (const release of selected.values()) release(); selected.clear() })
  refresh()
}

/** 仅选择宿主执行器，执行和权限检查仍由宿主及远程插件负责。 */
export async function apply(ctx: Context): Promise<void> {
  const legacy = !('setExecutor' in ctx.tools)
  let unavailable = false
  ctx.tools.guard(execution => unavailable && execution.agent
    && (ctx.tools.get('remote_bash', execution.agent) || windowsLongDirectory(execution.agent))
    ? 'The required native tool executor is unavailable. No tool was executed; restore the host executor before retrying.' : undefined)
  ctx.tools.guard(execution => process.platform === 'win32' && execution.agent
    && ctx.tools.get('remote_bash', execution.agent) && mountedWriteTools.has(execution.name)
    ? 'Native mounted file writes are unavailable in this Windows remote project. Use remote_bash for file changes, with its normal DSH approval. No command was run or retried.' : undefined)
  ctx.systemPrompt.section({ name: 'super-code:remote-tools', order: 94, text: ({ agent }) =>
    agent && ctx.tools.get('remote_bash', agent)
      ? 'This is a lightweight remote project. Call remote_bash directly for commands; use file tools with relative paths or the mounted project directory. Super Code task and memory tools remain available. Local shells, background jobs, interactive terminals, worktrees and subagent execution are unavailable. CLI programs and Skill scripts must exist on the remote machine; bundled local executables are not installed there. Never fall back to local execution when disconnected.'
        + (process.platform === 'win32' ? ' On Windows, use native file tools for reads, and perform file changes through remote_bash on the remote machine. Native write, edit and str_replace_editor are unavailable on the mount. Inspect existing content before changing it; verify the result afterward. If a command fails or is interrupted, inspect its effects before deciding what remains; never replay a write automatically. Remote command approval, cancellation and disconnection checks still apply.' : '') : '' })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembled = await next()
    if (!agent || !ctx.tools.get('remote_bash', agent)) return assembled
    return { ...assembled,
      ...legacy ? { tools: unavailable ? [] : assembled.tools.filter(tool => !remoteUnsupported(tool.name)) } : {},
      sections: assembled.sections.filter(section => !/^tool:(?:bash|pwsh|powershell|terminal|jobs|subagent)(?:$|:)/.test(section.name)
        && section.name !== 'super-code:windows-shell'
        && !(process.platform === 'win32' && /^tool:(?:write|edit|str_replace_editor|str-replace-editor)(?:$|:)/.test(section.name))),
    }
  })
  try {
    if (!legacy) await applyExecutors(ctx, ctx.tools as unknown as ExecutorTools)
    else await applyLegacy(ctx)
  } catch (error) {
    unavailable = true
    ctx.logger.warn('Tool presentation is unavailable; required remote and long-directory execution is disabled.', error)
  }
}
