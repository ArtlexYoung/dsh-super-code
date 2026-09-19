/** Pure experiment helpers, imported only by task-owned scripts under the host shell. */
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
class ExperimentStopped extends Error {
    reason;
    constructor(reason) {
        super(`Experiment stopped: ${reason}`);
        this.reason = reason;
    }
}
/** Shared callback budget; hard interruption belongs to the outer shell timeout. */
export class ExperimentBudget {
    checks = 0;
    started = performance.now();
    maxChecks;
    timeoutMs;
    signal;
    constructor(limits) {
        if (!Number.isSafeInteger(limits.maxChecks) || limits.maxChecks < 1 || !Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0) {
            throw new Error('maxChecks must be a positive safe integer; timeoutMs must be positive and finite');
        }
        this.maxChecks = limits.maxChecks;
        this.timeoutMs = limits.timeoutMs;
        this.signal = limits.signal;
    }
    checkTime() {
        if (this.signal?.aborted)
            throw new ExperimentStopped('cancelled');
        if (performance.now() - this.started >= this.timeoutMs)
            throw new ExperimentStopped('deadline');
    }
    async check(probe, input) {
        this.checkTime();
        if (this.checks >= this.maxChecks)
            throw new ExperimentStopped('checks');
        this.checks++;
        // Inputs must be structured-cloneable; a probe cannot mutate later trials.
        let result;
        try {
            result = await probe(structuredClone(input), this.signal);
        }
        catch (error) {
            if (this.signal?.aborted)
                throw new ExperimentStopped('cancelled');
            throw error;
        }
        this.checkTime();
        if (!result || !['pass', 'fail', 'unknown'].includes(result.kind)
            || (result.kind === 'fail' && (typeof result.signature !== 'string' || !result.signature.trim()))
            || (result.kind === 'unknown' && (typeof result.reason !== 'string' || !result.reason.trim()))) {
            throw new Error('Probe must return pass, fail with a signature, or unknown with a reason');
        }
        return result;
    }
    stats() {
        return { checks: this.checks, maxChecks: this.maxChecks, elapsedMs: performance.now() - this.started, timeoutMs: this.timeoutMs };
    }
}
/** Chunk deletion followed by single deletion; no global-minimum claim. */
export async function reduceFailure(input, signature, probe, budget) {
    if (typeof signature !== 'string' || !signature.trim())
        throw new Error('A nonempty target failure signature is required');
    let current = structuredClone([...input]), reproduced = false, uncertain = false;
    const result = (status, reason, minimality = 'not-established') => ({ status, input: current, reproduced, minimality, reason, stats: budget.stats() });
    const matches = async (candidate) => {
        const first = await budget.check(probe, candidate);
        if (first.kind === 'unknown') {
            uncertain = true;
            return false;
        }
        if (first.kind !== 'fail' || first.signature !== signature)
            return false;
        const second = await budget.check(probe, candidate);
        if (second.kind !== 'fail' || second.signature !== signature) {
            uncertain = true;
            return false;
        }
        return true;
    };
    try {
        if (!await matches(current))
            return result(uncertain ? 'inconclusive' : 'not-reproduced', 'Initial input did not reproduce the target failure twice');
        reproduced = true;
        if (current.length && await matches([]))
            current = [];
        let partitions = 2;
        while (current.length > 0) {
            const width = Math.ceil(current.length / partitions);
            let changed = false;
            for (let start = 0; start < current.length; start += width) {
                const candidate = [...current.slice(0, start), ...current.slice(start + width)];
                if (await matches(candidate)) {
                    current = candidate;
                    partitions = Math.max(2, partitions - 1);
                    changed = true;
                    break;
                }
            }
            if (changed)
                continue;
            if (width === 1)
                break;
            partitions = Math.min(current.length, partitions * 2);
        }
        return result(uncertain ? 'inconclusive' : 'reduced', uncertain ? 'Some probes were unknown or inconsistent' : 'Target failure confirmed; no single deletion retained it', uncertain ? 'not-established' : 'one-removal');
    }
    catch (error) {
        if (!(error instanceof ExperimentStopped))
            throw error;
        return result('stopped', error.reason);
    }
}
/** Consumes cases lazily and stops at the first explicit counterexample. */
export async function findCounterexample(cases, probe, budget) {
    let checkedCases = 0, unknownCases = 0;
    try {
        for (const input of cases) {
            const saved = structuredClone(input);
            const verdict = await budget.check(probe, saved);
            if (verdict.kind === 'fail')
                return { status: 'counterexample', index: checkedCases, input: saved, verdict, stats: budget.stats() };
            checkedCases++;
            if (verdict.kind === 'unknown')
                unknownCases++;
        }
        return { status: unknownCases || !checkedCases ? 'inconclusive' : 'checked', checkedCases, unknownCases,
            reason: unknownCases ? 'Some cases were unknown' : checkedCases ? 'Only the supplied cases were checked' : 'No cases supplied', stats: budget.stats() };
    }
    catch (error) {
        if (!(error instanceof ExperimentStopped))
            throw error;
        return { status: 'stopped', checkedCases, unknownCases, reason: error.reason, stats: budget.stats() };
    }
}
/** Exceptions propagate; behavior-difference identifies any mismatch, not a specific fault. */
export function differential(reference, candidate, equal = isDeepStrictEqual) {
    return async (input, signal) => {
        const expected = structuredClone(await reference(structuredClone(input), signal));
        signal?.throwIfAborted();
        const actual = structuredClone(await candidate(structuredClone(input), signal));
        const same = equal(expected, actual);
        if (typeof same !== 'boolean')
            throw new Error('Differential equality must return a boolean');
        return same ? { kind: 'pass' } : { kind: 'fail', signature: 'behavior-difference', detail: { expected, actual } };
    };
}
/** The caller supplies a contract-backed transform and relation, not a guessed oracle. */
export function metamorphic(contract, observe, transform, holds) {
    if (typeof contract !== 'string' || !contract.trim())
        throw new Error('A relation contract is required');
    return async (input, signal) => {
        const transformedInput = transform(structuredClone(input));
        const original = structuredClone(await observe(structuredClone(input), signal));
        signal?.throwIfAborted();
        const transformed = structuredClone(await observe(structuredClone(transformedInput), signal));
        const valid = holds(original, transformed);
        if (typeof valid !== 'boolean')
            throw new Error('Relation must return a boolean');
        return valid ? { kind: 'pass' } : { kind: 'fail', signature: contract, detail: { transformedInput, original, transformed } };
    };
}
/** Enumerate two ordered lanes, bounded before allocation; not a runtime scheduler. */
export function interleavings(leftLength, rightLength, maxSchedules) {
    if (![leftLength, rightLength].every(n => Number.isSafeInteger(n) && n >= 0) || leftLength + rightLength > 256
        || !Number.isSafeInteger(maxSchedules) || maxSchedules < 1)
        throw new Error('Use nonnegative lane lengths totaling at most 256 and a positive maxSchedules');
    const length = leftLength + rightLength;
    let count = 1n;
    for (let i = 1; i <= Math.min(leftLength, rightLength); i++) {
        count = count * BigInt(length - i + 1) / BigInt(i);
        if (count > BigInt(maxSchedules))
            break;
    }
    const coverage = count > BigInt(maxSchedules) ? 'limited' : 'complete';
    return {
        coverage, count: Math.min(Number(count), maxSchedules),
        *[Symbol.iterator]() {
            // Lexicographic combinations of left-lane positions; O(sequence length) memory.
            const positions = Array.from({ length: leftLength }, (_, index) => index);
            for (let emitted = 0; emitted < maxSchedules; emitted++) {
                let left = 0, right = 0;
                yield Array.from({ length }, (_, position) => position === positions[left]
                    ? { lane: 0, index: left++ } : { lane: 1, index: right++ });
                let index = positions.length - 1;
                while (index >= 0 && positions[index] === length - positions.length + index)
                    index--;
                if (index < 0)
                    return;
                positions[index]++;
                for (let next = index + 1; next < positions.length; next++)
                    positions[next] = positions[next - 1] + 1;
            }
        },
    };
}
//# sourceMappingURL=experiments.js.map