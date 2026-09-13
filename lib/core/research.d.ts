import type { JsonObject } from './protocol.js';
/** A normalized source reference retained by the research ledger. */
export interface SourceRecord {
    readonly sourceId: string;
    readonly url: string;
    readonly title?: string;
    readonly publisher?: string;
    readonly retrievedAt?: string;
    readonly digest?: string;
    readonly kind: 'primary' | 'secondary' | 'search';
}
/** One conclusion and the source ids that support or contradict it. */
export interface ResearchClaim {
    readonly claimId: string;
    readonly statement: string;
    readonly sourceIds: readonly string[];
    readonly confidence: 'verified' | 'supported' | 'uncertain' | 'contradicted';
    readonly counterexamples: readonly string[];
}
/** Bounded report suitable for a model context or an audit record. */
export interface ResearchReport {
    readonly status: 'verified' | 'partial' | 'unverified' | 'contradicted';
    readonly sources: readonly SourceRecord[];
    readonly claims: readonly ResearchClaim[];
    readonly missingEvidence: readonly string[];
    readonly summary: string;
}
/**
 * Canonicalize an HTTP(S) URL for source de-duplication. Tracking parameters,
 * fragments, default ports, and a terminal slash are removed; meaningful query
 * parameters are sorted while duplicate values remain intact.
 */
export declare function normalizeUrl(raw: string): string;
/** Deterministic source identity derived from the normalized URL. */
export declare function sourceIdFor(url: string): string;
/** Validate one source input and return its canonical form. */
export declare function normalizeSource(input: Omit<SourceRecord, 'sourceId'> & {
    readonly sourceId?: string;
}): SourceRecord;
/**
 * In-memory research ledger. It deliberately performs no network access: a
 * fetcher or web provider records retrieved sources through this API.
 */
export declare class ResearchLedger {
    private readonly sourceMap;
    private readonly claimMap;
    /** Add or merge a source by its normalized URL. */
    addSource(input: Omit<SourceRecord, 'sourceId'> & {
        readonly sourceId?: string;
    }): SourceRecord;
    /** Add a claim; source ids are checked before it can be marked verified. */
    addClaim(input: Omit<ResearchClaim, 'counterexamples'> & {
        readonly counterexamples?: readonly string[];
    }): ResearchClaim;
    /** Record a counterexample and downgrade the claim's confidence. */
    addCounterexample(claimId: string, counterexample: string): ResearchClaim;
    /** Return a detached report whose status reflects actual evidence. */
    report(maxChars?: number): ResearchReport;
    /** Export source records as evidence pointers for a task ledger. */
    evidence(): readonly JsonObject[];
}
export default ResearchLedger;
//# sourceMappingURL=research.d.ts.map