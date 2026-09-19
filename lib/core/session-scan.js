import { setImmediate } from 'node:timers/promises';
/** Bounded backward lookup; yield between chunks so cancellation stays responsive. */
export async function scanSessionPage(end, before, eventAt, visit, signal) {
    if (!Number.isSafeInteger(before) || before < 0 || before > end)
        throw new Error('eventSeq must be an exclusive cursor between 0 and the session end');
    let cursor = before, scanned = 0;
    signal.throwIfAborted();
    while (cursor > 0 && scanned < 4096) {
        if (scanned > 0 && scanned % 256 === 0) {
            await setImmediate(undefined, { signal });
            signal.throwIfAborted();
        }
        const event = eventAt(--cursor);
        scanned++;
        if (event !== undefined && visit(event))
            break;
    }
    signal.throwIfAborted();
    return { nextBeforeSeq: cursor, done: cursor === 0, scanned };
}
//# sourceMappingURL=session-scan.js.map