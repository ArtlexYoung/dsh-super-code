const harnessPlugin = {
    name: 'super-agent',
    async apply(ctx, config = {}) {
        const adapter = await import('./dsh/index.js');
        adapter.apply(ctx, config);
    },
};
export default harnessPlugin;
export * from './core/protocol.js';
export * from './core/task-graph.js';
export * from './core/dispatcher.js';
export * from './core/review.js';
export * from './core/research.js';
export * from './core/optimization.js';
export * from './core/programming.js';
export * from './core/conversation.js';
export * from './core/conversation-contract.js';
export * from './core/evaluation.js';
export * from './core/evaluation-v2.js';
export * from './core/scenario.js';
export * from './core/teams.js';
export * from './core/task-memory.js';
export * from './core/delegation.js';
export * from './ui.js';
export * from './settings.js';
export * from './super-agent-usage.js';
//# sourceMappingURL=index.js.map