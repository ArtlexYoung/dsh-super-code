import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Budgets } from './budgets.js';
export declare function applyPtcBudget(ctx: Context, policy: Budgets | ((agent?: Agent) => Budgets)): void;
//# sourceMappingURL=ptc-budget.d.ts.map