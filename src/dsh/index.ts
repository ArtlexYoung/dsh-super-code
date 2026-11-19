/** 各功能使用独立的宿主生命周期，加载失败只卸载所属功能。 */
import type { Context } from '@deepseek-ai/cordis'
import { configurationSchema } from './budgets.js'
import type { Configuration } from './budgets.js'
import { applyConfiguration } from './configuration.js'
import { deletionModeFor } from './deletion-policy.js'

export const name = 'super-code'
export const Config: typeof configurationSchema = configurationSchema

export async function apply(ctx: Context, config: Configuration = {}): Promise<void> {
  applyConfiguration(ctx, config)
  let deletionReady = false
  ctx.inject(['tools'], owner => {
    owner.tools.guard(exec => !deletionReady && ['bash', 'pwsh'].includes(exec.name) && deletionModeFor(owner, exec.agent) === 'strict'
      ? 'Deletion protection is unavailable. Command tools are disabled; restore protection before retrying.' : undefined)
  })
  const features: readonly [string, readonly string[], (owner: Context) => Promise<void>][] = [
    ['settings', ['settings'], async owner => {
      await (await import('./budget-settings.js')).applyBudgetRemote(owner)
      if (typeof owner.settings.register === 'function' && !owner.get('superCodeTools'))
        (await import('./tool-settings.js')).apply(owner)
    }],
    ['skills', [], async owner => { (await import('./skill-directory.js')).applySkillDirectory(owner) }],
    ['shell', [], async owner => { (await import('./windows-shell.js')).applyWindowsShell(owner) }],
    ['official-shell', ['agentPresets'], async owner => { (await import('./official-windows-shell.js')).applyOfficialWindowsShell(owner) }],
    ['official-budgets', ['agentPresets'], async owner => { (await import('./official-budgets.js')).applyOfficialBudgets(owner) }],
    ['deletion-protection', ['tools', 'systemPrompt'], async owner => {
      let disposed = false
      owner.effect(() => () => { disposed = true; deletionReady = false })
      await (await import('./deletion-protection.js')).applyDeletionProtection(owner)
      if (!disposed) deletionReady = true
    }],
    ['presets', ['agentPresets', 'settings'], async owner => { (await import('./preset-installation.js')).applyPresetInstallation(owner) }],
    ['recovery', ['agentPresets', 'sessionProjections', 'tools'], async owner => { (await import('./preset-recovery.js')).applyPresetRecovery(owner) }],
    ['workbench', [], async owner => { (await import('./workbench.js')).applyWorkbench(owner) }],
    ['connection', [], async owner => { (await import('./connection.js')).applyConnection(owner) }],
    ['storage', [], async owner => { await (await import('./memory-domains.js')).apply(owner) }],
    ['memory-library', [], async owner => {
      await owner.inject(['superCodeLongMemory', 'sessions'], async ready => {
        const { SuperCodeMemory } = await import('./memory-library.js')
        new SuperCodeMemory(ready, ready.get('superCodeLongMemory'))
      })
    }],
  ]
  // 父入口只负责注册；可选功能的就绪、失败和清理由各自生命周期管理。
  for (const [feature, inject, apply] of features) ctx.plugin({ name: 'super-code:' + feature, inject, apply })
  for (const register of [
    async (owner: Context) => owner.sessionProjections.register((await import('../super-agent-usage.js')).superAgentUsageProjectionDefinition),
    async (owner: Context) => owner.sessionProjections.register((await import('../task-memory-projection.js')).taskMemoryProjection),
    async (owner: Context) => owner.sessionProjections.register((await import('../task-feedback-projection.js')).taskFeedbackProjection),
    async (owner: Context) => owner.sessionProjections.register((await import('../memory-usage-projection.js')).memoryUsageProjection),
  ]) {
    ctx.inject(['sessionProjections'], async owner => { await register(owner) })
  }
}

export default apply
