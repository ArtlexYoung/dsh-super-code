import { scopeChainOf } from '@deepseek-ai/dsh-scope';
function serializedArguments(value) {
    try {
        const text = JSON.stringify(value);
        return typeof text === 'string' && text.length <= 16000 ? text : false;
    }
    catch {
        return false;
    }
}
export function applyConnectionApproval(ctx, current) {
    const active = new WeakMap();
    ctx.inject(['tools'], owner => {
        owner.on('tools/execute', async (exec, next) => {
            if (!exec.agent)
                return next();
            const agent = exec.agent, calls = active.get(agent) ?? new Set();
            const call = { callId: exec.callId, toolName: exec.name, arguments: serializedArguments(exec.arguments) };
            active.set(agent, calls);
            calls.add(call);
            try {
                return await next();
            }
            finally {
                calls.delete(call);
                if (!calls.size)
                    active.delete(agent);
            }
        }, { prepend: true });
    });
    ctx.on('approval/request', async (request, next) => {
        const service = current();
        if (!service || !service.read().configuration.allowCallerApproval)
            return next();
        const roots = scopeChainOf(request.agent).flatMap(key => {
            const id = key.session?.id;
            return typeof id === 'string' ? [id] : [];
        });
        // A seed parentSession alone does not authorize a fork. Only the live scope ancestry counts.
        let argumentsText = '';
        if (request.callId) {
            // PTC sub-calls have no native tool/call event. Bind the actual live
            // execution instead of relying on a journal version or an ID prefix.
            const calls = [...active.get(request.agent) ?? []].filter(call => call.callId === request.callId && call.toolName === request.toolName);
            if (calls.length) {
                if (calls.length !== 1 || calls[0].arguments === false)
                    return next();
                argumentsText = calls[0].arguments;
            }
            else {
                const events = request.agent.session.ownEvents();
                let found = false;
                for (let index = events.length - 1; index >= 0; index--) {
                    const event = events[index];
                    if (event.type === 'tool/call' && event.data.callId === request.callId && event.data.name === request.toolName) {
                        argumentsText = event.data.arguments;
                        found = true;
                        break;
                    }
                }
                if (!found)
                    return next();
            }
        }
        const answer = await service.requestApproval({ sessionId: request.agent.session.id, toolName: request.toolName,
            ...(request.callId ? { callId: request.callId } : {}), reason: request.reason ?? '', arguments: argumentsText }, roots, request.signal);
        if (request.signal?.aborted)
            return 'cancelled';
        return answer === 'host' ? next() : answer;
    }, { prepend: true });
}
//# sourceMappingURL=connection-approval.js.map