/** Change pressure policy while retaining the host's compaction transaction. */
import type { Context } from '@deepseek-ai/cordis';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { CompactionEngine } from '@deepseek-ai/dsh-compaction';
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session';
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import { budgetSchema } from './budgets.js';
import type { Budgets } from './budgets.js';
export declare const name = "super-code-compaction";
export declare const inject: readonly string[];
export declare const Config: typeof budgetSchema;
/** Preserve the system head and extend the retained tail to a balanced tool boundary. */
export declare function compactableRange(session: Session, measurement: TokenMeasurement, retainTokens: number): {
    start: SessionSeq;
    end: SessionSeq;
} | {
    kind: 'none';
};
export declare class BudgetCompactionEngine extends BasicCompactionEngine {
    private readonly budgets;
    constructor(ctx: Context, budgets?: Budgets);
    compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
}
/** Share the window policy with an official engine without replacing its transaction or listeners. */
export declare function compactByWindow(engine: BasicCompactionEngine, budgets: Budgets, agent: Agent, signal: AbortSignal): Promise<CompactionResult | null>;
/** Retained preset generations share this router, while each Agent owns its host engine. */
export declare class AgentBudgetCompaction extends CompactionEngine {
    private readonly overrides;
    private readonly engines;
    constructor(ctx: Context, overrides?: Budgets);
    forAgent(agent: Agent): Promise<BudgetCompactionEngine>;
    compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
    compactRegion(start: SessionSeq, end: SessionSeq, agent: Agent, signal?: AbortSignal): Promise<CompactionResult>;
    compactNow(agent: Agent, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null>;
}
export declare function apply(ctx: Context, config?: Budgets): void;
//# sourceMappingURL=compaction.d.ts.map