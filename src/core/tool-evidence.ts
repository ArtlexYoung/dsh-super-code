import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { scanSessionPage } from './session-scan.js'

export interface ToolEvidenceIdentity {
  seq: number; type: 'call' | 'result'; callId: string; turn: number; step: number
  tool?: string; arguments?: string; truncated?: boolean; isError?: boolean
}
/** Discover identities only on demand; unmatched events remain explicit across pages. */
export async function listToolEvidence(end: number, before: number, eventAt: (seq: number) => SessionEvent | undefined, signal: AbortSignal): Promise<{
  kind: 'directory'; records: ToolEvidenceIdentity[]; nextBeforeSeq: number; done: boolean; scanned: number
}> {
  const records: ToolEvidenceIdentity[] = []
  const page = await scanSessionPage(end, before, eventAt, event => {
    if (event.type === 'tool/call') records.push({ seq: event.seq, type: 'call', callId: event.data.callId,
      turn: event.data.turn, step: event.data.step, tool: event.data.name, arguments: event.data.arguments.slice(0, 240), truncated: event.data.arguments.length > 240 })
    if (event.type === 'tool/result' && event.data.message.content.length === 1) {
      const block = event.data.message.content[0]!
      if (block.type === 'tool-result') records.push({ seq: event.seq, type: 'result', callId: block.toolCallId,
        turn: event.data.turn, step: event.data.step, isError: block.isError === true })
    }
    return records.length >= 12
  }, signal)
  return { kind: 'directory' as const, records, ...page }
}

export interface ToolEvidenceRef { sessionId: string; callSeq: number; resultSeq: number }
export type ToolEvidence = {
  kind: 'recorded'; ref: string; tool: string; callId: string; time: number
  outcome: 'tool-returned' | 'tool-error'; arguments: string; output: string; truncated: boolean
  acceptance: 'not-established'; currentCode: 'not-verified'
  outputChars: number; outputView: 'complete' | 'head-tail' | 'page'; offset?: number
  readMore?: { tool: 'super_code_task'; action: 'evidence'; record: { ref: string; offset: number } }
} | { kind: 'unavailable'; reason: string }

export function toolEvidenceRef(input: ToolEvidenceRef): string {
  if (!input.sessionId.trim() || !Number.isSafeInteger(input.callSeq) || input.callSeq < 0 || !Number.isSafeInteger(input.resultSeq) || input.resultSeq <= input.callSeq) throw new Error('Invalid tool evidence identity')
  return `dsh-tool:${encodeURIComponent(input.sessionId)}:${input.callSeq}:${input.resultSeq}`
}

export function parseToolEvidenceRef(ref: string): ToolEvidenceRef {
  const match = /^dsh-tool:([^:]+):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(ref)
  if (!match) throw new Error('Expected a dsh-tool evidence reference')
  const result = { sessionId: decodeURIComponent(match[1]!), callSeq: Number(match[2]), resultSeq: Number(match[3]) }
  if (toolEvidenceRef(result) !== ref) throw new Error('Noncanonical tool evidence reference')
  return result
}

/** Exact indexed reads only. A genuine tool return is not a test or delivery verdict. */
export function readToolEvidence(sessionId: string, ref: string, eventAt: (seq: number) => SessionEvent | undefined, offset?: number): ToolEvidence {
  let identity: ToolEvidenceRef
  try { identity = parseToolEvidenceRef(ref) } catch { return { kind: 'unavailable', reason: 'invalid reference' } }
  if (identity.sessionId !== sessionId) return { kind: 'unavailable', reason: 'reference belongs to another session' }
  const call = eventAt(identity.callSeq), result = eventAt(identity.resultSeq)
  if (call?.seq !== identity.callSeq || call.type !== 'tool/call' || result?.seq !== identity.resultSeq || result.type !== 'tool/result') return { kind: 'unavailable', reason: 'original tool records are missing' }
  const blocks = result.data.message.content
  if (blocks.length !== 1 || blocks[0]?.type !== 'tool-result' || blocks[0].toolCallId !== call.data.callId || call.data.turn !== result.data.turn || call.data.step !== result.data.step) return { kind: 'unavailable', reason: 'tool call and result do not match' }
  const block = blocks[0]
  // Keep references to original strings; never concatenate a large transcript.
  const parts = block.content.filter(item => item.type === 'text').map(item => item.text)
  const total = parts.reduce((sum, text, index) => sum + text.length + Number(index > 0), 0)
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0 || offset > total)) return { kind: 'unavailable', reason: 'output offset is outside the recorded text' }
  const slice = (start: number, end: number): string => {
    let position = 0, value = ''
    for (let index = 0; index < parts.length && position < end; index++) {
      if (index > 0) { if (position >= start && position < end) value += '\n'; position++ }
      const part = parts[index]!
      if (position + part.length > start) value += part.slice(Math.max(0, start - position), Math.max(0, end - position))
      position += part.length
    }
    return value
  }
  const isHigh = (text: string): boolean => /[\uD800-\uDBFF]$/.test(text)
  if (offset !== undefined && offset > 0 && isHigh(slice(offset - 1, offset)) && /^[\uDC00-\uDFFF]/.test(slice(offset, offset + 1))) {
    return { kind: 'unavailable', reason: 'output offset splits a Unicode character' }
  }
  const start = offset ?? 0
  let end = Math.min(total, start + 8000)
  if (end < total && isHigh(slice(end - 1, end))) end--
  const excerpt = offset === undefined && total > 8000
  let output = slice(start, end)
  if (excerpt) {
    let headEnd = 3000, tailStart = total - 4000
    if (isHigh(slice(headEnd - 1, headEnd))) headEnd--
    if (isHigh(slice(tailStart - 1, tailStart))) tailStart++
    output = `${slice(0, headEnd)}\n[Middle omitted; this excerpt is not a complete check result. Read pages only if needed.]\n${slice(tailStart, total)}`
  }
  const nextOffset = excerpt ? 0 : end
  return { kind: 'recorded', ref, tool: call.data.name, callId: call.data.callId, time: result.time,
    outcome: block.isError ? 'tool-error' : 'tool-returned', arguments: call.data.arguments.slice(0, 2000), output,
    outputChars: total, outputView: excerpt ? 'head-tail' : offset !== undefined ? 'page' : 'complete',
    ...(offset === undefined ? {} : { offset }),
    ...(nextOffset < total ? { readMore: { tool: 'super_code_task' as const, action: 'evidence' as const, record: { ref, offset: nextOffset } } } : {}),
    truncated: excerpt || start > 0 || end < total || call.data.arguments.length > 2000, acceptance: 'not-established', currentCode: 'not-verified' }
}
