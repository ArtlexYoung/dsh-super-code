import { ProtocolError } from './protocol.js'

/** Stable requirements extracted from the user side of a multi-turn task. */
export interface ConversationContract {
  readonly requirements: readonly string[]
  readonly text: string
}

const CONTRACT_PATTERNS = [
  /(?<![A-Za-z])(?:Python|C\+\+|JavaScript|TypeScript|Java|Go|Rust|HTML|CSS|SQL)(?![A-Za-z])/gi,
  /\b(?:zero|one|0|1)[ -]based\s+index(?:ing)?\b/gi,
  /\bO\s*\([^\n)]{1,32}\)/gi,
  /\b(?:recurs(?:ive|ion)|iterative|memo(?:ization|isation)|dynamic\s+programming|in[- ]place|stable|case[- ]sensitive|thread[- ]safe|asynchronous|synchronous)\b[^.!?\n]{0,80}/gi,
  /\b(?:without|avoid|must|should|only|return|preserve|keep|do not|don't)\b[^.!?\n]{0,100}/gi,
  /`[^`\n]{1,100}`/g,
]

function contractRequirements(turns: readonly string[]): readonly string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const turn of turns) {
    for (const pattern of CONTRACT_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of turn.matchAll(pattern)) {
        const value = match[0].replace(/\s+/g, ' ').trim()
        const key = value.toLocaleLowerCase()
        if (value.length < 2 || seen.has(key)) continue
        seen.add(key)
        values.push(value)
      }
    }
  }
  return values
}

/** Build a bounded contract without interpreting or rewriting task semantics. */
export function extractConversationContract(turns: readonly string[], maxChars = 1_200): ConversationContract {
  if (!Array.isArray(turns) || turns.some(turn => typeof turn !== 'string')) throw new ProtocolError('turns must contain strings', 'INVALID_ARGUMENT')
  if (!Number.isSafeInteger(maxChars) || maxChars < 64) throw new ProtocolError('maxContractChars must be at least 64', 'INVALID_ARGUMENT')
  const requirements: string[] = []
  let length = 0
  for (const value of contractRequirements(turns)) {
    const line = `- ${value}`
    if (length + line.length + (requirements.length === 0 ? 0 : 1) > maxChars) break
    requirements.push(value)
    length += line.length + (requirements.length === 1 ? 0 : 1)
  }
  return { requirements, text: requirements.length === 0 ? '' : `Stable task constraints:\n${requirements.map(value => `- ${value}`).join('\n')}` }
}
