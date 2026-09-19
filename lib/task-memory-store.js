import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { TASK_MEMORY_SOURCE } from './task-memory-projection.js';
import { foldTaskMemory, taskMemoryContext } from './core/task-memory.js';
/** One session write barrier, including recovery of an unconfirmed checkpoint. */
export class TaskMemoryStore {
    ctx;
    maxContextBytes;
    pending = new WeakSet();
    locks = new WeakMap();
    constructor(ctx, maxContextBytes) {
        this.ctx = ctx;
        this.maxContextBytes = maxContextBytes;
    }
    isPending(session) { return this.pending.has(session); }
    current(session) {
        const state = this.ctx.sessionProjections.stateOf(session, 'superCodeTasks');
        if (state === undefined)
            throw new Error('super-code task projection is unavailable');
        return state;
    }
    async checkpoint(session) {
        if (!await this.ctx.sessions.flush(session))
            throw new Error('No host persistence checkpoint is configured; task memory is not durable');
        this.pending.delete(session);
    }
    async access(session, signal, run) {
        const previous = this.locks.get(session) ?? Promise.resolve();
        const operation = previous.catch(() => { }).then(async () => {
            signal.throwIfAborted();
            if (this.pending.has(session))
                await this.checkpoint(session);
            signal.throwIfAborted();
            return run();
        });
        this.locks.set(session, operation);
        try {
            return await operation;
        }
        finally {
            if (this.locks.get(session) === operation)
                this.locks.delete(session);
        }
    }
    /** Capture a confirmed immutable view; callers perform scans outside the barrier. */
    read(session, signal) {
        return this.access(session, signal, () => ({ state: this.current(session), end: session.seq }));
    }
    write(session, signal, decide) {
        return this.access(session, signal, async () => {
            const state = this.current(session);
            const change = decide(state);
            if (change.kind === 'unchanged')
                return { id: change.id, revision: change.revision, unchanged: true };
            const next = foldTaskMemory(state, change);
            // Every possible focus must fit, including room for future source identities.
            const preview = { ...next, recentSources: Array(8).fill(Number.MAX_SAFE_INTEGER) };
            taskMemoryContext(preview, this.maxContextBytes);
            for (const id of Object.keys(next.tasks))
                taskMemoryContext({ ...preview, focus: { kind: 'task', id } }, this.maxContextBytes);
            signal.throwIfAborted();
            const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: JSON.stringify(change) }],
                source: { kind: 'plugin', plugin: TASK_MEMORY_SOURCE } }), { surfaceOp: 'append' });
            this.pending.add(session);
            await this.checkpoint(session);
            return { eventSeq: event.seq, ...(change.kind === 'focus' ? { id: change.id } : { id: change.task.id, revision: change.task.revision }) };
        });
    }
}
//# sourceMappingURL=task-memory-store.js.map