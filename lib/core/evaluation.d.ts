import { z } from 'zod';
export interface EvaluationUsage {
    uncachedInput: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
}
export interface EvaluationIdentity {
    preset: string;
    version: string;
    artifact: string;
}
export interface EvaluationConditions {
    task: string;
    evaluator: string;
    model: string;
    reasoning: string;
    tools: string;
    resources: string;
    environment: string;
    harness: string;
}
export interface EvaluationRate extends EvaluationUsage {
    id: string;
    provider: string;
    model: string;
    currency: string;
    source: string;
    effectiveAt: string;
    perRequest: number;
}
export interface EvaluationRequest {
    id: string;
    sessionId: string;
    attemptId: string;
    kind: 'root' | 'member' | 'retry' | 'compaction';
    provider: string;
    model: string;
    rateId?: string;
    usage?: EvaluationUsage;
    toolCharge?: number;
}
export interface SuperCodeManifest {
    protocol: 'super-code/v3';
    baseline: EvaluationIdentity;
    candidate: EvaluationIdentity;
    cases: {
        taskId: string;
        category: string;
        conditions: EvaluationConditions;
    }[];
    gates: {
        minAccuracyUplift: number;
        maxLostSuccesses: number;
        minCostReduction?: number;
        minLatencyReduction?: number;
    };
    rates: EvaluationRate[];
}
export interface SuperCodeMeasurement {
    protocol: 'super-code/v3';
    side: 'baseline' | 'candidate';
    identity: EvaluationIdentity;
    taskId: string;
    category: string;
    conditions: EvaluationConditions;
    mode: 'real' | 'mock' | 'replay';
    outcome: 'passed' | 'failed' | 'agent_failed' | 'audit_failed' | 'infrastructure_error' | 'evaluation_error' | 'unknown';
    latencyMs: number;
    expectedRequests: string[];
    requestManifestComplete: boolean;
    requests: EvaluationRequest[];
}
export declare const evaluationManifestSchema: z.ZodType<SuperCodeManifest>;
export declare const evaluationMeasurementSchema: z.ZodType<SuperCodeMeasurement>;
export interface EvaluationSide {
    recorded: number;
    scored: number;
    passed: number;
    attempts: number;
    requests: number;
    expectedRequests: number;
    latencyMs: number;
    tokens: EvaluationUsage;
    outcomes: Record<string, number>;
    accounting: {
        status: 'measured';
        currency: string;
        amount: number;
    } | {
        status: 'unmeasured';
        reasons: string[];
    };
}
export interface EvaluationPairs {
    paired: number;
    gained: string[];
    lost: string[];
    unchanged: string[];
    unscored: string[];
}
export interface SuperCodeBatchResult {
    status: 'incomplete' | 'unmatched' | 'unmeasured' | 'measured';
    accepted: boolean;
    reasons: string[];
    planned: number;
    baseline: EvaluationSide;
    candidate: EvaluationSide;
    pairs: EvaluationPairs;
    categories: Record<string, {
        paired: number;
        gained: number;
        lost: number;
    }>;
    checks: {
        quality: boolean;
        cost: boolean;
        latency: boolean;
    };
}
/** Fixed sides, fixed gates, full coverage. Partial reports never imply a release pass. */
export declare function evaluateSuperCodeBatch(input: SuperCodeManifest, measurements: readonly SuperCodeMeasurement[]): SuperCodeBatchResult;
//# sourceMappingURL=evaluation.d.ts.map