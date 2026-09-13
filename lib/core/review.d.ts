import type { ReviewFinding, ReviewRecord } from './protocol.js';
/** Review outcome after independent reviewers and conflict checks are folded. */
export type ReviewSummaryStatus = 'accepted' | 'rejected' | 'inconclusive';
/** Detached result of an independent review collection. */
export interface ReviewSummary {
    readonly status: ReviewSummaryStatus;
    readonly reviewerIds: readonly string[];
    readonly independentReviewerIds: readonly string[];
    readonly findings: readonly ReviewFinding[];
    readonly conflicts: readonly ReviewConflict[];
    readonly passedReviews: number;
    readonly failedReviews: number;
    readonly unverifiedReviews: number;
    readonly summary: string;
}
/** One location where reviewers reached incompatible conclusions. */
export interface ReviewConflict {
    readonly key: string;
    readonly outcomes: readonly ('passed' | 'failed' | 'unverified' | 'stale')[];
    readonly reviewIds: readonly string[];
}
/** Input accepted by {@link normalizeFinding}. */
export interface FindingInput {
    readonly findingId: string;
    readonly reviewerId: string;
    readonly summary: string;
    readonly artifactId?: string;
    readonly location?: string;
    readonly severity?: ReviewFinding['severity'];
}
/** Validate and normalize one finding at a durable boundary. */
export declare function normalizeFinding(input: FindingInput): ReviewFinding;
/** Canonical key used to remove duplicate observations without losing provenance. */
export declare function findingKey(finding: ReviewFinding): string;
/** De-duplicate findings while retaining the first stable identity and all reviewer sources. */
export declare function dedupeFindings(findings: readonly ReviewFinding[]): readonly ReviewFinding[];
/**
 * Fold review conclusions from distinct agents. The function reports
 * `inconclusive` when diversity is insufficient or conclusions conflict; it
 * never treats the task executor's self-check as an independent review.
 */
export declare function summarizeReviews(reviews: readonly ReviewRecord[], options?: {
    readonly minimumIndependent?: number;
    readonly executorId?: string;
    readonly maxSummaryChars?: number;
}): ReviewSummary;
/** Assert that a review set is sufficient for acceptance. */
export declare function requireIndependentAcceptance(reviews: readonly ReviewRecord[], options?: {
    readonly minimumIndependent?: number;
    readonly executorId?: string;
}): ReviewSummary;
//# sourceMappingURL=review.d.ts.map