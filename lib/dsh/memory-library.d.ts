/** User-facing memory API. Workspace identity comes from the host. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { LongMemoryStore } from '../long-memory.js';
import type { LongMemoryEntry, MemoryLibraryChange } from '../long-memory.js';
export interface MemoryLibraryItem {
    topic: string;
    revision: number;
    id: string;
    summary: string;
    kind: LongMemoryEntry['kind'];
}
export type MemoryLibraryDetail = {
    kind: 'missing';
} | {
    kind: 'found';
    entry: MemoryLibraryItem & {
        token: string;
        detail: string;
        source: {
            kind: 'user' | 'tool' | 'manual';
            sessionId: string;
            eventSeq?: number;
        };
        sourceVersion?: string;
    };
};
export declare class MemoryLibraryReader {
    private readonly ctx;
    private readonly store;
    constructor(ctx: Context, store: LongMemoryStore);
    private workspace;
    list(sessionId: string, scope: string): Promise<{
        items: MemoryLibraryItem[];
    }>;
    read(sessionId: string, scope: string, topic: string, id: string): Promise<MemoryLibraryDetail>;
    save(sessionId: string, scope: string, topic: string, id: string, content: string): Promise<MemoryLibraryChange>;
    remove(sessionId: string, scope: string, topic: string, id: string, expected: string): Promise<MemoryLibraryChange>;
}
export declare class SuperCodeMemory extends TypertRemoteService {
    private readonly reader;
    constructor(ctx: Context, store: LongMemoryStore);
    list(sessionId: string, scope: string): Promise<{
        items: MemoryLibraryItem[];
    }>;
    saveEntry(sessionId: string, scope: string, topic: string, id: string, content: string): Promise<MemoryLibraryChange>;
    deleteEntry(sessionId: string, scope: string, topic: string, id: string, expected: string): Promise<MemoryLibraryChange>;
    read(sessionId: string, scope: string, topic: string, id: string): Promise<MemoryLibraryDetail>;
}
//# sourceMappingURL=memory-library.d.ts.map