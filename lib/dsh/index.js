/** Host projections and preset installation; execution belongs to Harness. */
import { applyPresetInstallation } from './preset-installation.js';
import { superAgentUsageProjectionDefinition } from '../super-agent-usage.js';
import { taskFeedbackProjection } from '../task-feedback-projection.js';
import { taskMemoryProjection } from '../task-memory-projection.js';
import { LongMemoryStore, longMemoryDomainSpec } from '../long-memory.js';
import { memoryUsageProjection } from '../memory-usage-projection.js';
import { SuperCodeMemory } from './memory-library.js';
import { configurationSchema } from './budgets.js';
import { applyBudgetSettings } from './budget-settings.js';
import { applyOfficialBudgets } from './official-budgets.js';
import { applyConnection } from './connection.js';
import { applyDeletionProtection } from './deletion-protection.js';
export const name = 'super-code';
export const Config = configurationSchema;
async function installLongMemory(ctx) {
    await ctx.inject(['storageDomain'], async (owner) => {
        try {
            const facility = owner.get('storageDomain');
            const domain = await facility.open(longMemoryDomainSpec);
            owner.effect(() => () => domain.close());
            const remove = ctx.provide('superCodeLongMemory', new LongMemoryStore(domain.table('topics')));
            owner.effect(() => remove);
        }
        catch {
            owner.logger.warn('Super Code long memory storage is unavailable; task memory remains available.');
        }
    });
}
export async function apply(ctx, config = {}) {
    applyBudgetSettings(ctx, config);
    applyOfficialBudgets(ctx);
    applyDeletionProtection(ctx);
    applyPresetInstallation(ctx);
    applyConnection(ctx);
    ctx.inject(['superCodeLongMemory', 'sessions'], owner => {
        new SuperCodeMemory(owner, owner.get('superCodeLongMemory'));
    });
    ctx.inject(['sessionProjections'], projectionCtx => {
        projectionCtx.sessionProjections.register(superAgentUsageProjectionDefinition);
        projectionCtx.sessionProjections.register(taskMemoryProjection);
        projectionCtx.sessionProjections.register(taskFeedbackProjection);
        projectionCtx.sessionProjections.register(memoryUsageProjection);
    });
    await installLongMemory(ctx);
}
export default apply;
//# sourceMappingURL=index.js.map