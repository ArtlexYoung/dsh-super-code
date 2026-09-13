import { createHash } from 'node:crypto';
import { ProtocolError, stableStringify } from './protocol.js';
function text(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
    return value.trim();
}
function bounded(value, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new ProtocolError('maxChars must be a positive safe integer', 'INVALID_ARGUMENT');
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
/**
 * Canonicalize an HTTP(S) URL for source de-duplication. Tracking parameters,
 * fragments, default ports, and a terminal slash are removed; meaningful query
 * parameters are sorted while duplicate values remain intact.
 */
export function normalizeUrl(raw) {
    const value = text(raw, 'url');
    let url;
    try {
        url = new URL(value);
    }
    catch (error) {
        throw new ProtocolError(`invalid source URL: ${error instanceof Error ? error.message : String(error)}`, 'INVALID_URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new ProtocolError('source URL must use http or https', 'INVALID_URL');
    if (url.username !== '' || url.password !== '')
        throw new ProtocolError('source URL must not contain credentials', 'INVALID_URL');
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))
        url.port = '';
    const query = [...url.searchParams.entries()]
        .filter(([key]) => !/^utm_/iu.test(key) && !['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase()))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = '';
    for (const [key, item] of query)
        url.searchParams.append(key, item);
    if (url.pathname.length > 1)
        url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
}
/** Deterministic source identity derived from the normalized URL. */
export function sourceIdFor(url) {
    return `source-${createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 24)}`;
}
/** Validate one source input and return its canonical form. */
export function normalizeSource(input) {
    const url = normalizeUrl(input.url);
    const sourceId = input.sourceId === undefined ? sourceIdFor(url) : text(input.sourceId, 'sourceId');
    if (!['primary', 'secondary', 'search'].includes(input.kind))
        throw new ProtocolError(`unknown source kind ${String(input.kind)}`, 'INVALID_ARGUMENT');
    return {
        sourceId,
        url,
        kind: input.kind,
        ...input.title === undefined ? {} : { title: text(input.title, 'title') },
        ...input.publisher === undefined ? {} : { publisher: text(input.publisher, 'publisher') },
        ...input.retrievedAt === undefined ? {} : { retrievedAt: text(input.retrievedAt, 'retrievedAt') },
        ...input.digest === undefined ? {} : { digest: text(input.digest, 'digest') },
    };
}
/**
 * In-memory research ledger. It deliberately performs no network access: a
 * fetcher or web provider records retrieved sources through this API.
 */
export class ResearchLedger {
    sourceMap = new Map();
    claimMap = new Map();
    /** Add or merge a source by its normalized URL. */
    addSource(input) {
        const source = normalizeSource(input);
        const sameUrl = [...this.sourceMap.values()].find(candidate => candidate.url === source.url);
        if (sameUrl !== undefined)
            return { ...sameUrl };
        if (this.sourceMap.has(source.sourceId))
            throw new ProtocolError(`source ${source.sourceId} already exists with another URL`, 'SOURCE_CONFLICT');
        this.sourceMap.set(source.sourceId, source);
        return { ...source };
    }
    /** Add a claim; source ids are checked before it can be marked verified. */
    addClaim(input) {
        const claimId = text(input.claimId, 'claimId');
        const statement = text(input.statement, 'statement');
        const sourceIds = [...new Set(input.sourceIds.map(sourceId => text(sourceId, 'sourceId')))];
        const missing = sourceIds.filter(sourceId => !this.sourceMap.has(sourceId));
        if (missing.length > 0)
            throw new ProtocolError(`claim references unknown source(s): ${missing.join(', ')}`, 'SOURCE_NOT_FOUND');
        if (!['verified', 'supported', 'uncertain', 'contradicted'].includes(input.confidence))
            throw new ProtocolError(`unknown claim confidence ${String(input.confidence)}`, 'INVALID_ARGUMENT');
        const claim = {
            claimId,
            statement,
            sourceIds,
            confidence: input.confidence,
            counterexamples: [...new Set((input.counterexamples ?? []).map(value => text(value, 'counterexample')))],
        };
        const prior = this.claimMap.get(claimId);
        if (prior !== undefined && stableStringify(prior) !== stableStringify(claim))
            throw new ProtocolError(`claim ${claimId} already exists with different content`, 'CLAIM_CONFLICT');
        this.claimMap.set(claimId, claim);
        return { ...claim, sourceIds: [...claim.sourceIds], counterexamples: [...claim.counterexamples] };
    }
    /** Record a counterexample and downgrade the claim's confidence. */
    addCounterexample(claimId, counterexample) {
        const id = text(claimId, 'claimId');
        const value = text(counterexample, 'counterexample');
        const claim = this.claimMap.get(id);
        if (claim === undefined)
            throw new ProtocolError(`unknown claim ${id}`, 'CLAIM_NOT_FOUND');
        const values = [...new Set([...claim.counterexamples, value])];
        const next = { ...claim, counterexamples: values, confidence: 'contradicted' };
        this.claimMap.set(id, next);
        return { ...next, sourceIds: [...next.sourceIds], counterexamples: [...next.counterexamples] };
    }
    /** Return a detached report whose status reflects actual evidence. */
    report(maxChars = 4_000) {
        const sources = [...this.sourceMap.values()].map(source => ({ ...source }));
        const claims = [...this.claimMap.values()].map(claim => ({ ...claim, sourceIds: [...claim.sourceIds], counterexamples: [...claim.counterexamples] }));
        const missingEvidence = claims.filter(claim => claim.sourceIds.length === 0 || claim.confidence === 'uncertain').map(claim => claim.claimId);
        const status = claims.some(claim => claim.confidence === 'contradicted')
            ? 'contradicted'
            : claims.length === 0 || sources.length === 0
                ? 'unverified'
                : missingEvidence.length > 0 || claims.some(claim => claim.confidence === 'supported')
                    ? 'partial'
                    : 'verified';
        const summary = bounded(stableStringify({ status, sources, claims, missingEvidence }), maxChars);
        return { status, sources, claims, missingEvidence, summary };
    }
    /** Export source records as evidence pointers for a task ledger. */
    evidence() {
        return [...this.sourceMap.values()].map(source => ({
            evidenceId: source.sourceId,
            kind: 'source',
            summary: source.title ?? source.url,
            ref: source.url,
            ...source.digest === undefined ? {} : { digest: source.digest },
        }));
    }
}
export default ResearchLedger;
//# sourceMappingURL=research.js.map