/** Action-local help and pure input preparation, before task barriers or persistence. */
import { z } from 'zod';
import type { TaskMemoryCreate, TaskMemoryPatch, TaskSource } from '../core/task-memory.js';
import type { MemberAssignment, MemberResult } from '../core/delegation.js';
import type { LongMemoryEntry } from '../long-memory.js';
export interface ActionInput {
    action: string;
    [key: string]: unknown;
}
/** No session, storage, model or filesystem access. */
export declare function actionHelp(tool: 'super_code_task' | 'super_code_memory', action: string): string;
/** Validate top-level combinations before any checkpoint can be retried. */
export declare function assertActionInput(tool: 'super_code_task' | 'super_code_memory', args: ActionInput): void;
export interface PreparedTaskRecord {
    create?: TaskMemoryCreate;
    patch?: TaskMemoryPatch;
    restore?: {
        source: TaskSource;
        sourceVersion: string;
    };
    assignment?: MemberAssignment;
    member?: {
        assignment: MemberAssignment;
        result: MemberResult;
    };
    evidence?: {
        ref: string;
        offset?: number;
    } | {
        callSeq: number;
        resultSeq: number;
        offset?: number;
    };
}
export declare function prepareTaskRecord(args: ActionInput): PreparedTaskRecord;
export interface PreparedMemoryRecord {
    topics?: {
        offset: number;
    };
    remember?: {
        expectedRevision: number;
        globalConfirmed?: boolean;
        entries: LongMemoryEntry[];
    };
    forget?: {
        expectedRevision: number;
        source: TaskSource;
    };
}
export declare function prepareMemoryRecord(args: ActionInput, sessionId: string): PreparedMemoryRecord;
/** Schema-owned diagnostics and a small example; submitted values are never echoed. */
export declare function invalidInput(tool: 'super_code_task' | 'super_code_memory', action: string, error: z.ZodError): Error;
//# sourceMappingURL=tool-contracts.d.ts.map