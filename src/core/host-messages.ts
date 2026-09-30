/** Normalize the two published Harness tool-result layouts at one boundary. */
export type RecordedToolResult = { kind: 'record'; callId: string; isError: boolean; texts: string[] } | { kind: 'unavailable' }

export function recordedToolResult(message: unknown): RecordedToolResult {
  if (!message || typeof message !== 'object') return { kind: 'unavailable' }
  const value = message as { role?: unknown; toolCallId?: unknown; isError?: unknown; content?: unknown }
  if (!Array.isArray(value.content)) return { kind: 'unavailable' }
  const block = value.role === 'tool' ? value : value.content.length === 1 && value.content[0]?.type === 'tool-result' ? value.content[0] : {}
  if (typeof block.toolCallId !== 'string' || !Array.isArray(block.content) || (block.isError !== undefined && typeof block.isError !== 'boolean')) return { kind: 'unavailable' }
  return { kind: 'record', callId: block.toolCallId, isError: block.isError === true,
    texts: block.content.filter((item: unknown) => item && typeof item === 'object' && (item as { type?: unknown }).type === 'text' && typeof (item as { text?: unknown }).text === 'string').map((item: { text: string }) => item.text) }
}
