/** Bounded public journal reads. Never return streams, reasoning, headers or host configuration. */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { HistoryCursor, HistoryPage } from '../connection/types.js';
export declare function publicMessageText(content: unknown): string;
export declare function connectionHistoryPage(events: readonly SessionEvent[], cursor: HistoryCursor, limit: number): HistoryPage;
//# sourceMappingURL=connection-history.d.ts.map