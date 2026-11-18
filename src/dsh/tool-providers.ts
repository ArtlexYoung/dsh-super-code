import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { hostModule, apply as applyShell } from './windows-shell.js'
import { registerManagedTool } from './tool-access.js'
import type { ToolRuntime, ToolRegistration } from './tool-access.js'
import { isManagedTool, toolGroups } from './tool-profiles.js'
import type { ToolProfile } from './tool-profiles.js'
import { scopeOf } from '@deepseek-ai/dsh-scope'

export interface ToolAvailability { readonly name: string; readonly group: string; readonly available: boolean; readonly reason?: string }

/** 通过公开服务注入接管注册，工具本身的校验、输出、权限和终端实现仍由宿主提供。 */
async function providerContext(ctx: Context, register: (definition: ToolDefinition, options?: ToolRegistration) => () => void): Promise<Context> {
  const tools = ctx.get('tools')!
  const owner = ctx.isolate('tools')
  const facade = { register,
    get: tools.get.bind(tools), schemas: tools.schemas.bind(tools),
    guard: tools.guard.bind(tools), restrict: tools.restrict.bind(tools), execute: tools.execute.bind(tools),
  }
  // 依赖方只看得到已经激活的服务；每个隔离服务须有独立且已完成初始化的拥有者。
  await owner.plugin({ apply(scope: Context) { scope.provide('tools', facade as unknown as typeof tools) } })
  return owner
}

function shellDefinition(variants: Map<string, ToolDefinition>, runtime: ToolRuntime): ToolDefinition {
  const first = variants.values().next().value!
  const selected = (agent?: Agent): ToolDefinition => {
    const definition = variants.get(runtime.profile(agent).shell)
    if (!definition) throw new Error('The selected host shell is unavailable')
    return definition
  }
  const schemas = () => [...new Map([...variants.values()].map(def => [JSON.stringify(def.output.schema), def.output.schema])).values()]
  return { ...first,
    description: 'Run a command using this conversation’s selected shell. In persistent mode use only command; state persists across calls. Standard mode requires command and description and accepts the ordinary host command options.',
    // 两种原装参数对象可重叠，不能用 oneOf；合并声明，执行时仍由所选原装工具严格校验。
    get parameters() {
      const schemas = [...variants.values()].map(def => def.parameters as { properties: Record<string, unknown>; required?: string[] })
      return { type: 'object', properties: Object.assign({}, ...schemas.map(schema => schema.properties)),
        required: (schemas[0]?.required ?? []).filter(key => schemas.every(schema => schema.required?.includes(key))),
        additionalProperties: true }
    },
    output: {
      get schema() { const values = schemas(); return values.length === 1 ? values[0]! : { oneOf: values } },
      render: (args, value) => (typeof value === 'string' && variants.has('persistent') ? variants.get('persistent')! : first).output.render(args, value),
    },
    execute: (args, exec) => selected(exec.agent).execute(args, exec),
    finalizeContent: (exec, result) => selected(exec.agent).finalizeContent?.(exec, result),
    presentCall: args => [...variants.values()].map(def => def.presentCall?.(args)).find(value => value !== undefined),
    presentResult: (args, result) => [...variants.values()].map(def => def.presentResult?.(args, result)).find(value => value !== undefined),
  }
}

export async function mountToolProviders(ctx: Context, runtime: ToolRuntime): Promise<{
  catalog(): ToolAvailability[]
  shellAvailable(kind: ToolProfile['shell']): boolean
}> {
  const registered = new Set<string>(), reasons = new Map<string, string>()
  const capture = () => providerContext(ctx, (definition, options) => {
    registered.add(definition.name)
    const release = registerManagedTool(ctx, definition, options)
    return () => { registered.delete(definition.name); release() }
  })
  const mount = async (owner: Context, moduleName: string, config: object = {}): Promise<void> => {
    const module = await hostModule(ctx, '@deepseek-ai/' + moduleName)
    await owner.plugin((module.default ?? module) as Plugin.Object, config)
  }
  // 官方 Shell 同名但参数与返回值不同。只保留一份祖先注册，按会话选择原装实现。
  const shellVariants = new Map<string, Map<string, ToolDefinition>>()
  const shellContexts: Context[] = []
  for (const kind of ['standard', 'persistent']) {
    const shell = await providerContext(ctx, definition => {
      let variants = shellVariants.get(definition.name)
      if (!variants) { variants = new Map(); shellVariants.set(definition.name, variants) }
      variants.set(kind, definition)
      if (!registered.has(definition.name)) {
        registered.add(definition.name)
        registerManagedTool(ctx, shellDefinition(variants, runtime))
      }
      return () => { variants.delete(kind) }
    })
    shellContexts.push(shell)
  }
  try { await shellContexts[0]!.plugin({ name: 'super-code:profile-shell', inject: ['tools', 'systemPrompt', 'shell'], apply: applyShell }) }
  catch (error) { reasons.set('shell', String(error)) }
  try {
    const persistent = shellContexts[1]!.isolate('terminals')
    await mount(persistent, 'dsh-terminal')
    await mount(persistent, 'dsh-terminal-bash', { shellDialect: process.platform === 'win32' ? 'pwsh' : 'bash', timeoutMs: 300000 })
    await mount(persistent, process.platform === 'win32' ? 'dsh-tool-pwsh-persistent' : 'dsh-tool-bash-persistent', { timeoutMs: 300000 })
  } catch (error) { reasons.set('persistent', String(error)) }
  const delegation = (await capture()).isolate('workflowEngine')
  for (const group of toolGroups.filter(group => group.module && group.id !== 'workflow')) {
    if (['plugins', 'market'].includes(group.id) && !ctx.get('profileContext')) {
      reasons.set(group.id, 'profileContext is unavailable'); continue
    }
    const owner = await capture()
    try { await mount(group.id === 'plan' ? owner.isolate('planMode') : owner, group.module!, group.config) }
    catch (error) { reasons.set(group.id, error instanceof Error ? error.message : String(error)) }
  }
  for (const [moduleName, config] of [
    ['dsh-tool-subagent', { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true, maxDepth: 1 }],
    ['dsh-tool-subagent', { provider: 'fork', toolName: 'subagent_fork' }],
    ['dsh-workflow-ptc', { provider: 'spawn' }],
    ['dsh-tool-workflow', {}],
  ] as const) {
    try { await mount(delegation, moduleName, config) }
    catch (error) { reasons.set('subagent', error instanceof Error ? error.message : String(error)) }
  }
  return { shellAvailable: kind => [...shellVariants.values()].some(variants => variants.has(kind)),
    catalog: () => [...toolGroups.flatMap(group => group.tools.map(name => ({ name, group: group.id,
    available: registered.has(name) || group.id === 'super-code' && !!ctx.get('tools')!.get(name, scopeOf(ctx)),
    ...registered.has(name) ? {} : { reason: reasons.get(group.id) ?? 'The host did not register this tool or its required service is unavailable.' },
  }))), ...ctx.tools.schemas(scopeOf(ctx)).filter(tool => tool.name !== 'run_code' && !isManagedTool(tool.name))
      .map(tool => ({ name: tool.name, group: 'external', available: true }))] }
}
