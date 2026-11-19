export const MAX_CONTEXT_CHARS: number = 256 * 1024

/** 请求偏移相对于摘取的源码；实际编辑仍使用完整文档的选区快照。 */
export function selectionContext(doc: { length: number; sliceString(from: number, to: number): string }, from: number, to: number): { text: string; from: number; to: number } {
  const selected = to - from
  if (selected > MAX_CONTEXT_CHARS) throw new Error('WORKBENCH_SELECTION_SIZE')
  let start = Math.max(0, from - Math.floor((MAX_CONTEXT_CHARS - selected) / 2))
  const end = Math.min(doc.length, start + MAX_CONTEXT_CHARS)
  start = Math.max(0, end - MAX_CONTEXT_CHARS)
  return { text: doc.sliceString(start, end), from: from - start, to: to - start }
}
