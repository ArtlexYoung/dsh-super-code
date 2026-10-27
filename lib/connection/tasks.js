import { randomUUID, createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { activeTask, ConnectionError } from './types.js';
import { CallerApprovals } from './approvals.js';
import { gitSnapshot, gitWorktreeRoot, workspaceChanges } from './git.js';
export function withinDirectory(root, cwd) {
    const path = relative(root, cwd);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export class DelegatedTasks {
    store;
    host;
    configuration;
    records = [];
    tail = Promise.resolve();
    closed = false;
    approvals = new CallerApprovals();
    constructor(store, host, configuration) {
        this.store = store;
        this.host = host;
        this.configuration = configuration;
    }
    async initialize() {
        this.records = await this.store.tasks();
        for (const task of this.records)
            if (activeTask(task.status))
                this.event(task, 'interrupted', 'Service restarted; no request was replayed. Observe or explicitly continue this task.');
        await this.persist();
    }
    exclusive(run) {
        const operation = this.tail.then(run);
        this.tail = operation.catch(() => { });
        return operation;
    }
    event(task, status, message) {
        task.status = status;
        task.updatedAt = Date.now();
        task.events.push({ cursor: ++task.sequence, time: task.updatedAt, status, message: message.slice(0, 1000) });
        task.events = task.events.slice(-200);
    }
    async persist() { await this.store.saveTasks(this.records); }
    owned(id) {
        const task = this.records.find(row => row.id === id);
        if (!task)
            throw new ConnectionError('task-not-found');
        return task;
    }
    enabled() {
        if (this.closed || !this.configuration().enabled)
            throw new ConnectionError('connection-disabled');
    }
    async requestApproval(input, roots, signal) {
        const config = this.configuration();
        if (this.closed || !config.enabled || !config.allowCallerApproval)
            return 'host';
        const task = this.records.find(row => roots.includes(row.sessionId) && activeTask(row.status) && !row.cancellationRequested);
        if (!task)
            return 'host';
        try {
            await this.directory(task.cwd);
        }
        catch {
            return 'host';
        }
        if (!this.configuration().enabled || !this.configuration().allowCallerApproval || this.closed || task.cancellationRequested || !activeTask(task.status))
            return 'host';
        return this.approvals.request({ ...input, taskId: task.id, cwd: task.cwd }, signal);
    }
    async approve(taskId, approvalId, decision) {
        this.enabled();
        if (!this.configuration().allowCallerApproval)
            throw new ConnectionError('caller-approval-disabled');
        const task = this.owned(taskId);
        await this.directory(task.cwd);
        if (task.cancellationRequested)
            throw new ConnectionError('approval-not-found');
        if (!activeTask(task.status) && this.approvals.pending(task.id).length) {
            this.approvals.withdraw(task.id, 'cancelled');
            throw new ConnectionError('approval-not-found');
        }
        return this.approvals.decide(taskId, approvalId, decision);
    }
    approvalsChanged() { this.approvals.withdraw(); }
    async selectModel(task, selection) {
        if (!selection)
            return;
        if (!this.host.selectModel)
            throw new ConnectionError('model-selection-unavailable');
        task.modelSelection = await this.host.selectModel(task.sessionId, selection);
    }
    async models() {
        if (!this.host.models)
            throw new ConnectionError('model-catalog-unavailable');
        return this.host.models();
    }
    async directory(cwd) {
        if (!isAbsolute(cwd))
            throw new ConnectionError('absolute-directory-required');
        let canonical;
        try {
            canonical = await realpath(cwd);
            if (!(await stat(canonical)).isDirectory())
                throw new Error();
        }
        catch {
            throw new ConnectionError('directory-unavailable');
        }
        const roots = await Promise.all(this.configuration().allowedDirectories.map(path => realpath(path).catch(() => false)));
        if (!roots.some(root => root !== false && withinDirectory(root, canonical)))
            throw new ConnectionError('directory-not-allowed');
        return canonical;
    }
    async capacity(cwd, except = '') {
        await this.refreshPending(except);
        const pending = this.records.filter(row => row.id !== except && (activeTask(row.status) || row.status === 'interrupted'));
        const details = { blockingTasks: pending.map(row => ({ taskId: row.id, cwd: row.cwd, status: row.status })) };
        if (pending.length >= this.configuration().maxConnections)
            throw new ConnectionError('concurrency-limit', details);
        const root = await gitWorktreeRoot(cwd);
        const roots = await Promise.all(pending.map(row => gitWorktreeRoot(row.cwd)));
        if (pending.some((row, index) => withinDirectory(row.cwd, cwd) || withinDirectory(cwd, row.cwd)
            || root !== false && root === roots[index]))
            throw new ConnectionError('workspace-busy', details);
    }
    async run(input) {
        const task = await this.exclusive(async () => {
            this.enabled();
            const cwd = await this.directory(input.cwd);
            const request = { cwd, prompt: input.prompt, client: input.client ?? 'mcp' };
            const fingerprint = input.modelSelection ? digest({ ...request, modelSelection: input.modelSelection }) : digest(request);
            const prior = this.records.find(row => row.requestId === input.requestId);
            if (prior) {
                if (prior.fingerprint !== fingerprint)
                    throw new ConnectionError('request-conflict');
                if (input.connectionId && prior.connectionId !== input.connectionId) {
                    prior.connectionId = input.connectionId;
                    await this.persist();
                }
                return prior;
            }
            if (!this.configuration().allowNewConversations)
                throw new ConnectionError('new-conversation-disabled');
            if (this.records.length >= 200)
                throw new ConnectionError('task-history-full');
            await this.capacity(cwd);
            const preset = await this.host.preset(), id = `sc-${randomUUID()}`, now = Date.now();
            const row = { id, sessionId: id, requestId: input.requestId, fingerprint, cwd, preset,
                client: input.client ?? 'mcp', status: 'starting', cancellationRequested: false, createdAt: now, updatedAt: now, currentRequest: randomUUID(),
                output: '', sequence: 0, events: [], operations: {}, baseline: await gitSnapshot(cwd), ...(input.connectionId ? { connectionId: input.connectionId } : {}) };
            this.event(row, 'starting', 'Dispatch intent saved. A DSH turn ending does not verify task acceptance.');
            this.records.push(row);
            await this.persist();
            try {
                await this.host.create(row.sessionId, cwd, preset, `[MCP] ${input.client ?? 'conversation'}`);
            }
            catch {
                this.event(row, 'failed', 'Session creation failed. No prompt was sent.');
                await this.persist();
                return row;
            }
            try {
                await this.selectModel(row, input.modelSelection);
            }
            catch {
                this.event(row, 'failed', 'Requested model or reasoning effort could not be selected. No prompt was sent.');
                await this.persist();
                return row;
            }
            try {
                await this.host.prompt(row.sessionId, row.currentRequest, input.prompt);
                this.event(row, 'running', 'Prompt accepted by DSH.');
            }
            catch {
                this.event(row, 'interrupted', 'Prompt admission could not be confirmed. No automatic retry; inspect the DSH session before continuing.');
            }
            await this.persist();
            return row;
        });
        return this.view(task.id, 0);
    }
    async send(input) {
        await this.exclusive(async () => {
            this.enabled();
            const task = this.owned(input.taskId), fingerprint = input.modelSelection
                ? digest({ prompt: input.prompt, modelSelection: input.modelSelection })
                : digest(input.prompt);
            const cwd = await this.directory(input.cwd ?? task.cwd);
            if (cwd !== task.cwd)
                throw new ConnectionError('task-directory-mismatch');
            if (input.requestId === task.requestId) {
                const request = { cwd, prompt: input.prompt, client: task.client };
                const initial = input.modelSelection ? digest({ ...request, modelSelection: input.modelSelection }) : digest(request);
                if (initial !== task.fingerprint)
                    throw new ConnectionError('request-conflict');
                if (input.connectionId && task.connectionId !== input.connectionId) {
                    task.connectionId = input.connectionId;
                    await this.persist();
                }
                return;
            }
            const prior = Object.hasOwn(task.operations, input.requestId) ? task.operations[input.requestId] : false;
            if (prior) {
                if (prior !== fingerprint)
                    throw new ConnectionError('request-conflict');
                if (input.connectionId && task.connectionId !== input.connectionId) {
                    task.connectionId = input.connectionId;
                    await this.persist();
                }
                return;
            }
            if (Object.keys(task.operations).length >= 128)
                throw new ConnectionError('task-operation-limit');
            await this.refresh(task);
            if (task.status === 'cancelling' || task.status === 'waiting_confirmation')
                throw new ConnectionError('resolve-in-dsh-first');
            await this.capacity(task.cwd, task.id);
            // Persist the operation before admission. A retry observes this intent; it never resends it.
            Object.defineProperty(task.operations, input.requestId, { value: fingerprint, enumerable: true, configurable: true, writable: true });
            task.currentRequest = randomUUID();
            task.cancellationRequested = false;
            if (input.connectionId)
                task.connectionId = input.connectionId;
            this.event(task, 'starting', 'Explicit continuation intent saved.');
            await this.persist();
            try {
                await this.selectModel(task, input.modelSelection);
            }
            catch {
                this.event(task, 'failed', 'Requested model or reasoning effort could not be selected. No prompt was sent.');
                await this.persist();
                return;
            }
            try {
                await this.host.prompt(task.sessionId, task.currentRequest, input.prompt);
                this.event(task, 'running', 'Continuation accepted by DSH.');
            }
            catch {
                this.event(task, 'interrupted', 'Continuation admission could not be confirmed; no automatic retry.');
            }
            await this.persist();
        });
        return this.view(input.taskId, 0);
    }
    async cancel(id) {
        await this.exclusive(async () => {
            this.enabled();
            const task = this.owned(id);
            await this.refresh(task);
            if (!activeTask(task.status) && task.status !== 'interrupted')
                return;
            task.cancellationRequested = true;
            this.approvals.withdraw(task.id, 'cancelled');
            this.event(task, 'cancelling', 'Cancellation requested; waiting for the root and managed descendants to stop.');
            await this.persist();
            try {
                await this.host.cancel(task.sessionId);
            }
            catch {
                this.event(task, 'unavailable', 'Could not confirm cancellation of the complete task tree. Check DSH.');
                await this.persist();
                return;
            }
            await this.refresh(task);
            await this.persist();
        });
        return this.view(id, 0);
    }
    async refresh(task) {
        if (!activeTask(task.status) && task.status !== 'interrupted')
            return;
        if (task.cancellationRequested)
            await this.host.cancel(task.sessionId).catch(() => { });
        const observation = await this.host.observe(task.sessionId, task.currentRequest, task.cancellationRequested);
        const status = task.cancellationRequested
            ? ['finished', 'interrupted', 'failed'].includes(observation.status) ? 'cancelled' : observation.status === 'unavailable' ? 'unavailable' : 'cancelling'
            : observation.status;
        const output = observation.status === 'unavailable' && !observation.output ? task.output : observation.output.slice(-12000);
        const changed = task.output !== output || JSON.stringify(task.observation) !== JSON.stringify(observation.observation ?? task.observation);
        task.output = output;
        if (observation.observation)
            task.observation = observation.observation;
        if (task.status !== status || changed) {
            this.event(task, status, observation.detail);
            await this.persist();
        }
    }
    async refreshPending(except = '') {
        for (const task of this.records)
            if (task.id !== except && (activeTask(task.status) || task.status === 'interrupted')) {
                try {
                    await this.refresh(task);
                }
                catch {
                    if (task.status !== 'unavailable') {
                        this.event(task, 'unavailable', 'Task observation is unavailable; no request was replayed.');
                        await this.persist();
                    }
                }
            }
    }
    async tick() {
        await this.exclusive(async () => {
            if (this.closed)
                return;
            await this.refreshPending();
        });
    }
    async snapshot(id) {
        return this.exclusive(async () => { const row = this.owned(id); await this.refresh(row); return structuredClone(row); });
    }
    async view(id, cursor) {
        return this.describe(await this.snapshot(id), cursor);
    }
    async describe(task, cursor) {
        const callerApproval = { enabled: this.configuration().allowCallerApproval, pending: this.approvals.pending(task.id) };
        return { taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, preset: task.preset, client: task.client,
            status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt, output: task.output,
            events: task.events.filter(event => event.cursor > cursor), cursor: task.sequence,
            eventsTruncated: cursor < (task.events[0]?.cursor ?? 1) - 1, acceptance: 'not-verified',
            workspace: await workspaceChanges(task.cwd, task.baseline), ...(task.modelSelection ? { modelSelection: task.modelSelection } : {}),
            ...(task.observation ? { observation: task.observation } : {}),
            callerApproval,
            nextAction: callerApproval.pending.length
                ? { action: 'caller-approval', message: 'Decide the exact pending operation through dsh_approve or the client confirmation request. Approval is one-time; use approvalId from callerApproval.pending.' }
                : task.status === 'waiting_confirmation'
                    ? { action: 'user-confirmation', message: 'Ask the user to resolve the confirmation in DSH; do not automate approval.' }
                    : ['starting', 'running', 'cancelling'].includes(task.status)
                        ? { action: 'wait', message: 'Continue through MCP; use this event cursor and long-poll rather than opening the serving app.', tool: 'dsh_wait', arguments: { taskId: task.id, cursor: task.sequence, waitMs: 30000 } }
                        : { action: 'read-history', message: 'Inspect public history with MCP. Verify results independently; do not reinstall or reconfigure the serving app. An interruption or failure is never automatically resent.', tool: 'dsh_read', arguments: { taskId: task.id } } };
    }
    async list(cursor) {
        return this.exclusive(async () => {
            const rows = [...this.records].reverse();
            return { tasks: rows.slice(cursor, cursor + 25).map(task => ({ taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, client: task.client, status: task.status, updatedAt: task.updatedAt })),
                nextCursor: cursor + 25 < rows.length ? cursor + 25 : false };
        });
    }
    async sessions(cwd, limit, status) {
        this.enabled();
        const canonical = await this.directory(cwd);
        return this.exclusive(async () => {
            await this.refreshPending();
            const rows = this.records.filter(task => task.cwd === canonical).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt).slice(0, Math.min(Math.max(limit, 1), 25));
            const reusable = new Set(['finished', 'failed', 'cancelled']);
            const activeTasks = this.records.filter(task => activeTask(task.status) || task.status === 'interrupted').length;
            return { cwd: canonical, allowNewConversations: this.configuration().allowNewConversations, connections: status.connections, maxConnections: status.maxConnections,
                availableConnections: Math.max(status.maxConnections - status.connections, 0),
                activeTasks, availableTasks: Math.max(status.maxConnections - activeTasks, 0),
                sessions: rows.map(task => ({ taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, client: task.client, status: task.status,
                    createdAt: task.createdAt, updatedAt: task.updatedAt, connectionCount: task.connectionId && status.ids.includes(task.connectionId) ? 1 : 0,
                    reusable: reusable.has(task.status), ...(task.modelSelection ? { modelSelection: task.modelSelection } : {}) })) };
        });
    }
    async history(id, cursor, limit, descendantId) {
        this.enabled();
        const task = this.owned(id);
        await this.directory(task.cwd);
        if (!this.host.history)
            throw new ConnectionError('history-unavailable');
        return { ...await this.host.history(task.sessionId, cursor, limit, descendantId), taskId: task.id };
    }
    async status(connections) {
        this.enabled();
        return this.exclusive(async () => {
            await this.refreshPending();
            const config = this.configuration(), pending = this.records.filter(task => activeTask(task.status) || task.status === 'interrupted');
            return { role: 'delegation-executor', allowNewConversations: config.allowNewConversations, allowCallerApproval: config.allowCallerApproval, allowedDirectories: [...config.allowedDirectories],
                connections: connections.connections, maxConnections: connections.maxConnections, availableConnections: Math.max(connections.maxConnections - connections.connections, 0),
                activeTasks: pending.length, availableTasks: Math.max(config.maxConnections - pending.length, 0),
                blockingTasks: pending.map(task => ({ taskId: task.id, cwd: task.cwd, status: task.status })) };
        });
    }
    overview() {
        return [...this.records].reverse().map(task => ({ taskId: task.id, sessionId: task.sessionId, cwd: task.cwd, client: task.client,
            connectionId: task.connectionId ?? '', status: task.status, updatedAt: task.updatedAt }));
    }
    async wait(id, cursor, waitMs, signal) {
        const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30000);
        let task = await this.snapshot(id);
        while (activeTask(task.status) && task.status !== 'waiting_confirmation' && !this.approvals.pending(task.id).length && task.sequence <= cursor && Date.now() < deadline) {
            signal?.throwIfAborted();
            await pause(Math.min(1000, Math.max(1, deadline - Date.now())), undefined, { signal });
            task = await this.snapshot(id);
        }
        // Git observations are needed once per response, not at every internal status poll.
        return this.describe(task, cursor);
    }
    async close() { this.approvals.withdraw(); await this.exclusive(async () => { this.closed = true; await this.persist(); }); }
}
//# sourceMappingURL=tasks.js.map