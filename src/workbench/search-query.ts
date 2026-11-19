export function* literalMatches(text: string, search: string, caseSensitive: boolean): Generator<{ from: number; to: number }> {
  if (!search) return
  const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu')
  for (const match of text.matchAll(expression)) yield { from: match.index, to: match.index + match[0].length }
}

export interface SearchLocation { line: number; character: number; length: number; lineText: string }
const LOCATION_BATCH_SIZE = 256, LOCATION_CONTEXT_BEFORE = 80, LOCATION_SAMPLE_CHARS = 240

/** 返回编辑器的行列与选区长度，CRLF在编辑器中只占一个换行。 */
export function* locationBatches(text: string, search: string, caseSensitive: boolean): Generator<SearchLocation[]> {
  const breaks = /\r\n?|\n/g
  let line = 0, start = 0, next = breaks.exec(text), batch: SearchLocation[] = []
  for (const match of literalMatches(text, search, caseSensitive)) {
    while (next && next.index + next[0].length <= match.from) {
      start = next.index + next[0].length; line++; next = breaks.exec(text)
    }
    const end = next?.index ?? text.length, character = Math.min(end - start, match.from - start), sample = start + Math.max(0, character - LOCATION_CONTEXT_BEFORE)
    batch.push({ line, character, length: text.slice(match.from, match.to).replace(/\r\n/g, '\n').length, lineText: text.slice(sample, Math.min(end, sample + LOCATION_SAMPLE_CHARS)) })
    if (batch.length === LOCATION_BATCH_SIZE) { yield batch; batch = [] }
  }
  if (batch.length) yield batch
}
