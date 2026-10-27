/** Ephemeral, exact-call decisions. The host approval service owns the durable audit. */
import { randomUUID } from 'node:crypto';
import { ConnectionError } from './types.js';
export class CallerApprovals {
    now;
    requests = new Map();
    settled = new Map();
    presenting = new Set();
    constructor(now = Date.now) {
        this.now = now;
    }
    async request(input, signal) {
        if (signal?.aborted)
            return 'cancelled';
        if (this.requests.size >= 32 || input.arguments.length > 16000 || input.reason.length > 8000 || input.toolName.length > 256)
            return 'host';
        const createdAt = this.now(), view = { ...input, id: randomUUID(), createdAt, expiresAt: createdAt + 5 * 60 * 1000 };
        return new Promise(resolve => {
            const timer = setTimeout(() => settle('host'), 5 * 60 * 1000);
            timer.unref();
            const abort = () => settle('cancelled');
            const settle = (answer) => {
                if (!this.requests.delete(view.id))
                    return;
                this.presenting.delete(view.id);
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                resolve(answer);
            };
            this.requests.set(view.id, { view, settle });
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted)
                abort();
        });
    }
    expire() {
        for (const row of this.requests.values())
            if (row.view.expiresAt <= this.now())
                row.settle('host');
    }
    pending(taskId) {
        this.expire();
        return [...this.requests.values()].filter(row => row.view.taskId === taskId).map(row => ({ ...row.view }));
    }
    present(taskId, id) {
        this.expire();
        if (this.requests.get(id)?.view.taskId !== taskId || this.presenting.has(id))
            return false;
        this.presenting.add(id);
        return true;
    }
    defer(taskId, id) {
        const row = this.requests.get(id);
        if (row?.view.taskId === taskId)
            row.settle('host');
    }
    decide(taskId, id, decision) {
        this.expire();
        const prior = this.settled.get(id);
        if (prior) {
            if (prior.taskId !== taskId)
                throw new ConnectionError('approval-not-found');
            if (prior.decision !== decision)
                throw new ConnectionError('approval-conflict');
            return { outcome: decision === 'approve' ? 'allowed-once' : 'rejected', repeated: true };
        }
        const row = this.requests.get(id);
        if (!row || row.view.taskId !== taskId)
            throw new ConnectionError('approval-not-found');
        this.settled.set(id, { taskId, decision });
        if (this.settled.size > 200)
            this.settled.delete(this.settled.keys().next().value);
        const outcome = decision === 'approve' ? 'allowed-once' : 'rejected';
        row.settle(outcome);
        return { outcome, repeated: false };
    }
    withdraw(taskId, answer = 'host') {
        for (const row of this.requests.values())
            if (!taskId || row.view.taskId === taskId)
                row.settle(answer);
    }
}
//# sourceMappingURL=approvals.js.map