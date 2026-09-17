import type { EvaluationAggregate, EvaluationGateResult, EvaluationThresholds } from './evaluation.js';
import type { TeamName } from './teams.js';
/** All comparison conditions must be fixed before executing either side. */
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
export interface SuperCodeManifest {
    protocol: 'super-code/v2';
    cases: {
        taskId: string;
        category: string;
        conditions: EvaluationConditions;
    }[];
    baselineVersion: string;
    candidateVersion: string;
}
export interface SuperCodeMeasurement {
    protocol: 'super-code/v2';
    preset: 'minimal' | 'super-code';
    taskId: string;
    category: string;
    mode: 'real' | 'mock' | 'replay';
    version: string;
    conditions: EvaluationConditions;
    outcome: 'passed' | 'failed' | 'infrastructure_error';
    /** Inclusive across root, members, retries, retrieval and memory maintenance. */
    cost: {
        uncachedInput: number;
        cachedInput: number;
        output: number;
        toolCalls: number;
        latencyMs: number;
        complete: boolean;
    };
    /** Diagnostics only; never used to choose the winner or filter a case. */
    team?: TeamName;
}
export type SuperCodeBatchResult = {
    status: 'incomplete' | 'unmatched' | 'unmeasured';
    accepted: false;
    reasons: string[];
} | {
    status: 'measured';
    accepted: boolean;
    aggregate: EvaluationAggregate;
    gate: EvaluationGateResult;
    categories: Record<string, EvaluationAggregate>;
};
/** One fixed candidate per case; partial or mismatched evidence can never pass release. */
export declare function evaluateSuperCodeBatch(input: SuperCodeManifest, measurements: readonly SuperCodeMeasurement[], thresholds?: EvaluationThresholds): SuperCodeBatchResult;
//# sourceMappingURL=evaluation-v2.d.ts.map