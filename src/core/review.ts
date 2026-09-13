import { ProtocolError, stableStringify } from './protocol.js'
import type { JsonObject, ReviewFinding, ReviewRecord } from './protocol.js'

/** Review outcome after independent reviewers and conflict checks are folded. */
export type ReviewSummaryStatus = 'accepted' | 'rejected' | 'inconclusive'

/** Detached result of an independent review collection. */
export interface ReviewSummary {
  readonly status: ReviewSummaryStatus
  readonly reviewerIds: readonly string[]
  readonly independentReviewerIds: readonly string[]
  readonly findings: readonly ReviewFinding[]
  readonly conflicts: readonly ReviewConflict[]
  readonly passedReviews: number
  readonly failedReviews: number
  readonly unverifiedReviews: number
  readonly summary: string
}

/** One location where reviewers reached incompatible conclusions. */
export interface ReviewConflict {
  readonly key: string
  readonly outcomes: readonly ('passed' | 'failed' | 'unverified' | 'stale')[]
  readonly reviewIds: readonly string[]
}

/** Input accepted by {@link normalizeFinding}. */
export interface FindingInput {
  readonly findingId: string
  readonly reviewerId: string
  readonly summary: string
  readonly artifactId?: string
  readonly location?: string
  readonly severity?: ReviewFinding['severity']
}

/** Validate and normalize one finding at a durable boundary. */
export function normalizeFinding(input: FindingInput): ReviewFinding {
  const text = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim() === '') throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT')
    return value.trim()
  }
  if (input.severity !== undefined && !['info', 'low', 'medium', 'high', 'critical'].includes(input.severity)) {
    throw new ProtocolError(`unknown finding severity ${String(input.severity)}`, 'INVALID_ARGUMENT')
  }
  return {
    findingId: text(input.findingId, 'findingId'),
    reviewerId: text(input.reviewerId, 'reviewerId'),
    summary: text(input.summary, 'summary'),
    ...input.artifactId === undefined ? {} : { artifactId: text(input.artifactId, 'artifactId') },
    ...input.location === undefined ? {} : { location: text(input.location, 'location') },
    ...input.severity === undefined ? {} : { severity: input.severity },
  }
}

/** Canonical key used to remove duplicate observations without losing provenance. */
export function findingKey(finding: ReviewFinding): string {
  return [
    finding.artifactId?.trim().toLowerCase() ?? '',
    finding.location?.trim().toLowerCase() ?? '',
    finding.summary.trim().toLowerCase().replace(/\s+/gu, ' '),
  ].join('|')
}

/** De-duplicate findings while retaining the first stable identity and all reviewer sources. */
export function dedupeFindings(findings: readonly ReviewFinding[]): readonly ReviewFinding[] {
  const byKey = new Map<string, ReviewFinding>()
  for (const raw of findings) {
    const finding = normalizeFinding(raw)
    const key = findingKey(finding)
    const prior = byKey.get(key)
    if (prior === undefined) {
      byKey.set(key, finding)
      continue
    }
    // Keep a deterministic first record. Provenance from later reviewers is
    // represented by a compact suffix rather than multiplying the finding row.
    if (prior.reviewerId === finding.reviewerId) continue
    const reviewers = `${prior.reviewerId}, ${finding.reviewerId}`
    byKey.set(key, { ...prior, reviewerId: reviewers })
  }
  return [...byKey.values()]
}

function reviewKey(review: ReviewRecord, finding?: ReviewFinding): string {
  if (finding !== undefined) return findingKey(finding)
  return `review:${review.reviewId}`
}

function bounded(value: string, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ProtocolError('summary limit must be a positive safe integer', 'INVALID_ARGUMENT')
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Fold review conclusions from distinct agents. The function reports
 * `inconclusive` when diversity is insufficient or conclusions conflict; it
 * never treats the task executor's self-check as an independent review.
 */
export function summarizeReviews(
  reviews: readonly ReviewRecord[],
  options: { readonly minimumIndependent?: number; readonly executorId?: string; readonly maxSummaryChars?: number } = {},
): ReviewSummary {
  const minimumIndependent = options.minimumIndependent ?? 2
  if (!Number.isSafeInteger(minimumIndependent) || minimumIndependent < 1) throw new ProtocolError('minimumIndependent must be a positive safe integer', 'INVALID_ARGUMENT')
  const normalized = reviews.map(review => {
    if (typeof review.reviewId !== 'string' || review.reviewId.trim() === '') throw new ProtocolError('reviewId must be a non-empty string', 'INVALID_ARGUMENT')
    if (typeof review.reviewerId !== 'string' || review.reviewerId.trim() === '') throw new ProtocolError('reviewerId must be a non-empty string', 'INVALID_ARGUMENT')
    if (!['passed', 'failed', 'unverified', 'stale'].includes(review.outcome)) throw new ProtocolError(`unknown review outcome ${String(review.outcome)}`, 'INVALID_ARGUMENT')
    if (review.report === null || typeof review.report !== 'object' || Array.isArray(review.report)) throw new ProtocolError('review report must be an object', 'INVALID_ARGUMENT')
    return review
  })
  const reviewerIds = [...new Set(normalized.map(review => review.reviewerId))]
  const independentReviewerIds = [...new Set(normalized.filter(review => review.independent && review.reviewerId !== options.executorId).map(review => review.reviewerId))]
  const findings = dedupeFindings(normalized.flatMap(review => review.findings))
  const byLocation = new Map<string, { outcomes: Set<ReviewRecord['outcome']>; reviewIds: Set<string> }>()
  for (const review of normalized) {
    const observations = review.findings.length === 0 ? [undefined] : review.findings
    for (const finding of observations) {
      const key = reviewKey(review, finding)
      const row = byLocation.get(key) ?? { outcomes: new Set(), reviewIds: new Set() }
      row.outcomes.add(review.outcome)
      row.reviewIds.add(review.reviewId)
      byLocation.set(key, row)
    }
  }
  const conflicts: ReviewConflict[] = []
  for (const [key, row] of byLocation) {
    const outcomes = [...row.outcomes]
    if (outcomes.includes('passed') && outcomes.some(outcome => outcome === 'failed' || outcome === 'stale')) {
      conflicts.push({ key, outcomes, reviewIds: [...row.reviewIds] })
    }
  }
  const passedReviews = normalized.filter(review => review.outcome === 'passed').length
  const failedReviews = normalized.filter(review => review.outcome === 'failed').length
  const unverifiedReviews = normalized.filter(review => review.outcome === 'unverified' || review.outcome === 'stale').length
  const status: ReviewSummaryStatus = independentReviewerIds.length < minimumIndependent || conflicts.length > 0
    ? 'inconclusive'
    : failedReviews > 0 || passedReviews === 0
      ? 'rejected'
      : 'accepted'
  const report: JsonObject = {
    status,
    reviewers: reviewerIds,
    independentReviewers: independentReviewerIds,
    passedReviews,
    failedReviews,
    unverifiedReviews,
    conflicts: conflicts.map(conflict => conflict.key),
    findings: findings.map(finding => ({ key: findingKey(finding), summary: finding.summary })),
  }
  const summary = bounded(stableStringify(report), options.maxSummaryChars ?? 4_000)
  return { status, reviewerIds, independentReviewerIds, findings, conflicts, passedReviews, failedReviews, unverifiedReviews, summary }
}

/** Assert that a review set is sufficient for acceptance. */
export function requireIndependentAcceptance(
  reviews: readonly ReviewRecord[],
  options: { readonly minimumIndependent?: number; readonly executorId?: string } = {},
): ReviewSummary {
  const summary = summarizeReviews(reviews, options)
  if (summary.status !== 'accepted') throw new ProtocolError(`review set is ${summary.status}`, summary.status === 'inconclusive' ? 'REVIEW_INCONCLUSIVE' : 'REVIEW_REJECTED')
  return summary
}
