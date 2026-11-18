import { z } from 'zod'

export const maximumToolProfiles: number = 30
export const maximumToolProfileNameLength: number = 60
export const maximumToolConfigurationBytes: number = 128 * 1024

/** 标识与插件依赖只在这里维护，界面使用服务端返回的目录。 */
export const toolGroups: readonly { id: string; tools: readonly string[]; module?: string; config?: object }[] = [
  { id: 'shell', tools: ['bash', 'pwsh'] },
  { id: 'files', tools: ['read', 'read_image', 'write', 'edit', 'apply_patch'], module: 'dsh-tool-fs', config: { applyPatch: true } },
  { id: 'search', tools: ['glob', 'grep'], module: 'dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
  { id: 'jobs', tools: ['job_list', 'job_output', 'job_kill'], module: 'dsh-tool-jobs' },
  { id: 'schedule', tools: ['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'], module: 'dsh-tool-schedule' },
  { id: 'skills', tools: ['skill'], module: 'dsh-tool-skill' },
  { id: 'goal', tools: ['get_goal', 'create_goal', 'update_goal'], module: 'dsh-tool-goal' },
  { id: 'plan', tools: ['exit_plan_mode'], module: 'dsh-plan-mode', config: {
    section: 'You are in plan mode. Inspect the project using non-mutating tools and produce a complete implementation plan. Do not change files, configuration, or persistent state. Present the plan using exit_plan_mode and wait for explicit approval before implementing it. A conversational answer to another question does not approve the plan.',
  } },
  { id: 'todo', tools: ['todo_write'], module: 'dsh-tool-todo', config: { allowParallelInProgress: true } },
  { id: 'subagent', tools: ['subagent', 'subagent_fork', 'list_subagent_models'] },
  { id: 'agents', tools: ['list_agents', 'wait_agent', 'send_message', 'interrupt_agent'], module: 'dsh-tool-subagent-control' },
  { id: 'workflow', tools: ['workflow'], module: 'dsh-tool-workflow' },
  { id: 'questions', tools: ['ask_user_question'], module: 'dsh-tool-ask-user' },
  { id: 'web', tools: ['web_search', 'web_fetch'], module: 'dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
  { id: 'present', tools: ['present'], module: 'dsh-tool-present' },
  { id: 'office', tools: ['office_render', 'office_convert', 'office_recalculate'], module: 'dsh-tool-office' },
  { id: 'cordis', tools: ['cordis_inspect_list', 'cordis_inspect_query'], module: 'dsh-tool-cordis' },
  { id: 'plugins', tools: ['plugin_manager'], module: 'dsh-plugin-manager/tools' },
  { id: 'market', tools: ['plugin_market'], module: 'dsh-plugin-market/tools' },
  { id: 'super-code', tools: ['super_code_method', 'super_code_task', 'super_code_memory'] },
]
export const toolNames: readonly string[] = toolGroups.flatMap(group => group.tools)
const toolNameSet = new Set(toolNames)
export interface ToolProfile { id: string; name: string; execution: 'native' | 'ptc'; shell: 'standard' | 'persistent'; tools: string[]; disabledExternalTools?: string[] }
const profileShape: z.ZodType<ToolProfile> = z.object({
  id: z.string().regex(/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  name: z.string().trim().min(1).max(maximumToolProfileNameLength),
  execution: z.enum(['native', 'ptc']),
  shell: z.enum(['standard', 'persistent']),
  tools: z.array(z.string().refine(name => toolNameSet.has(name), 'Unknown tool')).max(toolNames.length)
    .refine(tools => new Set(tools).size === tools.length, 'Duplicate tool'),
  disabledExternalTools: z.array(z.string().regex(/^\S{1,200}$/u).refine(name => !toolNameSet.has(name) && name !== 'run_code', 'Not an external tool'))
    .max(1024).refine(tools => new Set(tools).size === tools.length, 'Duplicate tool').optional(),
}).strict()

const standard = toolGroups.filter(group => !['cordis', 'market'].includes(group.id)).flatMap(group => group.tools)
  .filter(name => name !== 'apply_patch')
export const builtinToolProfiles: readonly ToolProfile[] = [
  { id: 'builtin:standard', name: 'standard', execution: 'native', shell: 'standard', tools: standard },
  { id: 'builtin:ptc', name: 'ptc', execution: 'ptc', shell: 'standard', tools: standard.filter(name =>
    !toolGroups.filter(group => ['plugins', 'workflow'].includes(group.id)).flatMap(group => group.tools).includes(name)) },
  { id: 'builtin:minimal', name: 'minimal', execution: 'native', shell: 'persistent', tools: ['bash', 'pwsh', 'read_image'] },
  { id: 'builtin:create', name: 'create', execution: 'native', shell: 'standard', tools: [
    ...standard.filter(name => !toolGroups.find(group => group.id === 'office')!.tools.includes(name)),
    ...toolGroups.filter(group => ['cordis', 'market'].includes(group.id)).flatMap(group => group.tools),
  ] },
  { id: 'builtin:super-code', name: 'super-code', execution: 'ptc', shell: 'standard', tools: [
    ...toolGroups.filter(group => ['shell', 'files', 'search', 'jobs', 'web', 'agents', 'skills', 'super-code', 'questions'].includes(group.id))
      .flatMap(group => group.tools).filter(name => name !== 'apply_patch'), 'subagent',
  ] },
]
export const maximumCustomProfiles: number = maximumToolProfiles - builtinToolProfiles.length
export interface ToolConfiguration { version: 1; activeId: string; custom: ToolProfile[] }
const configurationShape: z.ZodType<ToolConfiguration> = z.object({
  version: z.literal(1), activeId: z.string(), custom: z.array(profileShape).max(maximumCustomProfiles),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.custom.map(profile => profile.id)).size !== value.custom.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate profile' })
  if (![...builtinToolProfiles, ...value.custom].some(profile => profile.id === value.activeId))
    ctx.addIssue({ code: 'custom', message: 'Active profile does not exist' })
})
export const defaultToolConfiguration: ToolConfiguration = { version: 1, activeId: 'builtin:super-code', custom: [] }

export function validateToolConfiguration(value: unknown): ToolConfiguration { return configurationShape.parse(value) }
export function activeToolProfile(configuration: ToolConfiguration): ToolProfile {
  return [...builtinToolProfiles, ...configuration.custom].find(profile => profile.id === configuration.activeId)!
}
export function isManagedTool(name: string): boolean { return toolNameSet.has(name) }
