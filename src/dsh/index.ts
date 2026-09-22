/** Host projections and preset installation; execution belongs to Harness. */
import { applyPresetInstallation } from './preset-installation.js'
import type { Context } from '@deepseek-ai/cordis'
import { superAgentUsageProjectionDefinition } from '../super-agent-usage.js'
import { taskMemoryProjection } from '../task-memory-projection.js'

export const name = 'super-code'

export function apply(ctx: Context): void {
  applyPresetInstallation(ctx)
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.register(superAgentUsageProjectionDefinition)
    projectionCtx.sessionProjections.register(taskMemoryProjection)
  })
}

export default apply
