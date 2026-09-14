import { ProtocolError } from './protocol.js';
const CONTRACT_PATTERNS = [
    /\b(?:Python|C\+\+|JavaScript|TypeScript|Java|Go|Rust|HTML|CSS|SQL)\b/gi,
    /\b(?:zero|one|0|1)[ -]based\s+index(?:ing)?\b/gi,
    /\bO\s*\([^\n)]{1,32}\)/gi,
    /\b(?:without|avoid|must|should|only|return|preserve|keep|do not|don't)\b[^.!?\n]{0,100}/gi,
    /`[^`\n]{1,100}`/g,
];
function contractRequirements(turns) {
    const values = [];
    const seen = new Set();
    for (const turn of turns) {
        for (const pattern of CONTRACT_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of turn.matchAll(pattern)) {
                const value = match[0].replace(/\s+/g, ' ').trim();
                const key = value.toLocaleLowerCase();
                if (value.length < 2 || seen.has(key))
                    continue;
                seen.add(key);
                values.push(value);
            }
        }
    }
    return values;
}
/** Build a bounded contract without interpreting or rewriting task semantics. */
export function extractConversationContract(turns, maxChars = 1_200) {
    if (!Array.isArray(turns) || turns.some(turn => typeof turn !== 'string'))
        throw new ProtocolError('turns must contain strings', 'INVALID_ARGUMENT');
    if (!Number.isSafeInteger(maxChars) || maxChars < 64)
        throw new ProtocolError('maxContractChars must be at least 64', 'INVALID_ARGUMENT');
    const requirements = [];
    let length = 0;
    for (const value of contractRequirements(turns)) {
        const line = `- ${value}`;
        if (length + line.length + (requirements.length === 0 ? 0 : 1) > maxChars)
            break;
        requirements.push(value);
        length += line.length + (requirements.length === 1 ? 0 : 1);
    }
    return { requirements, text: requirements.length === 0 ? '' : `Stable task constraints:\n${requirements.map(value => `- ${value}`).join('\n')}` };
}
//# sourceMappingURL=conversation-contract.js.map