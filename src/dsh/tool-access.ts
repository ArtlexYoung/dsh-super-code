import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolProfile } from './tool-profiles.js'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'

export interface ToolRuntimeStatus {
  readonly sessionId: string
  readonly profileId: string
  readonly desiredProfileId: string
  readonly state: 'applied' | 'pending' | 'applying' | 'error'
  readonly execution: 'native' | 'ptc'
  readonly reason?: string
  readonly error?: string
}
export interface ToolRuntime {
  profile(agent?: Agent): ToolProfile
  allows(agent: Agent | undefined, name: string): boolean
  refresh(): void
  status(): ToolRuntimeStatus[]
}
const runtimes = new WeakMap<object, ToolRuntime>()
const presentations = new WeakMap<object, { select(agent: Agent, mode: 'native' | 'ptc'): void }>()

export function installToolRuntime(ctx: Context, runtime: ToolRuntime): void {
  const scope = scopeOf(ctx)
  if (!scope) throw new Error('Tool runtime requires a preset scope')
  runtimes.set(scope, runtime)
  ctx.effect(() => () => { runtimes.delete(scope) })
}
export function toolRuntime(ctx: Context, agent?: Agent): ToolRuntime | undefined {
  for (const scope of scopeChainOf(agent ?? scopeOf(ctx))) {
    const runtime = runtimes.get(scope)
    if (runtime) return runtime
  }
  return undefined
}
export function installToolPresentation(ctx: Context, select: (agent: Agent, mode: 'native' | 'ptc') => void): void {
  const scope = scopeOf(ctx)
  if (!scope) throw new Error('Tool presentation requires a preset scope')
  presentations.set(scope, { select })
  ctx.effect(() => () => { presentations.delete(scope) })
}
export function selectToolPresentation(ctx: Context, agent: Agent, mode: 'native' | 'ptc'): void {
  const presentation = presentations.get(scopeOf(ctx)!)
  if (!presentation) throw new Error('Tool presentation is unavailable')
  presentation.select(agent, mode)
}

export function toolAllowed(ctx: Context, agent: Agent | undefined, name: string): boolean {
  return toolRuntime(ctx, agent)?.allows(agent, name) ?? true
}

/** 条件注册使用宿主的每步工具集合；旧宿主由展示适配和执行 guard 共同约束。 */
export interface ToolRegistration {
  when?(context: { agent: Agent; signal: AbortSignal }): boolean | Promise<boolean>
}
export function registerManagedTool(ctx: Context, definition: ToolDefinition, options: ToolRegistration = {}): () => void {
  const tools = ctx.get('tools')!
  if ('resolve' in tools) {
    const conditional = tools as unknown as { register(definition: ToolDefinition, options: ToolRegistration): () => void }
    return conditional.register(definition, { when: context => toolAllowed(ctx, context.agent, definition.name)
      && (options.when ? options.when(context) : true) })
  }
  return tools.register(definition)
}
