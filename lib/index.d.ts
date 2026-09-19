/** Package-root registration lets Harness discover the browser contribution. */
import type { Context } from '@deepseek-ai/cordis';
declare const harnessPlugin: {
    readonly name: string;
    readonly apply: (ctx: Context) => Promise<void>;
};
export default harnessPlugin;
export * from './core/teams.js';
export * from './core/guidance.js';
export * from './core/task-memory.js';
export * from './core/delegation.js';
export * from './core/tool-evidence.js';
//# sourceMappingURL=index.d.ts.map