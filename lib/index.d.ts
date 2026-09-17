/**
 * Public entry point for the dependency-free dsh-super-agent domain protocol.
 *
 * Harness discovers browser contributions only from package-root loader rows.
 * The default plugin loads the Cordis adapter on mount, so importing domain
 * APIs alone still does not load the optional Harness runtime peers.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './dsh/index.js';
declare const harnessPlugin: {
    readonly name: string;
    readonly apply: (ctx: Context, config?: Config) => Promise<void>;
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
//# sourceMappingURL=index.d.ts.map