/** Normalize the two published Harness tool-result layouts at one boundary. */
export type RecordedToolResult = {
    kind: 'record';
    callId: string;
    isError: boolean;
    texts: string[];
} | {
    kind: 'unavailable';
};
export declare function recordedToolResult(message: unknown): RecordedToolResult;
//# sourceMappingURL=host-messages.d.ts.map