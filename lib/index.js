import { configurationSchema } from './dsh/budgets.js';
export const Config = configurationSchema;
const harnessPlugin = {
    name: 'super-code',
    inject: [],
    Config,
    async apply(ctx, config = {}) {
        const adapter = await import('./dsh/index.js');
        await adapter.apply(ctx, config);
    },
};
export default harnessPlugin;
export * from './core/teams.js';
export * from './core/guidance.js';
export * from './core/task-memory.js';
export * from './core/delegation.js';
export * from './core/tool-evidence.js';
//# sourceMappingURL=index.js.map