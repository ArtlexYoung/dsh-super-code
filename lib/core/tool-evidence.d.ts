import type { SessionEvent } from '@deepseek-ai/dsh-session';
export interface ToolEvidenceIdentity {
    seq: number;
    type: 'call' | 'result';
    callId: string;
    turn: number;
    step: number;
    tool?: string;
    arguments?: string;
    truncated?: boolean;
    isError?: boolean;
}
/** Discover identities only on demand; unmatched events remain explicit across pages. */
export declare function listToolEvidence(end: number, before: number, eventAt: (seq: number) => SessionEvent | undefined, signal: AbortSignal): Promise<{
    kind: 'directory';
    records: ToolEvidenceIdentity[];
    nextBeforeSeq: number;
    done: boolean;
    scanned: number;
}>;
export interface ToolEvidenceRef {
    sessionId: string;
    callSeq: number;
    resultSeq: number;
}
export type ToolEvidence = {
    kind: 'recorded';
    ref: string;
    tool: string;
    callId: string;
    time: number;
    outcome: 'tool-returned' | 'tool-error';
    arguments: string;
    output: string;
    truncated: boolean;
    acceptance: 'not-established';
    currentCode: 'not-verified';
    outputChars: number;
    outputView: 'complete' | 'head-tail' | 'page';
    offset?: number;
    readMore?: {
        tool: 'super_code_task';
        action: 'evidence';
        record: {
            ref: string;
            offset: number;
        };
    };
} | {
    kind: 'unavailable';
    reason: string;
};
export declare function toolEvidenceRef(input: ToolEvidenceRef): string;
export declare function parseToolEvidenceRef(ref: string): ToolEvidenceRef;
/** Exact indexed reads only. A genuine tool return is not a test or delivery verdict. */
export declare function readToolEvidence(sessionId: string, ref: string, eventAt: (seq: number) => SessionEvent | undefined, offset?: number): ToolEvidence;
//# sourceMappingURL=tool-evidence.d.ts.map