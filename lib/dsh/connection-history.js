import { recordedToolResult } from '../core/host-messages.js';
import { ConnectionError } from '../connection/types.js';
export function publicMessageText(content) {
    return Array.isArray(content) ? content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
}
function publicEvent(event) {
    const data = event.data, type = event.type;
    switch (type) {
        case 'assistant/message': return { text: publicMessageText(data.message?.content ?? data.content) };
        case 'user/message': return { text: publicMessageText(data.content ?? data.message?.content) };
        case 'tool/call': return { text: `${data.name ?? 'tool'}\n${typeof data.arguments === 'string' ? data.arguments : ''}` };
        case 'tool/result': {
            const result = recordedToolResult(data.message);
            return result.kind === 'record' ? { text: result.texts.join('\n'), isError: result.isError } : { text: '[Tool result layout unavailable]' };
        }
        case 'turn/end': return { text: JSON.stringify({ reason: data.reason?.kind ?? 'unknown', ...(typeof data.reason?.error?.code === 'string' ? { errorCode: data.reason.error.code.slice(0, 128) } : {}) }) };
        case 'approval/asked': return { text: 'User confirmation required in DSH.' };
        case 'approval/decided': return { text: 'DSH confirmation resolved.' };
        default: return { text: '' };
    }
}
export function connectionHistoryPage(events, cursor, limit) {
    if (!Number.isSafeInteger(cursor.seq) || cursor.seq < 0 || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new ConnectionError('invalid-history-cursor');
    const entries = [];
    let index = events.findIndex(event => event.seq >= cursor.seq), nextCursor = { ...cursor }, chars = 0, scanned = 0;
    if (index < 0) {
        if (cursor.offset)
            throw new ConnectionError('invalid-history-cursor');
        return { entries, nextCursor, hasMore: false, scope: 'own-public-events' };
    }
    if (cursor.offset && events[index].seq !== cursor.seq)
        throw new ConnectionError('invalid-history-cursor');
    while (index < events.length && entries.length < limit && chars < 16000 && scanned++ < 2000) {
        const event = events[index], content = publicEvent(event), offset = event.seq === cursor.seq ? cursor.offset : 0;
        if (offset > content.text.length || offset > 0 && /[\uD800-\uDBFF]/.test(content.text[offset - 1]) && /[\uDC00-\uDFFF]/.test(content.text[offset]))
            throw new ConnectionError('invalid-history-cursor');
        let end = Math.min(content.text.length, offset + Math.min(4000, 16000 - chars));
        if (end < content.text.length && /[\uD800-\uDBFF]/.test(content.text[end - 1]))
            end--;
        if (content.text.length > offset) {
            entries.push({ seq: event.seq, type: event.type, offset, totalChars: content.text.length, text: content.text.slice(offset, end), ...(content.isError === undefined ? {} : { isError: content.isError }) });
            chars += end - offset;
        }
        nextCursor = end < content.text.length ? { seq: event.seq, offset: end } : { seq: event.seq + 1, offset: 0 };
        if (end < content.text.length)
            break;
        index++;
    }
    return { entries, nextCursor, hasMore: index < events.length, scope: 'own-public-events' };
}
//# sourceMappingURL=connection-history.js.map