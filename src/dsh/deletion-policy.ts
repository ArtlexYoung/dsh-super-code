import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { configurationOf, deletionProtectionMode } from './budgets.js'
import type { DeletionProtectionMode } from './budgets.js'

const official = new Set(['standard', 'ptc', 'minimal', 'cordis'])
interface Presets { composedPreset(ctx: Context): string | undefined }

export function deletionModeFor(ctx: Context, agent?: Agent): DeletionProtectionMode {
  const config = configurationOf(ctx), mode = deletionProtectionMode(config)
  if (mode === 'off' || !agent) return 'off'
  if (ctx.tools.get('super_code_task', agent)) return mode
  const presets = ctx.get('agentPresets') as Presets | undefined
  return config.deletionProtectionForOfficialPresets === true && !!presets && official.has(presets.composedPreset(agent.ctx) ?? '') ? mode : 'off'
}
