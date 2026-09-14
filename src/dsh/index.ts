/** Optional Cordis adapter for the pure dsh-super-agent domain services. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TaskGraph } from '../core/task-graph.js'
import type { TaskGraphOptions, TaskInput } from '../core/task-graph.js'
import { Dispatcher } from '../core/dispatcher.js'
import type { DispatcherOptions } from '../core/dispatcher.js'
import { runProgrammingWorkflow } from '../core/programming.js'
import type { ProgrammingWorkflowCallbacks, ProgrammingWorkflowOptions, ProgrammingWorkflowResult } from '../core/programming.js'
import { validateBudget } from '../core/protocol.js'
import type { Budget } from '../core/protocol.js'

/** Cordis plugin name. */
export const name = 'super-agent'
/** This adapter has no mandatory host service; callers opt into graphs explicitly. */
export const inject: readonly string[] = []

const MAX_TIMER_MS = 2_147_000_000

/** Deployment limits for graph and dispatcher instances. */
export interface Config {
  readonly maxTasks?: number
  readonly maxDepth?: number
  readonly maxConcurrent?: number
  readonly timeoutMs?: number
  readonly stopGraceMs?: number
  readonly maxRepairAttempts?: number
  readonly maxFeedbackChars?: number
  readonly maxInputTokens?: number
  readonly maxOutputTokens?: number
  readonly maxTotalTokens?: number
  readonly maxToolCalls?: number
  readonly planning?: 'separate' | 'skip' | 'auto'
}

/** Schemastery config schema; cross-field checks happen in {@link resolveConfig}. */
export const Config: z<Config> = z.object({
  maxTasks: z.number().step(1),
  maxDepth: z.number().step(1),
  maxConcurrent: z.number().step(1),
  timeoutMs: z.number().step(1),
  stopGraceMs: z.number().step(1),
  maxRepairAttempts: z.number().step(1),
  maxFeedbackChars: z.number().step(1),
  maxInputTokens: z.number().step(1),
  maxOutputTokens: z.number().step(1),
  maxTotalTokens: z.number().step(1),
  maxToolCalls: z.number().step(1),
  planning: z.union([z.const('separate'), z.const('skip'), z.const('auto')]),
})

/** Resolved adapter defaults. */
export interface ResolvedConfig {
  readonly maxTasks: number
  readonly maxDepth: number
  readonly maxConcurrent: number
  readonly timeoutMs: number
  readonly stopGraceMs: number
  readonly maxRepairAttempts: number
  readonly maxFeedbackChars: number
  readonly programmingBudget: Budget
  readonly planning: 'separate' | 'skip' | 'auto'
}

function positive(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`super-agent: ${name} must be a positive safe integer`)
  return value
}

function nonNegative(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`super-agent: ${name} must be a non-negative safe integer`)
  return value
}

function timer(name: string, value: number): number {
  const normalized = nonNegative(name, value)
  if (normalized > MAX_TIMER_MS) throw new Error(`super-agent: ${name} must be no greater than ${MAX_TIMER_MS}`)
  return normalized
}

/** Materialize and validate deployment defaults once at load. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const programmingBudget = validateBudget({
    ...config.maxInputTokens === undefined ? {} : { maxInputTokens: nonNegative('maxInputTokens', config.maxInputTokens) },
    ...config.maxOutputTokens === undefined ? {} : { maxOutputTokens: nonNegative('maxOutputTokens', config.maxOutputTokens) },
    ...config.maxTotalTokens === undefined ? {} : { maxTotalTokens: nonNegative('maxTotalTokens', config.maxTotalTokens) },
    ...config.maxToolCalls === undefined ? {} : { maxToolCalls: nonNegative('maxToolCalls', config.maxToolCalls) },
    timeoutMs: timer('timeoutMs', config.timeoutMs ?? 0),
  })
  const planning = config.planning ?? 'separate'
  if (planning !== 'separate' && planning !== 'skip' && planning !== 'auto') throw new Error('super-agent: planning must be separate, skip, or auto')
  return {
    maxTasks: positive('maxTasks', config.maxTasks ?? 256),
    maxDepth: positive('maxDepth', config.maxDepth ?? 32),
    maxConcurrent: positive('maxConcurrent', config.maxConcurrent ?? 8),
    timeoutMs: timer('timeoutMs', config.timeoutMs ?? 0),
    stopGraceMs: timer('stopGraceMs', config.stopGraceMs ?? 100),
    maxRepairAttempts: positive('maxRepairAttempts', config.maxRepairAttempts ?? 2),
    maxFeedbackChars: positive('maxFeedbackChars', config.maxFeedbackChars ?? 2_000),
    programmingBudget,
    planning,
  }
}

/** A graph plus its bounded dispatcher, owned by one adapter scope. */
export interface SuperAgentWorkspace {
  readonly scope: string
  readonly graph: TaskGraph
  readonly dispatcher: Dispatcher
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    superAgent: SuperAgentService
  }
}

/**
 * Host-plane service that owns optional task graphs. It intentionally does not
 * create agents, run models, or grant tools; those remain Harness capabilities.
 */
export class SuperAgentService extends Service {
  private readonly resolved: ResolvedConfig
  private readonly workspaces = new Map<string, SuperAgentWorkspace>()
  private closing = false

  /**
   * @param ctx - Cordis context receiving `ctx.superAgent`.
   * @param config - deployment limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'superAgent')
    this.resolved = resolveConfig(config)
    ctx.effect(() => () => {
      this.closing = true
      this.workspaces.clear()
    }, 'super-agent.workspaces()')
  }

  /**
   * Create or return one scope-local workspace. Scope names are explicit and
   * never inferred from ambient agent state.
   * @param scope - caller-selected workspace identity.
   * @param inputs - optional initial task definitions.
   * @returns the owned graph and dispatcher.
   */
  workspace(scope = 'default', inputs: readonly TaskInput[] = []): SuperAgentWorkspace {
    if (this.closing) throw new Error('super-agent service is disposed')
    if (typeof scope !== 'string' || scope.trim() === '') throw new Error('workspace scope must be a non-empty string')
    const key = scope.trim()
    const existing = this.workspaces.get(key)
    if (existing !== undefined) {
      if (inputs.length > 0) throw new Error(`workspace ${key} already exists; use its graph to add tasks`)
      return existing
    }
    const graphOptions: TaskGraphOptions = {
      scope: key,
      maxTasks: this.resolved.maxTasks,
      maxDepth: this.resolved.maxDepth,
    }
    const graph = new TaskGraph(inputs, graphOptions)
    const dispatcher = new Dispatcher(graph, {
      maxConcurrent: this.resolved.maxConcurrent,
      timeoutMs: this.resolved.timeoutMs,
      stopGraceMs: this.resolved.stopGraceMs,
    } satisfies DispatcherOptions)
    const workspace = { scope: key, graph, dispatcher }
    this.workspaces.set(key, workspace)
    return workspace
  }

  /** List currently owned workspaces by creation order. */
  listWorkspaces(): readonly string[] {
    return [...this.workspaces.keys()]
  }

  /** Remove one workspace and its in-memory event log. */
  removeWorkspace(scope: string): void {
    const key = scope.trim()
    if (!this.workspaces.delete(key)) throw new Error(`workspace ${key} does not exist`)
  }

  /**
   * Run the provider-neutral programming loop inside this service scope. The
   * caller supplies model generation and local verification callbacks.
   */
  programmingWorkflow(task: string, callbacks: ProgrammingWorkflowCallbacks, options: ProgrammingWorkflowOptions = {}, signal?: AbortSignal): Promise<ProgrammingWorkflowResult> {
    const mergedBudget: Budget = { ...this.resolved.programmingBudget, ...options.budget }
    return runProgrammingWorkflow(task, callbacks, {
      ...options,
      maxRepairAttempts: options.maxRepairAttempts ?? this.resolved.maxRepairAttempts,
      maxFeedbackChars: options.maxFeedbackChars ?? this.resolved.maxFeedbackChars,
      planning: options.planning ?? this.resolved.planning,
      budget: mergedBudget,
    }, signal)
  }
}

/** Cordis function-plugin entry. */
export function apply(ctx: Context, config: Config = {}): void {
  new SuperAgentService(ctx, config)
}

export default apply
