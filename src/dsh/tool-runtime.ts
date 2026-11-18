import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import { isManagedTool } from './tool-profiles.js'
import type { ToolProfile } from './tool-profiles.js'
import type { ToolRuntime, ToolRuntimeStatus } from './tool-access.js'
import { installToolRuntime, selectToolPresentation } from './tool-access.js'
import { mountToolProviders } from './tool-providers.js'
import { creatorOf } from './windows-shell-lifecycle.js'
import { toolExecution } from './tool-presentation.js'
import * as presentation from './tool-presentation.js'

export const name = 'super-code-tool-runtime'
export const inject: string[] = ['tools', 'systemPrompt', 'agents', 'superCodeTools']
interface Selection {
  profile: ToolProfile
  desired: ToolProfile
  state: ToolRuntimeStatus['state']
  error?: string
  work?: Promise<void>
  disposed: boolean
}
const fingerprint = (profile: ToolProfile): string => JSON.stringify([profile.execution, profile.shell, [...profile.tools].sort()])

/** 每个会话独立保存已应用版本；保存配置不等待其他会话的提问完成。 */
export class ToolSelections implements ToolRuntime {
  private readonly selections = new Map<Agent, Selection>()
  constructor(private readonly current: () => ToolProfile,
    private readonly select: (agent: Agent, profile: ToolProfile) => void,
    private readonly execution = (_agent: Agent, profile: ToolProfile): Pick<ToolRuntimeStatus, 'execution' | 'reason'> => ({ execution: profile.execution })) {}
  profile(agent?: Agent): ToolProfile { return agent ? this.selections.get(agent)?.profile ?? this.current() : this.current() }
  allows(agent: Agent | undefined, name: string): boolean {
    return !isManagedTool(name) || !agent || this.selections.get(agent)?.profile.tools.includes(name) === true
  }
  add(agent: Agent, inherited?: ToolProfile): void {
    if (this.selections.has(agent)) return
    const profile = structuredClone(inherited ?? this.current())
    const selection: Selection = { profile, desired: profile, state: 'applied', disposed: false }
    this.selections.set(agent, selection)
    try { this.select(agent, profile) }
    catch (error) { selection.state = 'error'; selection.error = error instanceof Error ? error.message : String(error) }
  }
  remove(agent: Agent): void {
    const selection = this.selections.get(agent)
    if (selection) selection.disposed = true
    this.selections.delete(agent)
  }
  refresh(): void {
    for (const [agent, selection] of this.selections) {
      selection.desired = structuredClone(this.current())
      if (fingerprint(selection.desired) === fingerprint(selection.profile) && selection.state !== 'error') {
        selection.profile = selection.desired; selection.state = 'applied'
        continue
      }
      selection.state = 'pending'
      this.schedule(agent, selection)
    }
  }
  status(): ToolRuntimeStatus[] {
    return [...this.selections].map(([agent, selection]) => ({ sessionId: String(agent.id), profileId: selection.profile.id,
      desiredProfileId: selection.desired.id, state: selection.state, ...this.execution(agent, selection.profile),
      ...(selection.error ? { error: selection.error } : {}) }))
  }
  async settled(): Promise<void> { await Promise.all([...this.selections.values()].map(selection => selection.work)) }
  private schedule(agent: Agent, selection: Selection): void {
    if (selection.work) return
    selection.work = this.applyWhenIdle(agent, selection).finally(() => { delete selection.work })
  }
  private async applyWhenIdle(agent: Agent, selection: Selection): Promise<void> {
    if (typeof agent.runMaintenance !== 'function') {
      selection.state = 'error'; selection.error = 'This host has no exclusive idle maintenance API; dynamic switching is unavailable.'
      return
    }
    try {
      while (!selection.disposed) {
        await agent.whenIdle()
        if (selection.disposed) return
        let task: Promise<void>
        try {
          task = agent.runMaintenance(async () => {
            const desired = selection.desired
            selection.state = 'applying'
            this.select(agent, desired)
            selection.profile = desired
            selection.state = 'applied'
            delete selection.error
          })
        // 宿主只在另一个任务先取得空闲互斥区时同步拒绝；维护任务对外仍可能显示 idle。
        } catch (error) {
          if (error instanceof Error && /already has active work/.test(error.message)) continue
          throw error
        }
        await task
        if (fingerprint(selection.desired) === fingerprint(selection.profile)) return
      }
    } catch (error) {
      if (!selection.disposed) { selection.state = 'error'; selection.error = error instanceof Error ? error.message : String(error) }
    }
  }
}

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(presentation)
  const source = ctx.get('superCodeTools')!
  let providers: Awaited<ReturnType<typeof mountToolProviders>> | undefined
  const runtime = new ToolSelections(() => source.profile(), (agent, profile) => {
    if (profile.tools.some(name => name === 'bash' || name === 'pwsh') && !providers?.shellAvailable(profile.shell))
      throw new Error('The selected host shell is unavailable')
    selectToolPresentation(ctx, agent, profile.execution)
  }, (agent, profile) => toolExecution(ctx, agent, profile.execution))
  ctx.effect(() => source.attach({ status: () => runtime.status(), catalog: () => providers?.catalog() ?? [] }))
  ctx.tools.guard(exec => !runtime.allows(exec.agent, exec.name) ? 'This tool is disabled by the applied Super Code tool profile. No tool was executed.' : undefined)
  const scope = scopeOf(ctx)
  const belongs = (agent: Agent): boolean => scopeChainOf(agent).includes(scope!)
  const add = (agent: Agent): void => {
    if (!belongs(agent)) return
    const creator = creatorOf(ctx, agent)
    runtime.add(agent, creator ? runtime.profile(creator) : undefined)
  }
  ctx.systemPrompt.section({ name: 'super-code:tool-profile', order: 93, text: ({ agent }) => {
    const profile = runtime.profile(agent)
    return `The applied tool profile uses ${profile.execution} execution and a ${profile.shell} shell. Only use currently provided tools. `
      + (profile.shell === 'persistent' ? 'Shell state persists for this agent; call the shell with only command, without ordinary-shell options.' : '')
  } })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembled = await next()
    if (!agent || !belongs(agent)) return assembled
    const profile = runtime.profile(agent)
    return { ...assembled,
      ...assembled.tools ? { tools: assembled.tools.filter(tool => tool.name === 'run_code' || runtime.allows(agent, tool.name)) } : {},
      sections: assembled.sections.filter(section => {
        if (section.name === 'super-code:windows-shell' && (profile.shell !== 'standard' || !profile.tools.includes('bash'))) return false
        const name = section.name.replace(/^tool:/, '').split(':')[0]!
        return !section.name.startsWith('tool:') || runtime.allows(agent, name)
      }) }
  })
  providers = await mountToolProviders(ctx, runtime)
  installToolRuntime(ctx, runtime)
  ctx.effect(() => source.watch(() => runtime.refresh()))
  ctx.on('agent/created', ({ agent }) => { add(agent); return undefined })
  ctx.on('agent/disposed', ({ agent }) => { runtime.remove(agent) })
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle' && belongs(agent)) runtime.refresh() })
  for (const agent of ctx.agents.list()) add(agent)
  ctx.effect(() => () => { for (const agent of ctx.agents.list()) runtime.remove(agent) })
}
