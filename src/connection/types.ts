import { z } from 'zod'

export interface ConnectionConfig { enabled: boolean; allowNewConversations: boolean; allowCallerApproval: boolean; port: number; allowedDirectories: string[]; knownDirectories: string[]; maxConcurrent: number; maxConnections: number; directoriesConfigured: boolean }
export const connectionConfigSchema: z.ZodType<ConnectionConfig> = z.object({
  enabled: z.boolean(), allowNewConversations: z.boolean().default(true), allowCallerApproval: z.boolean().default(false), port: z.number().int().min(1024).max(65535),
  allowedDirectories: z.array(z.string().min(1).max(4096)).max(32),
  knownDirectories: z.array(z.string().min(1).max(4096)).max(128).default([]),
  maxConcurrent: z.number().int().min(1).max(32),
  maxConnections: z.number().int().min(1).max(32).default(3),
  directoriesConfigured: z.boolean().default(false),
}).strict()
export const defaultConnectionConfig: ConnectionConfig = { enabled: false, allowNewConversations: true, allowCallerApproval: false, port: 23457, allowedDirectories: [], knownDirectories: [], maxConcurrent: 3, maxConnections: 3, directoriesConfigured: false }
export type TaskStatus = 'starting' | 'running' | 'waiting_confirmation' | 'cancelling' | 'finished' | 'failed' | 'cancelled' | 'interrupted' | 'unavailable'
export interface TaskEvent { cursor: number; time: number; status: TaskStatus; message: string }
export interface GitSnapshot { available: boolean; root: string; head: string; fingerprint: string; dirty: string[] }
export interface WorkspaceChanges { available: boolean; baselineDirty: string[]; currentDirty: string[]; changedSinceStart: boolean; headChanged: boolean; diffStat: string; truncated: boolean; attribution: 'workspace-observation' }
export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface DelegatedTask {
  id: string; requestId: string; fingerprint: string; sessionId: string; cwd: string; preset: string; client: string;
  status: TaskStatus; cancellationRequested: boolean; createdAt: number; updatedAt: number; currentRequest: string; output: string;
  sequence: number; events: TaskEvent[]; operations: Record<string, string>; baseline: GitSnapshot;
  connectionId?: string;
  modelSelection?: ModelSelection;
  observation?: ObservationDetails;
}
export interface TaskView {
  taskId: string; sessionId: string; cwd: string; preset: string; client: string; status: TaskStatus;
  createdAt: number; updatedAt: number; output: string; events: TaskEvent[]; cursor: number;
  eventsTruncated: boolean; acceptance: 'not-verified'; workspace: WorkspaceChanges;
  modelSelection?: ModelSelection;
  observation?: ObservationDetails;
  callerApproval: { enabled: boolean; pending: CallerApproval[] };
  nextAction: { action: 'wait' | 'read-history' | 'user-confirmation' | 'caller-approval'; message: string; tool?: string; arguments?: Record<string, string | number> };
}
export interface CallerApproval { id: string; taskId: string; sessionId: string; cwd: string; toolName: string; callId?: string; reason: string; arguments: string; createdAt: number; expiresAt: number }
export type CallerApprovalDecision = 'approve' | 'reject';
export interface ObservationDetails { lastEventSeq: number; lastEventType: string; outputTruncated: boolean; errorCode?: string }
export interface HostObservation { status: 'running' | 'waiting_confirmation' | 'finished' | 'failed' | 'interrupted' | 'unavailable'; output: string; detail: string; observation?: ObservationDetails }
export interface HistoryCursor { seq: number; offset: number }
export interface HistoryEntry { seq: number; type: string; offset: number; totalChars: number; text: string; isError?: boolean }
export interface HistoryPage { entries: HistoryEntry[]; nextCursor: HistoryCursor; hasMore: boolean; scope: 'own-public-events'; sessionId?: string; descendants?: { sessionId: string; kind: string }[]; descendantsTruncated?: boolean }
export interface DelegationHost {
  preset(): Promise<string>;
  create(sessionId: string, cwd: string, preset: string, title?: string): Promise<void>;
  models?(): Promise<unknown>;
  selectModel?(sessionId: string, selection: ModelSelection): Promise<ModelSelection>;
  history?(sessionId: string, cursor: HistoryCursor, limit: number, descendantId?: string): Promise<HistoryPage>;
  prompt(sessionId: string, requestId: string, prompt: string): Promise<void>;
  observe(sessionId: string, requestId: string, cancelling?: boolean): Promise<HostObservation>;
  cancel(sessionId: string): Promise<void>;
}
export class ConnectionError extends Error {
  constructor(public readonly code: string, public readonly details: Record<string, unknown> = {}) { super(code) }
}
export function activeTask(status: TaskStatus): boolean {
  return ['starting', 'running', 'waiting_confirmation', 'cancelling', 'unavailable'].includes(status)
}
