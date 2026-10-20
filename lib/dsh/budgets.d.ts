/** Optional policy overrides. Missing values remain owned by the host. */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
declare global {
    namespace Schemastery {
        interface Meta<T = any> {
            volatile?: boolean;
        }
    }
}
export interface Budgets {
    readonly pressureBasis?: 'host' | 'window';
    readonly thresholdRatio?: number;
    readonly retainRatio?: number;
    readonly summaryMaxTokens?: number;
    readonly compactionRetries?: number;
    readonly maxOverflowRetries?: number;
    readonly ptcTimeoutMs?: number;
    readonly ptcMaxTimeoutMs?: number;
}
export interface Configuration {
    readonly applyToOfficialPresets?: boolean;
    readonly budgets?: Budgets;
    readonly maxTasks?: number;
    readonly maxContextBytes?: number;
}
export declare const budgetSchema: z<Budgets>;
export declare const settingsConfigurationSchema: z<Configuration>;
export declare const configurationSchema: z<Configuration>;
export declare function validateConfiguration(config: Configuration): Configuration;
/** Newer Loader schemas expose volatile fields as references; older hosts return plain values. */
export declare function configurationValues(config: Configuration): Configuration;
export declare function configurationOf(ctx: Context, agent?: object): Configuration;
//# sourceMappingURL=budgets.d.ts.map