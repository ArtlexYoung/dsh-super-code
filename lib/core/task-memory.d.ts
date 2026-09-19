import { z } from 'zod';
import type { TeamName, WorkDepth } from './teams.js';
export interface TaskSource {
    seq: number;
    quote: string;
}
export interface Requirement {
    id: string;
    text: string;
    source: TaskSource;
}
export interface TaskEvidence {
    summary: string;
    ref: string;
    sourceVersion: string;
    requirementsRevision: number;
    kind: 'observed' | 'assumption' | 'test' | 'decision';
}
export interface TaskMemory {
    id: string;
    title: string;
    team: TeamName;
    depth: WorkDepth;
    workspace: string;
    sourceVersion: string;
    goal: string;
    createdAtSeq: number;
    source: TaskSource;
    requirements: Requirement[];
    acceptance: string[];
    decisions: string[];
    evidence: TaskEvidence[];
    next: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    revision: number;
    requirementsRevision: number;
    delegationRevision: number;
}
export interface TaskMemoryState {
    tasks: Record<string, TaskMemory>;
    recentSources: number[];
    focus: {
        kind: 'none';
    } | {
        kind: 'task';
        id: string;
    };
}
export type TaskMemoryEvent = {
    kind: 'save';
    task: TaskMemory;
} | {
    kind: 'focus';
    id: string;
} | {
    kind: 'archive';
    task: TaskMemory;
};
export type TaskMemoryCreate = Omit<TaskMemory, 'createdAtSeq' | 'revision' | 'requirementsRevision' | 'delegationRevision' | 'status' | 'evidence' | 'decisions' | 'next'>;
export type TaskMemoryPatch = Partial<Omit<TaskMemory, 'id' | 'createdAtSeq' | 'revision' | 'requirementsRevision' | 'delegationRevision'>> & {
    removeRequirements?: string[];
};
export declare const sourceSchema: z.ZodType<TaskSource>;
export declare const requirementSchema: z.ZodType<Requirement>;
export declare const taskMemorySchema: z.ZodType<TaskMemory>;
/** A bounded working set. Archived complete records remain in the host log. */
export declare const taskMemoryStateSchema: z.ZodType<TaskMemoryState>;
export declare const taskMemoryEventSchema: z.ZodType<TaskMemoryEvent>;
export declare const taskMemoryCreateSchema: z.ZodType<TaskMemoryCreate>;
export declare const taskMemoryPatchSchema: z.ZodType<TaskMemoryPatch>;
export declare function emptyTaskMemory(): TaskMemoryState;
export declare function requireTaskMemory(state: TaskMemoryState, taskId: string): TaskMemory;
/** Replace only explicitly named requirements; unchanged constraints retain their sources. */
export declare function reviseTaskMemory(task: TaskMemory, patch: TaskMemoryPatch, expectedRevision: number): TaskMemory;
/** Deterministic replay; old evidence stays recorded but is never current after revision. */
export declare function foldTaskMemory(state: TaskMemoryState, input: TaskMemoryEvent): TaskMemoryState;
/** Read a bounded recovery view without changing focus or the durable record. */
export declare function taskMemoryRead(task: TaskMemory, maxBytes: number): string;
/** Compact current state; full sources and evidence remain available via read(view=full). */
export declare function taskMemoryContext(state: TaskMemoryState, maxBytes: number): string;
//# sourceMappingURL=task-memory.d.ts.map