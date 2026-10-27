import { scopeChainOf } from '@deepseek-ai/dsh-scope';
export function applyConnectionApproval(ctx, current) {
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
        const answer = await service.requestApproval({ sessionId: request.agent.session.id, toolName: request.toolName,
            ...(request.callId ? { callId: request.callId } : {}), reason: request.reason ?? '', arguments: argumentsText }, roots, request.signal);
        if (request.signal?.aborted)
            return 'cancelled';
        return answer === 'host' ? next() : answer;
    }, { prepend: true });
}
//# sourceMappingURL=connection-approval.js.map