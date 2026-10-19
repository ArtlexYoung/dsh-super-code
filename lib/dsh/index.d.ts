import type { Context } from '@deepseek-ai/cordis';
import { configurationSchema } from './budgets.js';
import type { Configuration } from './budgets.js';
export declare const name = "super-code";
export declare const Config: typeof configurationSchema;
export declare function apply(ctx: Context, config?: Configuration): Promise<void>;
export default apply;
//# sourceMappingURL=index.d.ts.map