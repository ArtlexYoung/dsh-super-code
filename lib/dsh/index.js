import { superAgentUsageProjectionDefinition } from '../super-agent-usage.js';
import { taskMemoryProjection } from '../task-memory-projection.js';
export const name = 'super-code';
export function apply(ctx) {
    ctx.inject(['sessionProjections'], projectionCtx => {
        projectionCtx.sessionProjections.register(superAgentUsageProjectionDefinition);
        projectionCtx.sessionProjections.register(taskMemoryProjection);
    });
}
export default apply;
//# sourceMappingURL=index.js.map