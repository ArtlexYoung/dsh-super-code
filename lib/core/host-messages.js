export function recordedToolResult(message) {
    if (!message || typeof message !== 'object')
        return { kind: 'unavailable' };
    const value = message;
    if (!Array.isArray(value.content))
        return { kind: 'unavailable' };
    const block = value.role === 'tool' ? value : value.content.length === 1 && value.content[0]?.type === 'tool-result' ? value.content[0] : {};
    if (typeof block.toolCallId !== 'string' || !Array.isArray(block.content) || (block.isError !== undefined && typeof block.isError !== 'boolean'))
        return { kind: 'unavailable' };
    return { kind: 'record', callId: block.toolCallId, isError: block.isError === true,
        texts: block.content.filter((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string').map((item) => item.text) };
}
//# sourceMappingURL=host-messages.js.map