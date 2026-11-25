export interface SearchQuery {
  search: string
  caseSensitive: boolean
  replace?: string
  wholeWord?: boolean
  regexp?: boolean
  directory?: string
  include?: string
  exclude?: string
}
export const projectSearchDefaults = { search: '', replace: '', caseSensitive: false, wholeWord: false, regexp: false, directory: '', include: '', exclude: '' }
export const searchQueryKey = (query: SearchQuery): string => JSON.stringify({ ...projectSearchDefaults, ...query })
export const searchText = (text: string): string => text.replace(/\r\n?/g, '\n')
const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function searchExpression(query: SearchQuery): RegExp {
  const pattern = query.regexp ? searchText(query.search) : escapePattern(searchText(query.search))
  const source = query.wholeWord ? `(?<![\\p{L}\\p{M}\\p{N}_$])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_$])` : pattern
  try { return new RegExp(source, query.caseSensitive ? 'gmu' : 'gimu') }
  catch (error) { throw new Error('WORKBENCH_SEARCH_REGEXP', { cause: error }) }
}

export function* searchMatches(text: string, query: SearchQuery): Generator<RegExpExecArray> {
  if (!query.search) return
  yield* text.matchAll(searchExpression(query))
}

export function* literalMatches(text: string, search: string, caseSensitive: boolean): Generator<{ from: number; to: number }> {
  if (!search) return
  for (const match of text.matchAll(new RegExp(escapePattern(search), caseSensitive ? 'gu' : 'giu'))) yield { from: match.index, to: match.index + match[0].length }
}

function numberedCapture(match: RegExpExecArray, digits: string, token: string): string {
  const index = Number(digits)
  if (index > 0 && index < match.length) return match[index] ?? ''
  const first = Number(digits[0])
  if (digits.length === 2 && first > 0 && first < match.length) return (match[first] ?? '') + digits[1]
  return token
}

/** 与 JavaScript 替换文本的捕获组语义一致；字面搜索的替换值不解释美元符号。 */
export function replacementText(text: string, match: RegExpExecArray, replacement: string): string {
  return replacement.replace(/\$(\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (token: string, part: string, name: string | undefined, digits: string | undefined) => {
    if (name !== undefined) return match.groups ? match.groups[name] ?? '' : token
    if (digits !== undefined) return numberedCapture(match, digits, token)
    if (part === '$') return '$'
    if (part === '&') return match[0]
    if (part === '`') return text.slice(0, match.index)
    return text.slice(match.index + match[0].length)
  })
}

type SearchScope = Pick<SearchQuery, 'directory' | 'include' | 'exclude'>
function pathRules(value = ''): RegExp[] {
  return value.split(/[,\n]/).map(value => value.trim()).filter(Boolean).map(pattern => {
    if (pattern.includes('\\') || pattern.includes('\0') || pattern.startsWith('/') || pattern.split('/').some(part => part === '..')) throw new Error('WORKBENCH_SEARCH_SCOPE')
    const path = pattern.replace(/^\.\//, '').replace(/\/$/, '')
    const tokens = path.match(/\*\*\/|\*\*|\*|\?|[^*?]+/g) || []
    const wildcards: Record<string, string> = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' }
    const source = tokens.map(token => wildcards[token] ?? escapePattern(token)).join('')
    return new RegExp((path.includes('/') ? '^' : '^(?:.*/)?') + source + '(?:/.*)?$')
  })
}
export function searchPathFilter(scope: SearchScope): { file: (path: string) => boolean; directory: (path: string) => boolean } {
  const directory = (scope.directory || '').trim().replace(/\/$/, ''), include = pathRules(scope.include), exclude = pathRules(scope.exclude)
  if (directory.includes('\\') || directory.includes('\0') || directory.startsWith('/') || /^[a-z]:/i.test(directory) || directory.split('/').some(part => part === '..' || part === '.')) throw new Error('WORKBENCH_SEARCH_SCOPE')
  const inside = (path: string) => !directory || path === directory || path.startsWith(directory + '/')
  const excluded = (path: string) => exclude.some(pattern => pattern.test(path))
  return {
    file: path => inside(path) && !excluded(path) && (!include.length || include.some(pattern => pattern.test(path))),
    directory: path => !excluded(path) && (inside(path) || directory.startsWith(path + '/')),
  }
}

export interface SearchLocation { line: number; character: number; length: number; lineText: string; sampleStart?: number }
const LOCATION_BATCH_SIZE = 256, LOCATION_CONTEXT_BEFORE = 80, LOCATION_SAMPLE_CHARS = 240

/** 返回编辑器的行列与选区长度，CRLF在编辑器中只占一个换行。 */
export function* locationBatches(text: string, search: string, caseSensitive: boolean, options: Pick<SearchQuery, 'wholeWord' | 'regexp'> = {}): Generator<SearchLocation[]> {
  text = searchText(text)
  const breaks = /\r\n?|\n/g
  let line = 0, start = 0, next = breaks.exec(text), batch: SearchLocation[] = []
  for (const match of searchMatches(text, { search, caseSensitive, ...options })) {
    const from = match.index, to = from + match[0].length
    while (next && next.index + next[0].length <= from) {
      start = next.index + next[0].length; line++; next = breaks.exec(text)
    }
    const end = next?.index ?? text.length, character = Math.min(end - start, from - start), sample = start + Math.max(0, character - LOCATION_CONTEXT_BEFORE)
    batch.push({ line, character, length: text.slice(from, to).replace(/\r\n/g, '\n').length, ...(sample > start ? { sampleStart: sample - start } : {}), lineText: text.slice(sample, Math.min(end, sample + LOCATION_SAMPLE_CHARS)) })
    if (batch.length === LOCATION_BATCH_SIZE) { yield batch; batch = [] }
  }
  if (batch.length) yield batch
}
