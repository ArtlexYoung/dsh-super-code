/** Global registration with per-preset eligibility; no shell rewriting or remembered grants. */
import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-super-code/deletion-protection': {
            kind: 'dsh-super-code/deletion-protection';
        };
    }
}
export declare const DELETION_INSTRUCTION: string;
export declare const RELAXED_DELETION_INSTRUCTION: string;
export declare function applyDeletionProtection(ctx: Context): void;
//# sourceMappingURL=deletion-protection.d.ts.map