import { ProtocolError, stableStringify } from './protocol.js';
/** Validate and normalize one finding at a durable boundary. */
export function normalizeFinding(input) {
    const text = (value, field) => {
        if (typeof value !== 'string' || value.trim() === '')
            throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
        return value.trim();
    };
    if (input.severity !== undefined && !['info', 'low', 'medium', 'high', 'critical'].includes(input.severity)) {
        throw new ProtocolError(`unknown finding severity ${String(input.severity)}`, 'INVALID_ARGUMENT');
    }
    return {
        findingId: text(input.findingId, 'findingId'),
        reviewerId: text(input.reviewerId, 'reviewerId'),
        summary: text(input.summary, 'summary'),
        ...input.artifactId === undefined ? {} : { artifactId: text(input.artifactId, 'artifactId') },
        ...input.location === undefined ? {} : { location: text(input.location, 'location') },
        ...input.severity === undefined ? {} : { severity: input.severity },
    };
}
/** Canonical key used to remove duplicate observations without losing provenance. */
export function findingKey(finding) {
    return [
        finding.artifactId?.trim().toLowerCase() ?? '',
        finding.location?.trim().toLowerCase() ?? '',
        finding.summary.trim().toLowerCase().replace(/\s+/gu, ' '),
    ].join('|');
}
/** De-duplicate findings while retaining the first stable identity and all reviewer sources. */
export function dedupeFindings(findings) {
    const byKey = new Map();
    for (const raw of findings) {
        const finding = normalizeFinding(raw);
        const key = findingKey(finding);
        const prior = byKey.get(key);
        if (prior === undefined) {
            byKey.set(key, finding);
            continue;
        }
        // Keep a deterministic first record. Provenance from later reviewers is
        // represented by a compact suffix rather than multiplying the finding row.
        if (prior.reviewerId === finding.reviewerId)
            continue;
        const reviewers = `${prior.reviewerId}, ${finding.reviewerId}`;
        byKey.set(key, { ...prior, reviewerId: reviewers });
    }
    return [...byKey.values()];
}
function reviewKey(review, finding) {
    if (finding !== undefined)
        return findingKey(finding);
    return `review:${review.reviewId}`;
}
function bounded(value, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new ProtocolError('summary limit must be a positive safe integer', 'INVALID_ARGUMENT');
    return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}
/**
 * Fold review conclusions from distinct agents. The function reports
 * `inconclusive` when diversity is insufficient or conclusions conflict; it
 * never treats the task executor's self-check as an independent review.
 */
export function summarizeReviews(reviews, options = {}) {
    const minimumIndependent = options.minimumIndependent ?? 2;
    if (!Number.isSafeInteger(minimumIndependent) || minimumIndependent < 1)
        throw new ProtocolError('minimumIndependent must be a positive safe integer', 'INVALID_ARGUMENT');
    const normalized = reviews.map(review => {
        if (typeof review.reviewId !== 'string' || review.reviewId.trim() === '')
            throw new ProtocolError('reviewId must be a non-empty string', 'INVALID_ARGUMENT');
        if (typeof review.reviewerId !== 'string' || review.reviewerId.trim() === '')
            throw new ProtocolError('reviewerId must be a non-empty string', 'INVALID_ARGUMENT');
        if (!['passed', 'failed', 'unverified', 'stale'].includes(review.outcome))
            throw new ProtocolError(`unknown review outcome ${String(review.outcome)}`, 'INVALID_ARGUMENT');
        if (review.report === null || typeof review.report !== 'object' || Array.isArray(review.report))
            throw new ProtocolError('review report must be an object', 'INVALID_ARGUMENT');
        return review;
    });
    const reviewerIds = [...new Set(normalized.map(review => review.reviewerId))];
    const independentReviewerIds = [...new Set(normalized.filter(review => review.independent && review.reviewerId !== options.executorId).map(review => review.reviewerId))];
    const findings = dedupeFindings(normalized.flatMap(review => review.findings));
    const byLocation = new Map();
    for (const review of normalized) {
        const observations = review.findings.length === 0 ? [undefined] : review.findings;
        for (const finding of observations) {
            const key = reviewKey(review, finding);
            const row = byLocation.get(key) ?? { outcomes: new Set(), reviewIds: new Set() };
            row.outcomes.add(review.outcome);
            row.reviewIds.add(review.reviewId);
            byLocation.set(key, row);
        }
    }
    const conflicts = [];
    for (const [key, row] of byLocation) {
        const outcomes = [...row.outcomes];
        if (outcomes.includes('passed') && outcomes.some(outcome => outcome === 'failed' || outcome === 'stale')) {
            conflicts.push({ key, outcomes, reviewIds: [...row.reviewIds] });
        }
    }
    const passedReviews = normalized.filter(review => review.outcome === 'passed').length;
    const failedReviews = normalized.filter(review => review.outcome === 'failed').length;
    const unverifiedReviews = normalized.filter(review => review.outcome === 'unverified' || review.outcome === 'stale').length;
    const status = independentReviewerIds.length < minimumIndependent || conflicts.length > 0
        ? 'inconclusive'
        : failedReviews > 0 || passedReviews === 0
            ? 'rejected'
            : 'accepted';
    const report = {
        status,
        reviewers: reviewerIds,
        independentReviewers: independentReviewerIds,
        passedReviews,
        failedReviews,
        unverifiedReviews,
        conflicts: conflicts.map(conflict => conflict.key),
        findings: findings.map(finding => ({ key: findingKey(finding), summary: finding.summary })),
    };
    const summary = bounded(stableStringify(report), options.maxSummaryChars ?? 4_000);
    return { status, reviewerIds, independentReviewerIds, findings, conflicts, passedReviews, failedReviews, unverifiedReviews, summary };
}
/** Assert that a review set is sufficient for acceptance. */
export function requireIndependentAcceptance(reviews, options = {}) {
    const summary = summarizeReviews(reviews, options);
    if (summary.status !== 'accepted')
        throw new ProtocolError(`review set is ${summary.status}`, summary.status === 'inconclusive' ? 'REVIEW_INCONCLUSIVE' : 'REVIEW_REJECTED');
    return summary;
}
//# sourceMappingURL=review.js.map