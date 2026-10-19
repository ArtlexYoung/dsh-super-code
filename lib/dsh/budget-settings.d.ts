/** Persist UI overrides through Harness settings; Agents take creation-time snapshots. */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsScope } from '@deepseek-ai/dsh-settings';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Configuration } from './budgets.js';
interface SettingsWriter {
    readonly writable: boolean;
    describe(options: {
        redactSecrets: boolean;
    }): {
        ns: string;
        revision: number;
    }[];
    replace(namespace: string, config: object, revision: number): Promise<void>;
}
export interface BudgetSettingsSnapshot {
    readonly configuration: Configuration;
    readonly revision: number;
    readonly writable: boolean;
    readonly ptcMaxTimeoutMs: number | false;
    readonly defaults: Configuration;
}
export type BudgetSettingsResult = {
    readonly ok: true;
    readonly snapshot: BudgetSettingsSnapshot;
} | {
    readonly ok: false;
    readonly error: 'invalid' | 'conflict' | 'read-only' | 'ptc-unavailable' | 'ptc-ceiling' | 'save-failed';
};
export declare class BudgetSettings {
    private readonly settings;
    private readonly scope;
    private readonly ptcCeiling;
    private readonly key;
    private readonly defaults;
    constructor(settings: SettingsWriter, scope: Pick<SettingsScope<Configuration>, 'get'>, ptcCeiling: () => number | false, key?: string, defaults?: () => Configuration);
    read(): BudgetSettingsSnapshot;
    save(content: string, expected: string): Promise<BudgetSettingsResult>;
    reset(expected: string): Promise<BudgetSettingsResult>;
    private replace;
}
export declare class SuperCodeBudgets extends TypertRemoteService {
    private readonly settings;
    constructor(ctx: Context, settings: BudgetSettings);
    readConfig(): BudgetSettingsSnapshot;
    saveConfig(content: string, expected: string): Promise<BudgetSettingsResult>;
    resetConfig(expected: string): Promise<BudgetSettingsResult>;
}
export declare function applyBudgetSettings(ctx: Context, config: Configuration): void;
export {};
//# sourceMappingURL=budget-settings.d.ts.map