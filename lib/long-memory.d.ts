import type { DomainTableSpec, KvTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
export interface LongMemoryEntry {
    id: string;
    kind: 'constraint' | 'fact' | 'experience';
    summary: string;
    detail: string;
    source: {
        sessionId: string;
        eventSeq: number;
        kind: 'user';
        quote: string;
    } | {
        sessionId: string;
        eventSeq: number;
        kind: 'tool';
        callSeq: number;
    };
    sourceVersion?: string;
}
export declare const longMemoryEntrySchema: z.ZodType<LongMemoryEntry>;
export interface LongMemoryTopic {
    workspace: string;
    topic: string;
    revision: number;
    entries: LongMemoryEntry[];
}
export type LongMemoryRead = {
    kind: 'found';
    value: LongMemoryTopic;
} | {
    kind: 'missing';
};
export declare const longMemoryTopicSchema: z.ZodType<LongMemoryTopic>;
/** One atomic record per topic; workspaces and profiles remain separate. */
export declare const longMemoryDomainSpec: {
    readonly name: string;
    readonly version: number;
    readonly layout: 'per-record';
    readonly tables: {
        readonly topics: DomainTableSpec<string, LongMemoryTopic>;
    };
};
/** Canonical identity of the session's current workspace, never a tool-supplied path. */
export declare function memoryWorkspace(session: {
    readonly header: {
        readonly cwd?: string;
    };
}): string;
/**
 * Global memory is isolated by the host's configured storage root. The
 * standard Harness bundle puts that root under DSH_HOME/storages; a constant
 * namespace here shares preferences across projects and profiles using it.
 */
export declare const GLOBAL_MEMORY_NAMESPACE: string;
export declare const GLOBAL_PREFERENCES_TOPIC = "preferences";
export declare function memoryGlobalNamespace(): string;
/** A single host-owned writer serializes topic creation and revision checks. */
export declare class LongMemoryStore {
    private readonly table;
    private tail;
    constructor(table: KvTable<string, LongMemoryTopic>);
    topics(workspace: string): {
        topic: string;
        revision: number;
        count: number;
    }[];
    read(workspace: string, topic: string): LongMemoryRead;
    private mutate;
    remember(workspace: string, topic: string, expectedRevision: number, entries: LongMemoryEntry[]): Promise<LongMemoryTopic>;
    forget(workspace: string, topic: string, expectedRevision: number, entryId: string): Promise<LongMemoryTopic>;
}
/** Bound context keeps the entry identity and historical status within 2 KiB. */
export declare function longMemoryContext(topic: LongMemoryTopic | undefined, maxBytes?: number, currentVersion?: string): string;
//# sourceMappingURL=long-memory.d.ts.map