import { ProtocolError, validateBudget } from './protocol.js';
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
const DEFAULT_MAX_FEEDBACK_CHARS = 2_000;
/**
 * Use a separate plan when the request is structurally complex. The heuristic
 * is deliberately domain-agnostic: it only considers shape and common
 * planning signals, never dataset names, task IDs, or expected answers.
 */
export function shouldPlanSeparately(task) {
    const normalized = task.trim();
    if (normalized.length > 1_200 || normalized.split(/\r?\n/).length > 16)
        return true;
    return /\b(architecture|decompose|dependencies|migration|refactor|trade[- ]?off|multiple\s+(?:files|components|stages)|acceptance\s+criteria)\b|架构|拆分|依赖|迁移|重构|权衡|验收标准/i.test(normalized);
}
function positiveInteger(value, fallback, field) {
    const normalized = value ?? fallback;
    if (!Number.isSafeInteger(normalized) || normalized < 1)
        throw new ProtocolError(`${field} must be a positive safe integer`, 'INVALID_ARGUMENT');
    return normalized;
}
function nonEmpty(value, field) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new ProtocolError(`${field} must be a non-empty string`, 'INVALID_ARGUMENT');
    return value.trim();
}
function usageValue(value, field) {
    if (value === undefined)
        return 0;
    if (!Number.isFinite(value) || value < 0)
        throw new ProtocolError(`${field} must be a non-negative finite number`, 'INVALID_USAGE');
    return value;
}
function normalizeTiming(timing) {
    if (timing === undefined)
        return undefined;
    const fields = ['requestWaitMs', 'inputWaitMs', 'ttftMs', 'outputMs', 'totalLatencyMs'];
    const normalized = {};
    for (const field of fields) {
        const value = timing[field];
        if (value !== undefined)
            normalized[field] = usageValue(value, `timing.${field}`);
    }
    return normalized;
}
function normalizeUsage(usage) {
    const inputTokens = usageValue(usage?.inputTokens, 'usage.inputTokens');
    const outputTokens = usageValue(usage?.outputTokens, 'usage.outputTokens');
    const totalTokens = usage?.totalTokens === undefined ? inputTokens + outputTokens : usageValue(usage.totalTokens, 'usage.totalTokens');
    if (totalTokens < inputTokens + outputTokens)
        throw new ProtocolError('usage.totalTokens must cover inputTokens + outputTokens', 'INVALID_USAGE');
    return { inputTokens, outputTokens, totalTokens, cachedTokens: usageValue(usage?.cachedTokens, 'usage.cachedTokens'), toolCalls: usageValue(usage?.toolCalls, 'usage.toolCalls'), latencyMs: usageValue(usage?.latencyMs, 'usage.latencyMs') };
}
function addUsage(left, right) {
    return { inputTokens: left.inputTokens + right.inputTokens, outputTokens: left.outputTokens + right.outputTokens, totalTokens: left.totalTokens + right.totalTokens, cachedTokens: left.cachedTokens + right.cachedTokens, toolCalls: left.toolCalls + right.toolCalls, latencyMs: left.latencyMs + right.latencyMs };
}
const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, toolCalls: 0, latencyMs: 0 });
function exceeds(usage, budget) {
    return (budget.maxInputTokens !== undefined && usage.inputTokens > budget.maxInputTokens)
        || (budget.maxOutputTokens !== undefined && usage.outputTokens > budget.maxOutputTokens)
        || (budget.maxTotalTokens !== undefined && usage.totalTokens > budget.maxTotalTokens)
        || (budget.maxToolCalls !== undefined && usage.toolCalls > budget.maxToolCalls);
}
function remaining(usage, budget, elapsedMs = 0) {
    return {
        ...budget.maxInputTokens === undefined ? {} : { maxInputTokens: Math.max(0, budget.maxInputTokens - usage.inputTokens) },
        ...budget.maxOutputTokens === undefined ? {} : { maxOutputTokens: Math.max(0, budget.maxOutputTokens - usage.outputTokens) },
        ...budget.maxTotalTokens === undefined ? {} : { maxTotalTokens: Math.max(0, budget.maxTotalTokens - usage.totalTokens) },
        ...budget.maxToolCalls === undefined ? {} : { maxToolCalls: Math.max(0, budget.maxToolCalls - usage.toolCalls) },
        ...budget.timeoutMs === undefined ? {} : { timeoutMs: Math.max(0, budget.timeoutMs - elapsedMs) },
    };
}
async function boundedCall(callback, parent, timeoutMs) {
    const controller = new AbortController();
    let timer;
    let finishAbort;
    const parentAbort = new Promise(resolve => {
        finishAbort = () => { controller.abort(parent.reason); resolve({ kind: 'aborted' }); };
        if (parent.aborted)
            finishAbort();
        else
            parent.addEventListener('abort', finishAbort, { once: true });
    });
    const deadline = timeoutMs !== undefined && timeoutMs > 0
        ? new Promise(resolve => { timer = setTimeout(() => { controller.abort(new ProtocolError('programming workflow deadline exceeded', 'WORKFLOW_TIMEOUT')); resolve({ kind: 'timeout' }); }, timeoutMs); })
        : undefined;
    const operation = Promise.resolve().then(() => callback(controller.signal)).then(value => ({ kind: 'completed', value }));
    try {
        return await Promise.race([operation, parentAbort, ...(deadline === undefined ? [] : [deadline])]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (finishAbort !== undefined)
            parent.removeEventListener('abort', finishAbort);
        void operation.catch(() => undefined);
    }
}
/** Keep verifier diagnostics useful without replaying an unbounded tool log. */
export function compactFeedback(value, maxChars = DEFAULT_MAX_FEEDBACK_CHARS) {
    const limit = positiveInteger(maxChars, DEFAULT_MAX_FEEDBACK_CHARS, 'maxFeedbackChars');
    const text = (value ?? 'The acceptance check failed without a diagnostic.').trim();
    if (text.length <= limit)
        return text;
    const marker = '…[feedback truncated]…';
    if (limit <= marker.length)
        return text.slice(0, limit);
    const available = limit - marker.length;
    const head = Math.ceil(available * 0.65);
    const tail = available - head;
    return `${text.slice(0, head)}${marker}${tail === 0 ? '' : text.slice(-tail)}`;
}
/**
 * Run a bounded programming task: one analysis, one draft, then repairs only
 * when the verifier rejects the candidate. The host owns model/tool execution.
 */
export async function runProgrammingWorkflow(task, callbacks, options = {}, signal = new AbortController().signal) {
    const normalizedTask = nonEmpty(task, 'task');
    if (!callbacks || typeof callbacks.generate !== 'function' || typeof callbacks.verify !== 'function')
        throw new ProtocolError('generate and verify callbacks are required', 'INVALID_ARGUMENT');
    const budget = validateBudget(options.budget ?? {});
    const maxRepairAttempts = options.maxRepairAttempts === undefined ? DEFAULT_MAX_REPAIR_ATTEMPTS : positiveInteger(options.maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS, 'maxRepairAttempts');
    const maxFeedbackChars = options.maxFeedbackChars === undefined ? DEFAULT_MAX_FEEDBACK_CHARS : positiveInteger(options.maxFeedbackChars, DEFAULT_MAX_FEEDBACK_CHARS, 'maxFeedbackChars');
    const planning = options.planning ?? 'separate';
    if (planning !== 'separate' && planning !== 'skip' && planning !== 'auto')
        throw new ProtocolError('planning must be separate, skip, or auto', 'INVALID_ARGUMENT');
    const useSeparatePlanning = planning === 'separate' || (planning === 'auto' && shouldPlanSeparately(normalizedTask));
    const phases = [];
    let usage = emptyUsage();
    let analysis;
    let candidate;
    let finalAcceptance;
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const deadlineExceeded = () => budget.timeoutMs !== undefined && budget.timeoutMs > 0 && elapsed() >= budget.timeoutMs;
    const contextMessages = (feedback) => [
        { role: 'user', content: normalizedTask },
        ...(analysis === undefined ? [] : [{ role: 'assistant', content: analysis }]),
        ...(candidate === undefined ? [] : [{ role: 'assistant', content: candidate }]),
        ...(feedback === undefined ? [] : [{ role: 'tool', content: feedback }]),
    ];
    const invoke = async (phase, attempt, feedback) => {
        if (signal.aborted || deadlineExceeded() || exceeds(usage, budget))
            return undefined;
        const call = await boundedCall(callSignal => callbacks.generate({ phase, task: normalizedTask, messages: contextMessages(feedback), ...analysis === undefined ? {} : { analysis }, ...candidate === undefined ? {} : { candidate }, ...feedback === undefined ? {} : { feedback }, attempt, remainingBudget: remaining(usage, budget, elapsed()), signal: callSignal }), signal, budget.timeoutMs === undefined ? undefined : Math.max(1, budget.timeoutMs - elapsed()));
        if (call.kind !== 'completed')
            return undefined;
        const generation = call.value;
        const text = nonEmpty(generation.text, `${phase}.text`);
        const normalized = { ...generation, text, usage: generation.usage === undefined ? undefined : { ...generation.usage }, timing: normalizeTiming(generation.timing) };
        usage = addUsage(usage, normalizeUsage(generation.usage));
        return normalized;
    };
    if (signal.aborted)
        return { status: 'aborted', attempts: 0, phases, messages: contextMessages(), usage, finalAcceptance };
    if (useSeparatePlanning) {
        const analysisGeneration = await invoke('analysis', 0);
        if (analysisGeneration === undefined)
            return { status: signal.aborted ? 'aborted' : 'budget_exhausted', attempts: 0, phases, messages: contextMessages(), usage, finalAcceptance };
        analysis = analysisGeneration.text;
        phases.push({ phase: 'analysis', attempt: 0, generation: analysisGeneration });
        if (exceeds(usage, budget) || deadlineExceeded() || signal.aborted)
            return { status: signal.aborted ? 'aborted' : 'budget_exhausted', attempts: 0, phases, messages: contextMessages(), usage, finalAcceptance };
    }
    for (let attempt = 1; attempt <= maxRepairAttempts + 1; attempt += 1) {
        const phase = attempt === 1 ? 'draft' : 'repair';
        const feedback = phase === 'repair' ? compactFeedback(finalAcceptance?.feedback, maxFeedbackChars) : undefined;
        const generation = await invoke(phase, attempt, feedback);
        if (generation === undefined)
            return { status: signal.aborted ? 'aborted' : 'budget_exhausted', candidate, attempts: attempt - 1, phases, messages: contextMessages(feedback), usage, finalAcceptance };
        const currentCandidate = generation.text;
        candidate = currentCandidate;
        const verification = await boundedCall(callSignal => callbacks.verify({ task: normalizedTask, candidate: currentCandidate, attempt, signal: callSignal }), signal, budget.timeoutMs === undefined ? undefined : Math.max(1, budget.timeoutMs - elapsed()));
        if (verification.kind !== 'completed')
            return { status: verification.kind === 'aborted' ? 'aborted' : 'budget_exhausted', candidate, attempts: attempt, phases, messages: contextMessages(finalAcceptance?.feedback), usage, finalAcceptance };
        const acceptance = verification.value;
        if (!acceptance || typeof acceptance.passed !== 'boolean')
            throw new ProtocolError('verify must return a passed boolean', 'INVALID_RESULT');
        finalAcceptance = acceptance;
        phases.push({ phase, attempt, generation, acceptance });
        if (acceptance.passed)
            return { status: 'passed', candidate, attempts: attempt, phases, messages: contextMessages(), usage, finalAcceptance };
        if (exceeds(usage, budget) || deadlineExceeded() || signal.aborted)
            return { status: signal.aborted ? 'aborted' : 'budget_exhausted', candidate, attempts: attempt, phases, messages: contextMessages(acceptance.feedback), usage, finalAcceptance };
    }
    return { status: 'failed', candidate, attempts: maxRepairAttempts + 1, phases, messages: contextMessages(finalAcceptance?.feedback), usage, finalAcceptance };
}
export default runProgrammingWorkflow;
//# sourceMappingURL=programming.js.map