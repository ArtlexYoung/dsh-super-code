import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { createUserMessage } from '@deepseek-ai/dsh-llm';
interface Record {
    preset: string;
    createdAt: number;
    cwd?: string;
    fingerprint: string;
}
interface State {
    plugin: 'dsh-super-code';
    format: 1;
    sessions: {
        [id: string]: Record;
    };
}
export interface RecoveryConfig {
    statePath: string;
    packagePath: string;
}
export interface RecoveryService {
    remember(agent: Agent): Promise<void>;
    backfill(presets: readonly string[]): Promise<void>;
    lifetime?: RecoveryConfig & {
        source: string;
        dispose(): Promise<void>;
    };
}
export declare function fingerprint(content: string): string;
/** The durable producer record survives cold reloads and compaction. */
export declare function deletionNoticeMatches(session: Session, instruction: string): boolean;
/** Retire only producer-owned rules; keep append-origin history and user instructions intact. */
export declare function revokeDeletionNotices(session: Session, message: typeof createUserMessage): void;
/** The first declarative releases predate readDocument; their Loader still owns the definition. */
export declare function compositionContent(ctx: Context, id: string): Promise<string>;
/** Invalid or unrelated records fail closed; never replace them with an empty ownership record. */
export declare class RecoveryState {
    readonly path: string;
    readonly value: State;
    private content;
    private tail;
    private constructor();
    static open(path: string, required?: boolean): Promise<RecoveryState>;
    save(id: string, record: Record): Promise<void>;
    flush(): Promise<void>;
}
/** Wrap only the public roster seam; mounting still belongs to the running host. */
export declare function installRecovery(ctx: Context, state: RecoveryState, config: RecoveryConfig, host: {
    scopeOf(ctx: Context): unknown;
    message: typeof createUserMessage;
}): RecoveryService;
export declare const name = "super-code-session-recovery";
export declare function apply(ctx: Context, config: RecoveryConfig): void;
declare module '@deepseek-ai/cordis' {
    interface Context {
        superCodeSessionRecovery: RecoveryService;
    }
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-super-code/deletion-protection-revoked': {
            kind: 'dsh-super-code/deletion-protection-revoked';
        };
    }
}
/** Automatic local recovery owns this command; it is not a user submission. */
declare module '@deepseek-ai/dsh-commands' {
    interface CommandSourceMap {
        'dsh-super-code/preset-recovery': {
            kind: 'dsh-super-code/preset-recovery';
        };
    }
}
export {};
//# sourceMappingURL=preset-recovery-runtime.d.ts.map