import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Bounded backward lookup; yield between chunks so cancellation stays responsive. */
export declare function scanSessionPage(end: number, before: number, eventAt: (seq: number) => SessionEvent | undefined, visit: (event: SessionEvent) => boolean, signal: AbortSignal): Promise<{
    nextBeforeSeq: number;
    done: boolean;
    scanned: number;
}>;
//# sourceMappingURL=session-scan.d.ts.map