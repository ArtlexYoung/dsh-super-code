import { z } from 'zod';
import { aggregateEvaluationRuns, evaluateReleaseGate } from './evaluation.js';
import { TEAM_NAMES } from './teams.js';
const label = z.string().trim().min(1);
const conditions = z.object({ task: label, evaluator: label, model: label, reasoning: label, tools: label, resources: label, environment: label, harness: label }).strict();
const nonnegative = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const manifestSchema = z.object({ protocol: z.literal('super-code/v2'), cases: z.array(z.object({ taskId: label, category: label, conditions }).strict()).min(1), baselineVersion: label, candidateVersion: label }).strict();
const measurementSchema = z.object({
    protocol: z.literal('super-code/v2'), preset: z.enum(['minimal', 'super-code']), taskId: label, category: label,
    mode: z.enum(['real', 'mock', 'replay']), version: label, conditions,
    outcome: z.enum(['passed', 'failed', 'infrastructure_error']),
    cost: z.object({ uncachedInput: count, cachedInput: count, output: count, toolCalls: count, latencyMs: nonnegative, complete: z.boolean() }).strict(),
    team: z.enum(TEAM_NAMES).optional(),
}).strict();
/** One fixed candidate per case; partial or mismatched evidence can never pass release. */
export function evaluateSuperCodeBatch(input, measurements, thresholds = {}) {
    const manifest = manifestSchema.parse(input);
    const rows = measurements.map(row => measurementSchema.parse(row));
    const cases = new Map(manifest.cases.map(item => [item.taskId, item]));
    if (cases.size !== manifest.cases.length)
        throw new Error('Duplicate manifest task id');
    const byId = new Map();
    const mismatches = [];
    for (const row of rows) {
        const expected = cases.get(row.taskId);
        if (expected === undefined)
            throw new Error(`Unexpected task ${row.taskId}`);
        const group = byId.get(row.taskId) ?? new Map();
        if (group.has(row.preset))
            throw new Error(`Duplicate ${row.preset} measurement for ${row.taskId}; select a run before evaluation`);
        group.set(row.preset, row);
        byId.set(row.taskId, group);
        if (row.category !== expected.category)
            mismatches.push(`${row.taskId}: category changed`);
        for (const key of Object.keys(expected.conditions)) {
            if (row.conditions[key] !== expected.conditions[key])
                mismatches.push(`${row.taskId}/${row.preset}: ${key} differs`);
        }
        const version = row.preset === 'minimal' ? manifest.baselineVersion : manifest.candidateVersion;
        if (row.version !== version)
            mismatches.push(`${row.taskId}/${row.preset}: implementation version differs`);
    }
    if (mismatches.length > 0)
        return { status: 'unmatched', accepted: false, reasons: mismatches };
    const missing = manifest.cases.flatMap(item => ['minimal', 'super-code'].filter(preset => !byId.get(item.taskId)?.has(preset)).map(preset => `${item.taskId}/${preset}`));
    if (missing.length > 0)
        return { status: 'incomplete', accepted: false, reasons: missing };
    const unmeasured = rows.filter(row => !row.cost.complete || row.mode !== 'real' || row.outcome === 'infrastructure_error');
    if (unmeasured.length > 0)
        return { status: 'unmeasured', accepted: false, reasons: unmeasured.map(row => `${row.taskId}/${row.preset}: ${row.mode}, ${row.outcome}, complete cost=${row.cost.complete}`) };
    const snapshot = (row) => ({ successRate: Number(row.outcome === 'passed'), totalTokens: row.cost.uncachedInput + row.cost.cachedInput + row.cost.output, latencyMs: row.cost.latencyMs });
    const runs = manifest.cases.map(item => ({ category: item.category, baseline: snapshot(byId.get(item.taskId).get('minimal')), candidate: snapshot(byId.get(item.taskId).get('super-code')) }));
    const aggregate = aggregateEvaluationRuns(runs);
    const gate = evaluateReleaseGate(aggregate.baseline, aggregate.candidate, thresholds);
    const groups = new Map();
    for (const run of runs) {
        const group = groups.get(run.category) ?? [];
        group.push(run);
        groups.set(run.category, group);
    }
    const categories = Object.fromEntries([...groups].map(([category, values]) => [category, aggregateEvaluationRuns(values)]));
    // A pooled win must not hide a quality regression in a fixed task category.
    return { status: 'measured', accepted: gate.accepted && Object.values(categories).every(group => group.deltas.successRate >= 0), aggregate, gate, categories };
}
//# sourceMappingURL=evaluation-v2.js.map