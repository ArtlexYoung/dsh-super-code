import { ProtocolError } from './protocol.js';
const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, toolCalls: 0, latencyMs: 0 });
function usage(value, field) {
    if (value === undefined)
        return 0;
    if (!Number.isFinite(value) || value < 0)
        throw new ProtocolError(`${field} must be a non-negative finite number`, 'INVALID_USAGE');
    return value;
}
function add(left, right) {
    const inputTokens = usage(right?.inputTokens, 'usage.inputTokens');
    const outputTokens = usage(right?.outputTokens, 'usage.outputTokens');
    const totalTokens = usage(right?.totalTokens, 'usage.totalTokens');
    if (right?.totalTokens !== undefined && totalTokens < inputTokens + outputTokens)
        throw new ProtocolError('usage.totalTokens must cover inputTokens + outputTokens', 'INVALID_USAGE');
    return { inputTokens: left.inputTokens + inputTokens, outputTokens: left.outputTokens + outputTokens, totalTokens: left.totalTokens + (right?.totalTokens === undefined ? inputTokens + outputTokens : totalTokens), cachedTokens: left.cachedTokens + usage(right?.cachedTokens, 'usage.cachedTokens'), toolCalls: left.toolCalls + usage(right?.toolCalls, 'usage.toolCalls'), latencyMs: left.latencyMs + usage(right?.latencyMs, 'usage.latencyMs') };
}
function compact(messages, maxChars) {
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (total <= maxChars)
        return messages;
    const marker = { role: 'tool', content: '[earlier conversation omitted]' };
    const first = messages[0];
    const last = messages.at(-1);
    if (first === undefined || last === undefined)
        return [];
    const previous = messages.length > 1 ? messages.at(-2) : undefined;
    const required = [first, ...(previous === undefined || previous === first ? [] : [previous]), ...(last === first || last === previous ? [] : [last])];
    const available = Math.max(0, maxChars - marker.content.length);
    const weights = required.map((message, index) => index === 0 ? 0.25 : index === required.length - 1 ? 0.35 : 0.4);
    const clipped = required.map((message, index) => {
        const limit = Math.max(1, Math.floor(available * (weights[index] ?? 0)));
        return message.content.length <= limit ? message : { ...message, content: `${message.content.slice(0, Math.max(0, limit - 1))}…` };
    });
    const requiredLength = clipped.reduce((sum, message) => sum + message.content.length, 0);
    const middleBudget = Math.max(0, available - requiredLength);
    let middleLength = 0;
    const middle = messages.slice(1, -2).reduceRight((acc, message) => {
        if (middleLength + message.content.length > middleBudget)
            return acc;
        middleLength += message.content.length;
        acc.unshift(message);
        return acc;
    }, []);
    return [clipped[0], marker, ...middle, ...clipped.slice(1)];
}
/** Run a multi-turn conversation while bounding the history sent to the host. */
export async function runConversationWorkflow(turns, callbacks, options = {}, signal = new AbortController().signal) {
    if (!Array.isArray(turns) || turns.length === 0 || turns.some(turn => typeof turn !== 'string' || turn.trim() === ''))
        throw new ProtocolError('turns must contain non-empty strings', 'INVALID_ARGUMENT');
    if (!callbacks || typeof callbacks.generate !== 'function')
        throw new ProtocolError('generate callback is required', 'INVALID_ARGUMENT');
    const maxHistoryChars = options.maxHistoryChars ?? 12_000;
    if (!Number.isSafeInteger(maxHistoryChars) || maxHistoryChars < 128)
        throw new ProtocolError('maxHistoryChars must be at least 128', 'INVALID_ARGUMENT');
    const messages = [];
    const generations = [];
    let aggregate = emptyUsage();
    for (let index = 0; index < turns.length; index += 1) {
        if (signal.aborted)
            throw signal.reason ?? new Error('conversation aborted');
        const user = turns[index].trim();
        const context = compact([...messages, { role: 'user', content: user }], maxHistoryChars);
        const generation = await callbacks.generate({ turn: index + 1, user, messages: context, signal });
        if (!generation || typeof generation.text !== 'string' || generation.text.trim() === '')
            throw new ProtocolError(`turn ${index + 1} generation must contain text`, 'INVALID_RESULT');
        generations.push(generation);
        aggregate = add(aggregate, generation.usage);
        messages.push({ role: 'user', content: user }, { role: 'assistant', content: generation.text.trim() });
    }
    return { messages: compact(messages, maxHistoryChars), generations, usage: aggregate };
}
export default runConversationWorkflow;
//# sourceMappingURL=conversation.js.map