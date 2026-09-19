/** Agent-scoped tools and logged runtime context, using the installed Harness API. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GuidedRoute } from '../core/guidance.js';
export declare const name = "super-code";
export declare const inject: readonly string[];
export interface Config {
    readonly maxTasks?: number;
    readonly maxContextBytes?: number;
    readonly guidedRoutes?: GuidedRoute[];
}
export declare const Config: z<Config>;
/** Installs no agent loop and starts no model calls. */
export declare function apply(ctx: Context, config?: Config): void;
declare const plugin: {
    readonly name: string;
    readonly inject: readonly string[];
    readonly Config: z<Config>;
    readonly apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=super-code.d.ts.map