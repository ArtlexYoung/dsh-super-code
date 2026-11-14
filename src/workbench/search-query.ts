export function* literalMatches(text: string, search: string, caseSensitive: boolean): Generator<{ from: number; to: number }> {
  if (!search) return
  const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu')
  for (const match of text.matchAll(expression)) yield { from: match.index, to: match.index + match[0].length }
}
