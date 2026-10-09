/**
 * Small, host-facing classification for calls assembled by one PTC program.
 * The Harness owns scheduling; this module only declares whether an action is
 * safe to overlap. Unknown actions stay exclusive by default.
 */
export type BatchActionKind = 'read' | 'write' | 'test' | 'unknown';
export type BatchSafety = 'parallel' | 'exclusive';
/** Classify task-ledger actions. Validation is a read of the current snapshot. */
export declare function classifyTaskAction(action: string): BatchActionKind;
/** Classify durable-memory actions. Unknown scopes/actions remain exclusive. */
export declare function classifyMemoryAction(action: string): BatchActionKind;
/** Only explicitly read-only calls may overlap in the host scheduler. */
export declare function batchSafety(kind: BatchActionKind): BatchSafety;
//# sourceMappingURL=batch-policy.d.ts.map