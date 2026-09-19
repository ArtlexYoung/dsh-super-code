import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { TaskMemoryEvent, TaskMemoryState } from './core/task-memory.js';
type MemoryChange = TaskMemoryEvent | {
    kind: 'unchanged';
    id: string;
    revision: number;
};
export interface MemoryReceipt {
    id: string;
    revision?: number;
    eventSeq?: number;
    unchanged?: true;
}
export interface MemorySnapshot {
    state: TaskMemoryState;
    end: number;
}
/** One session write barrier, including recovery of an unconfirmed checkpoint. */
export declare class TaskMemoryStore {
    private readonly ctx;
    private readonly maxContextBytes;
    private readonly pending;
    private readonly locks;
    constructor(ctx: Context, maxContextBytes: number);
    isPending(session: Session): boolean;
    current(session: Session): TaskMemoryState;
    private checkpoint;
    private access;
    /** Capture a confirmed immutable view; callers perform scans outside the barrier. */
    read(session: Session, signal: AbortSignal): Promise<MemorySnapshot>;
    write(session: Session, signal: AbortSignal, decide: (state: TaskMemoryState) => MemoryChange): Promise<MemoryReceipt>;
}
export {};
//# sourceMappingURL=task-memory-store.d.ts.map