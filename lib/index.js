const harnessPlugin = {
    name: 'super-code',
    async apply(ctx) {
        const adapter = await import('./dsh/index.js');
        adapter.apply(ctx);
    },
};
export default harnessPlugin;
export * from './core/teams.js';
export * from './core/guidance.js';
export * from './core/task-memory.js';
export * from './core/delegation.js';
export * from './core/tool-evidence.js';
//# sourceMappingURL=index.js.map