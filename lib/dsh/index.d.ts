/** Optional Cordis adapter for the pure dsh-super-agent domain services. */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TaskGraph } from '../core/task-graph.js';
import type { TaskInput } from '../core/task-graph.js';
import { Dispatcher } from '../core/dispatcher.js';
import type { ProgrammingWorkflowCallbacks, ProgrammingWorkflowOptions, ProgrammingWorkflowResult } from '../core/programming.js';
import type { Budget } from '../core/protocol.js';
/** Cordis plugin name. */
export declare const name = "super-agent";
/** This adapter has no mandatory host service; callers opt into graphs explicitly. */
export declare const inject: readonly string[];
/** Deployment limits for graph and dispatcher instances. */
export interface Config {
    readonly maxTasks?: number;
    readonly maxDepth?: number;
    readonly maxConcurrent?: number;
    readonly timeoutMs?: number;
    readonly stopGraceMs?: number;
    readonly maxRepairAttempts?: number;
    readonly maxFeedbackChars?: number;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly maxTotalTokens?: number;
    readonly maxToolCalls?: number;
}
/** Schemastery config schema; cross-field checks happen in {@link resolveConfig}. */
export declare const Config: z<Config>;
/** Resolved adapter defaults. */
export interface ResolvedConfig {
    readonly maxTasks: number;
    readonly maxDepth: number;
    readonly maxConcurrent: number;
    readonly timeoutMs: number;
    readonly stopGraceMs: number;
    readonly maxRepairAttempts: number;
    readonly maxFeedbackChars: number;
    readonly programmingBudget: Budget;
}
/** Materialize and validate deployment defaults once at load. */
export declare function resolveConfig(config?: Config): ResolvedConfig;
/** A graph plus its bounded dispatcher, owned by one adapter scope. */
export interface SuperAgentWorkspace {
    readonly scope: string;
    readonly graph: TaskGraph;
    readonly dispatcher: Dispatcher;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        superAgent: SuperAgentService;
    }
}
/**
 * Host-plane service that owns optional task graphs. It intentionally does not
 * create agents, run models, or grant tools; those remain Harness capabilities.
 */
export declare class SuperAgentService extends Service {
    private readonly resolved;
    private readonly workspaces;
    private closing;
    /**
     * @param ctx - Cordis context receiving `ctx.superAgent`.
     * @param config - deployment limits.
     */
    constructor(ctx: Context, config?: Config);
    /**
     * Create or return one scope-local workspace. Scope names are explicit and
     * never inferred from ambient agent state.
     * @param scope - caller-selected workspace identity.
     * @param inputs - optional initial task definitions.
     * @returns the owned graph and dispatcher.
     */
    workspace(scope?: string, inputs?: readonly TaskInput[]): SuperAgentWorkspace;
    /** List currently owned workspaces by creation order. */
    listWorkspaces(): readonly string[];
    /** Remove one workspace and its in-memory event log. */
    removeWorkspace(scope: string): void;
    /**
     * Run the provider-neutral programming loop inside this service scope. The
     * caller supplies model generation and local verification callbacks.
     */
    programmingWorkflow(task: string, callbacks: ProgrammingWorkflowCallbacks, options?: ProgrammingWorkflowOptions, signal?: AbortSignal): Promise<ProgrammingWorkflowResult>;
}
/** Cordis function-plugin entry. */
export declare function apply(ctx: Context, config?: Config): void;
export default apply;
//# sourceMappingURL=index.d.ts.map