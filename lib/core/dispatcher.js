import { ProtocolError } from './protocol.js';
import { TaskGraph } from './task-graph.js';
const MAX_TIMER_MS = 2_147_000_000;
const DEFAULT_STOP_GRACE_MS = 100;
/**
 * Event-driven finite dispatcher over {@link TaskGraph}. It assigns and starts
 * a bounded batch atomically, waits on executor promises, and records each
 * outcome. A failed or timed-out attempt remains terminal until the caller
 * explicitly invokes `returnForRework`.
 */
export class Dispatcher {
    graph;
    options;
    liveExecutions = new Set();
    /**
     * @param graph - task graph owning all lifecycle mutations.
     * @param options - concurrency, timeout, and stop-confirmation limits.
     */
    constructor(graph, options = {}) {
        this.graph = graph;
        this.options = {
            maxConcurrent: options.maxConcurrent ?? Number.MAX_SAFE_INTEGER,
            timeoutMs: options.timeoutMs ?? 0,
            stopGraceMs: options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS,
        };
        if (!Number.isSafeInteger(this.options.maxConcurrent) || this.options.maxConcurrent < 1) {
            throw new ProtocolError('maxConcurrent must be a positive safe integer', 'INVALID_CONFIG');
        }
        if (!Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 0 || this.options.timeoutMs > MAX_TIMER_MS) {
            throw new ProtocolError(`timeoutMs must be a non-negative safe integer no greater than ${MAX_TIMER_MS}`, 'INVALID_CONFIG');
        }
        if (!Number.isSafeInteger(this.options.stopGraceMs) || this.options.stopGraceMs < 0 || this.options.stopGraceMs > MAX_TIMER_MS) {
            throw new ProtocolError(`stopGraceMs must be a non-negative safe integer no greater than ${MAX_TIMER_MS}`, 'INVALID_CONFIG');
        }
    }
    /**
     * Start as many ready tasks as capacity allows. Assignment is evaluated for
     * every selected task before any task is started, so a missing owner leaves
     * the graph unchanged.
     */
    async runReady(assign, execute) {
        if (typeof assign !== 'function' || typeof execute !== 'function')
            throw new ProtocolError('assign and execute must be functions', 'INVALID_ARGUMENT');
        const active = this.activeCount();
        const capacity = Math.max(0, this.options.maxConcurrent - active);
        if (capacity === 0)
            return emptyDispatchResult();
        const candidates = this.graph.ready().filter(task => !this.liveExecutions.has(task.taskId)).slice(0, capacity);
        const assignments = candidates.map(task => ({ task, owner: assign(task) }));
        if (assignments.some(item => typeof item.owner !== 'string' || item.owner.trim() === ''))
            return emptyDispatchResult();
        const started = this.graph.startBatch(assignments.map(item => ({ taskId: item.task.taskId, owner: item.owner, expectedRevision: item.task.revision })));
        const outcomes = await Promise.all(started.map(task => this.executeOne(task, execute)));
        const completed = [];
        const failed = [];
        const timedOut = [];
        const cancelled = [];
        const stopUnknown = [];
        for (const outcome of outcomes) {
            if (outcome.kind === 'completed')
                completed.push(outcome.taskId);
            else if (outcome.kind === 'timeout')
                timedOut.push(outcome.taskId);
            else if (outcome.kind === 'cancelled')
                cancelled.push(outcome.taskId);
            else if (outcome.kind === 'stop_unknown')
                stopUnknown.push(outcome.taskId);
            else
                failed.push(outcome.taskId);
        }
        return { started: started.map(task => task.taskId), completed, failed, timedOut, cancelled, stopUnknown };
    }
    /** Refill free slots on completion/acceptance events, without model-driven polling or retries. */
    async runAvailable(assign, execute, options = {}) {
        if (typeof assign !== 'function' || typeof execute !== 'function')
            throw new ProtocolError('assign and execute must be functions', 'INVALID_ARGUMENT');
        const maxStarted = options.maxStarted ?? 256;
        if (!Number.isSafeInteger(maxStarted) || maxStarted < 1)
            throw new ProtocolError('maxStarted must be a positive safe integer', 'INVALID_CONFIG');
        const result = { started: [], completed: [], failed: [], timedOut: [], cancelled: [], stopUnknown: [] };
        const running = new Map();
        const callbackErrors = [];
        const cancel = () => {
            for (const taskId of running.keys()) {
                const current = this.graph.get(taskId);
                if (current.status === 'running' && current.cancellation === undefined)
                    this.graph.requestCancellation(taskId, 'dispatch cancelled');
            }
        };
        options.signal?.addEventListener('abort', cancel, { once: true });
        try {
            for (;;) {
                if (!options.signal?.aborted && callbackErrors.length === 0) {
                    // Reserve admission until the prior completion callback settles as well.
                    const capacity = Math.min(this.options.maxConcurrent - this.activeCount(running.keys()), maxStarted - result.started.length);
                    const candidates = this.graph.ready().filter(task => !this.liveExecutions.has(task.taskId)).slice(0, Math.max(0, capacity));
                    const assignments = candidates.map(task => ({ taskId: task.taskId, owner: assign(task), expectedRevision: task.revision }));
                    if (assignments.every(item => typeof item.owner === 'string' && item.owner.trim() !== '')) {
                        const started = this.graph.startBatch(assignments);
                        for (const task of started) {
                            result.started.push(task.taskId);
                            const promise = this.executeOne(task, execute).then(async (outcome) => {
                                const key = outcome.kind === 'timeout' ? 'timedOut' : outcome.kind === 'stop_unknown' ? 'stopUnknown' : outcome.kind;
                                result[key].push(task.taskId);
                                await options.afterEach?.(this.graph.get(task.taskId));
                            }).catch(error => { callbackErrors.push(error); cancel(); }).finally(() => { running.delete(task.taskId); });
                            running.set(task.taskId, promise);
                        }
                    }
                }
                if (running.size === 0)
                    break;
                // Acceptance by another owner can unlock work while a slow sibling is still running.
                const watcher = new AbortController();
                try {
                    await Promise.race([...running.values(), this.graph.waitForChange(this.graph.version, 30_000, watcher.signal)]);
                }
                finally {
                    watcher.abort();
                }
            }
            if (callbackErrors.length > 0)
                throw new AggregateError(callbackErrors, 'Dispatch acceptance callback failed');
            return result;
        }
        finally {
            options.signal?.removeEventListener('abort', cancel);
            // A synchronous assignment error must not leave owned executors detached.
            cancel();
            await Promise.allSettled(running.values());
        }
    }
    activeCount(pending = []) {
        const ids = new Set([...this.liveExecutions, ...pending]);
        for (const task of this.graph.all())
            if (task.status === 'running' || task.status === 'queued')
                ids.add(task.taskId);
        return ids.size;
    }
    /** Cancel tasks that have not acquired an attempt. */
    cancelPending(reason = 'cancelled before dispatch') {
        return this.graph.cancelUnstarted(reason);
    }
    async executeOne(task, execute) {
        const attemptId = task.attemptId;
        if (attemptId === undefined)
            throw new ProtocolError(`started task ${task.taskId} has no attempt`, 'INVALID_SNAPSHOT');
        const controller = new AbortController();
        const watcherController = new AbortController();
        this.liveExecutions.add(task.taskId);
        const execution = Promise.resolve()
            .then(() => execute(task, controller.signal))
            .then(value => ({ kind: 'result', value }), error => ({ kind: 'error', error }))
            .finally(() => { this.liveExecutions.delete(task.taskId); });
        const cancellation = this.watchCancellation(task, watcherController.signal);
        let timeout;
        const timeoutOutcome = this.options.timeoutMs > 0
            ? new Promise(resolve => {
                timeout = setTimeout(() => {
                    controller.abort(new ProtocolError(`task ${task.taskId} timed out`, 'TASK_TIMEOUT'));
                    resolve({ kind: 'timeout' });
                }, this.options.timeoutMs);
            })
            : undefined;
        try {
            const winner = await Promise.race([
                execution.then(outcome => ({ source: 'execution', outcome })),
                cancellation.then(observation => ({ source: 'cancellation', observation })),
                ...(timeoutOutcome === undefined ? [] : [timeoutOutcome.then(outcome => ({ source: 'timeout', outcome }))]),
            ]);
            if (winner.source === 'cancellation') {
                if (winner.observation === 'requested')
                    return this.handleCancellation(task, execution, controller);
                if (winner.observation === 'confirmed')
                    return { taskId: task.taskId, kind: 'cancelled' };
                if (winner.observation === 'unknown')
                    return { taskId: task.taskId, kind: 'stop_unknown' };
                return this.classifyCurrent(task.taskId, 'failed');
            }
            if (winner.source === 'timeout')
                return this.handleTimeout(task, execution);
            if (winner.outcome.kind === 'error')
                return this.handleExecutionError(task, attemptId, winner.outcome.error);
            if (winner.outcome.kind === 'timeout')
                return this.handleTimeout(task, execution);
            if (winner.outcome.kind === 'cancel-requested')
                return this.handleCancellation(task, execution, controller);
            return this.handleExecutionResult(task, attemptId, winner.outcome.value);
        }
        finally {
            if (timeout !== undefined)
                clearTimeout(timeout);
            watcherController.abort();
            void cancellation.catch(() => undefined);
        }
    }
    async handleCancellation(task, execution, controller) {
        controller.abort(new ProtocolError(`task ${task.taskId} cancellation requested`, 'TASK_CANCELLED'));
        const settled = await this.waitForExecution(execution, this.options.stopGraceMs);
        const observed = this.currentStopOutcome(task.taskId);
        if (observed !== undefined)
            return observed;
        if (settled !== undefined) {
            // A settled executor has stopped owning the attempt. Its return value is
            // deliberately discarded, but the settlement itself is stop evidence.
            try {
                this.graph.confirmCancellation(task.taskId, { reason: 'executor settled after cancellation request' });
            }
            catch {
                const after = this.currentStopOutcome(task.taskId);
                if (after !== undefined)
                    return after;
            }
            return this.classifyCurrent(task.taskId, 'cancelled');
        }
        try {
            this.graph.markStopUnknown(task.taskId, 'executor did not confirm stop after cancellation request');
        }
        catch {
            const after = this.currentStopOutcome(task.taskId);
            if (after !== undefined)
                return after;
        }
        return this.classifyCurrent(task.taskId, 'stop_unknown');
    }
    handleTimeout(task, execution) {
        const before = this.currentStopOutcome(task.taskId);
        if (before !== undefined)
            return before;
        try {
            this.graph.markStopUnknown(task.taskId, 'executor did not finish before timeout');
        }
        catch {
            const after = this.currentStopOutcome(task.taskId);
            if (after !== undefined)
                return after;
        }
        // Keep the timeout category even though the durable task is stop_unknown;
        // callers can distinguish deadline breaches from user cancellation.
        void execution.catch(() => undefined);
        return { taskId: task.taskId, kind: 'timeout' };
    }
    handleExecutionResult(task, attemptId, value) {
        const current = this.graph.get(task.taskId);
        if (current.cancellation?.outcome === 'requested')
            return this.handleCancellationAfterSettlement(task.taskId);
        const terminal = this.currentStopOutcome(task.taskId);
        if (terminal !== undefined)
            return terminal;
        const payload = value === undefined ? {} : value;
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
            return this.failExecution(task, attemptId, new ProtocolError('executor result must be an object', 'INVALID_RESULT'));
        }
        try {
            const completed = this.graph.completeTask(task.taskId, attemptId, payload.result, payload.artifacts ?? []);
            if (completed.stage === 'stop_unknown')
                return { taskId: task.taskId, kind: 'stop_unknown' };
            if (completed.stage === 'stopped')
                return { taskId: task.taskId, kind: 'cancelled' };
            return { taskId: task.taskId, kind: 'completed' };
        }
        catch (error) {
            return this.failExecution(task, attemptId, error);
        }
    }
    handleExecutionError(task, attemptId, error) {
        const current = this.graph.get(task.taskId);
        if (current.cancellation?.outcome === 'requested')
            return this.handleCancellationAfterSettlement(task.taskId);
        const terminal = this.currentStopOutcome(task.taskId);
        if (terminal !== undefined)
            return terminal;
        return this.failExecution(task, attemptId, error);
    }
    failExecution(task, attemptId, error) {
        try {
            this.graph.failTask(task.taskId, attemptId, error);
            return { taskId: task.taskId, kind: 'failed' };
        }
        catch {
            return this.classifyCurrent(task.taskId, 'failed');
        }
    }
    handleCancellationAfterSettlement(taskId) {
        const current = this.graph.get(taskId);
        if (current.cancellation?.outcome === 'requested') {
            try {
                this.graph.confirmCancellation(taskId, { reason: 'executor settled after cancellation request' });
            }
            catch {
                // A concurrent confirmer may have won the race. Classification below
                // reads the durable state and keeps this path idempotent.
            }
        }
        return this.classifyCurrent(taskId, 'cancelled');
    }
    currentStopOutcome(taskId) {
        const current = this.graph.get(taskId);
        if (current.stage === 'stop_unknown')
            return { taskId, kind: 'stop_unknown' };
        if (current.status === 'cancelled' || current.stage === 'stopped' || current.deleted)
            return { taskId, kind: 'cancelled' };
        if (current.status === 'completed')
            return { taskId, kind: 'completed' };
        if (current.status === 'failed')
            return { taskId, kind: 'failed' };
        return undefined;
    }
    classifyCurrent(taskId, fallback) {
        return this.currentStopOutcome(taskId) ?? { taskId, kind: fallback };
    }
    async waitForExecution(execution, timeoutMs) {
        if (timeoutMs === 0)
            return undefined;
        let timer;
        const grace = new Promise(resolve => {
            timer = setTimeout(() => resolve({ source: 'grace' }), timeoutMs);
        });
        try {
            const result = await Promise.race([
                execution.then(outcome => ({ source: 'execution', outcome })),
                grace,
            ]);
            return result.source === 'execution' ? result.outcome : undefined;
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    async watchCancellation(task, signal) {
        let sequence = this.graph.version;
        while (!signal.aborted) {
            try {
                const current = this.graph.get(task.taskId);
                if (current.cancellation?.outcome === 'requested')
                    return 'requested';
                if (current.cancellation?.outcome === 'confirmed' || current.stage === 'stopped')
                    return 'confirmed';
                if (current.stage === 'stop_unknown')
                    return 'unknown';
                if (current.status !== 'running')
                    return 'ended';
                const change = await this.graph.waitForChange(sequence, MAX_TIMER_MS, signal);
                if (change.timedOut)
                    continue;
                sequence = change.sequence;
            }
            catch {
                return signal.aborted ? 'aborted' : 'ended';
            }
        }
        return 'aborted';
    }
}
function emptyDispatchResult() {
    return { started: [], completed: [], failed: [], timedOut: [], cancelled: [], stopUnknown: [] };
}
export default Dispatcher;
//# sourceMappingURL=dispatcher.js.map