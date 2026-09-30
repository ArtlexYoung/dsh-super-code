/** User-facing, read-only memory API. Workspace identity comes from the host. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { LongMemoryStore } from '../long-memory.js';
import type { LongMemoryEntry } from '../long-memory.js';
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
        detail: string;
        source: {
            kind: 'user' | 'tool';
            sessionId: string;
            eventSeq: number;
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
}
export declare class SuperCodeMemory extends TypertRemoteService {
    private readonly reader;
    constructor(ctx: Context, store: LongMemoryStore);
    list(sessionId: string, scope: string): Promise<{
        items: MemoryLibraryItem[];
    }>;
    read(sessionId: string, scope: string, topic: string, id: string): Promise<MemoryLibraryDetail>;
}
//# sourceMappingURL=memory-library.d.ts.map