import type { Context } from '@deepseek-ai/cordis';
import type { RecoveryConfig } from './preset-recovery-runtime.js';
interface PreparedRecovery {
    modulePath: string;
    config: RecoveryConfig & {
        owner: 'dsh-super-code';
    };
}
/** Preserve the user's YAML and expressions, with a concrete backup and stale-write check. */
export declare function prepareRecovery(patchPath: string, packagePath: string, source: string): Promise<PreparedRecovery>;
export declare function applyPresetRecovery(ctx: Context): void;
export {};
//# sourceMappingURL=preset-recovery.d.ts.map