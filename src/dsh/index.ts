/** Host-scoped projections only; execution and model selection belong to Harness. */
import type { Context } from '@deepseek-ai/cordis'
import { superAgentUsageProjectionDefinition } from '../super-agent-usage.js'
import { taskMemoryProjection } from '../task-memory-projection.js'

export const name = 'super-code'

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.register(superAgentUsageProjectionDefinition)
    projectionCtx.sessionProjections.register(taskMemoryProjection)
  })
}

export default apply
