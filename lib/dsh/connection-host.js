import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { ConnectionError } from '../connection/types.js';
import { connectionHistoryPage, publicMessageText } from './connection-history.js';
function record(value) { return value && typeof value === 'object' ? value : {}; }
/** Own events only; idle without a settled, admitted request is not a completed task. */
export function connectionSessionFacts(events, agentStatus, requestId, cancelling = false) {
    let admitted = requestId === '', requestSeq = -1, endSeq = -1, reason = '', output = '', outputTruncated = false, errorCode = '';
    let lastEventSeq = -1, lastEventType = '';
    const approvals = new Set(), external = new Set();
    for (const event of events) {
        const data = record(event.data), type = event.type;
        if (type === 'user/message' && data.source?.rpcId === requestId) {
            admitted = true;
            requestSeq = event.seq;
            output = '';
            outputTruncated = false;
            errorCode = '';
        }
        if (admitted && ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'tool/ptc-dispatch', 'step/start', 'turn/end', 'approval/asked', 'approval/decided', 'llm/retry'].includes(type)) {
            lastEventSeq = event.seq;
            lastEventType = type;
        }
        if (type === 'turn/start') {
            reason = '';
            errorCode = '';
            approvals.clear();
        }
        if (type === 'turn/end') {
            endSeq = event.seq;
            reason = data.reason?.kind ?? '';
            errorCode = typeof data.reason?.error?.code === 'string' ? data.reason.error.code.slice(0, 128) : '';
            approvals.clear();
        }
        if (type === 'approval/asked' && typeof data.id === 'string')
            approvals.add(data.id);
        if (type === 'approval/decided')
            approvals.delete(data.id);
        if (type === 'subagent/start' && data.runId)
            external.add(data.runId);
        if (type === 'subagent/end')
            external.delete(data.runId);
        if (type === 'assistant/message' && admitted && event.seq > requestSeq) {
            const text = publicMessageText(data.message?.content ?? data.content);
            if (text) {
                let start = Math.max(0, text.length - 12000);
                if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1]))
                    start++;
                output = text.slice(start);
                outputTruncated = start > 0;
            }
        }
    }
    const observation = { lastEventSeq, lastEventType, outputTruncated, ...(errorCode ? { errorCode } : {}) };
    const result = (status) => ({ status, output, observation });
    if (approvals.size)
        return result('waiting_confirmation');
    if (agentStatus === 'running' || external.size)
        return result(agentStatus === 'missing' ? 'unavailable' : 'running');
    if (cancelling && agentStatus === 'idle')
        return result('interrupted');
    if (!admitted || endSeq <= requestSeq || !reason)
        return result(agentStatus === 'missing' ? 'unavailable' : 'running');
    if (reason === 'error' || reason === 'max-tokens')
        return result('failed');
    if (['aborted', 'interrupted', 'forked'].includes(reason))
        return result('interrupted');
    if (reason === 'blocked')
        return result('waiting_confirmation');
    return result(reason === 'completed' ? 'finished' : 'unavailable');
}
export class ConnectionHost {
    services;
    constructor(services) {
        this.services = services;
    }
    async preset() {
        const preset = await this.services.presets.status();
        if (!['available', 'installed'].includes(preset.state))
            throw new ConnectionError('super-code-preset-unavailable');
        return preset.id;
    }
    async create(sessionId, cwd, preset, title = `[MCP] ${basename(cwd) || 'conversation'}`) {
        const rows = this.services.workspaceRegistry?.list() ?? [];
        let workspace;
        for (const row of rows) {
            try {
                if (await realpath(row.path) === cwd) {
                    workspace = row;
                    break;
                }
            }
            catch { /* An unavailable workspace cannot own a new session. */ }
        }
        if (!workspace && this.services.workspaceRegistry?.create) {
            workspace = await this.services.workspaceRegistry.create(cwd);
        }
        const request = workspace
            ? { sessionId, workspaceId: workspace.id, agentPreset: preset }
            : { sessionId, cwd, agentPreset: preset };
        const created = await this.services.controller.create(request);
        if (created.sessionId !== sessionId || created.agentPreset !== undefined && created.agentPreset !== preset)
            throw new ConnectionError('session-identity-mismatch');
        if (this.services.controller.rename) {
            try {
                await this.services.controller.rename({ sessionId, title });
            }
            catch { /* Older hosts may mount no session-title service; execution remains usable. */ }
        }
    }
    async models() {
        if (!this.services.controller.modelCatalog)
            throw new ConnectionError('model-catalog-unavailable');
        return this.services.controller.modelCatalog();
    }
    async history(sessionId, cursor, limit, descendantId = sessionId) {
        const descendants = await this.services.subagents.listDescendants(sessionId, AbortSignal.timeout(5000)).catch(() => []);
        if (descendantId !== sessionId && !descendants.some(child => child.id === descendantId))
            throw new ConnectionError('history-session-not-owned');
        const cut = await this.services.query.observeSession(descendantId, { projectionMode: 'none', signal: AbortSignal.timeout(5000) });
        try {
            return { ...connectionHistoryPage(cut.events.slice(cut.inheritedEventCount), cursor, limit), sessionId: descendantId,
                descendants: descendants.slice(0, 100).map(child => ({ sessionId: child.id, kind: child.kind })), descendantsTruncated: descendants.length > 100 };
        }
        finally {
            cut[Symbol.dispose]();
        }
    }
    async selectModel(sessionId, selection) {
        if (!this.services.controller.selectModel)
            throw new ConnectionError('model-selection-unavailable');
        const result = await this.services.controller.selectModel({ sessionId, ...selection });
        const selected = result.selected;
        return { provider: selected.provider, model: selected.model,
            ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}) };
    }
    async prompt(sessionId, requestId, prompt) {
        await this.services.controller.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, new AbortController().signal);
    }
    async facts(id, requestId, cancelling = false) {
        const cut = await this.services.query.observeSession(id, { projectionMode: 'none', signal: AbortSignal.timeout(5000) });
        try {
            const events = cut.events.slice(cut.inheritedEventCount);
            let requestAt = 0, endedAt = 0;
            for (const event of events) {
                if (event.type === 'user/message' && record(event.data).source?.rpcId === requestId)
                    requestAt = event.time;
                if (event.type === 'turn/end')
                    endedAt = event.time;
            }
            return { ...connectionSessionFacts(events, this.services.agents.get(id)?.status ?? 'missing', requestId, cancelling), requestAt, endedAt };
        }
        finally {
            cut[Symbol.dispose]();
        }
    }
    async observe(sessionId, requestId, cancelling = false) {
        try {
            const root = await this.facts(sessionId, requestId, cancelling);
            const children = await this.services.subagents.listDescendants(sessionId, AbortSignal.timeout(5000));
            let status = root.status;
            for (const child of children) {
                if (child.kind === 'diagnostic') {
                    status = 'unavailable';
                    break;
                }
                if (child.mode === 'external')
                    continue; // Root start/end run facts track these activations.
                const facts = await this.facts(child.id, '', cancelling);
                if (facts.status === 'waiting_confirmation') {
                    status = 'waiting_confirmation';
                    break;
                }
                if (facts.status === 'unavailable') {
                    status = 'unavailable';
                    break;
                }
                if (facts.status === 'running' && status !== 'waiting_confirmation')
                    status = 'running';
                // Catalogs retain old children. A settled failure from before this request must not fail every later continuation.
                if (['failed', 'interrupted'].includes(facts.status) && status === 'finished'
                    && (!root.requestAt || !facts.endedAt || facts.endedAt >= root.requestAt))
                    status = 'failed';
            }
            return { status, output: root.output, observation: root.observation, detail: status === 'finished' ? 'Root and managed descendants settled. Acceptance has not been verified.'
                    : status === 'failed' ? `DSH task tree failed${root.observation.errorCode ? ` (${root.observation.errorCode})` : ''}; inspect public history with dsh_read. No automatic retry.`
                        : status === 'waiting_confirmation' ? 'A permission request or blocked turn is pending. Check dsh_wait.callerApproval for the authorized approval path; otherwise resolve it in DSH.' : `DSH task tree: ${status}.` };
        }
        catch {
            return { status: 'unavailable', output: '', detail: 'Could not observe the complete DSH task tree. No request was replayed.' };
        }
    }
    async cancel(sessionId) {
        // Clear queued follow-ups as well as aborting the root, so cancellation cannot wake another turn.
        this.services.agents.get(sessionId)?.cancel({ kind: 'user' }, { keepInbox: false });
        const children = await this.services.subagents.listDescendants(sessionId, AbortSignal.timeout(5000));
        for (const child of [...children].reverse()) {
            if (child.kind === 'diagnostic')
                throw new ConnectionError('cancellation-unconfirmed');
            const agent = this.services.agents.get(child.id);
            agent?.cancel({ kind: 'user' }, { keepInbox: false });
            if (child.mode === 'external' || agent?.status === 'running') {
                await this.services.subagents.interrupt(child.id, { kind: 'user', parentSessionId: child.parentId });
            }
        }
    }
}
//# sourceMappingURL=connection-host.js.map