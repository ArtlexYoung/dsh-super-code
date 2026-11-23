import { matchFiles } from './file-search.js';

export function navigationMode(query) { return ({ '>': 'commands', '@': 'symbols', '#': 'projectSymbols' })[query[0]] || 'files'; }

export function fileLocation(query, paths, current) {
  const text = query.trim();
  if (paths.includes(text)) return { path: text };
  const match = /^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/.exec(text);
  if (!match) return { path: text };
  const line = Number(match[2]), column = Number(match[3] || 1);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return { path: text };
  return { path: match[1] || current || text, line: line - 1, character: column - 1 };
}

export const symbolItems = symbols => symbols.map(item => ({ key: `symbol:${item.file}:${item.offset}`, label: item.name, detail: `${item.file}:${item.line + 1}:${item.character + 1}`, target: item }));

export function navigationItems(query, snapshot, files, commands) {
  const mode = navigationMode(query), text = (mode === 'files' ? query : query.slice(1)).trim().toLowerCase();
  if (mode === 'commands') return commands.filter(item => `${item.label} ${item.id}`.toLowerCase().includes(text))
    .map(item => ({ ...item, key: item.id, detail: item.shortcut }));
  if (mode === 'symbols') return symbolItems(snapshot.symbols.filter(item => item.name.toLowerCase().includes(text)));
  if (mode === 'projectSymbols') return [];
  const recent = snapshot.recentFiles || [], paths = [...new Set([...recent.filter(path => path !== snapshot.file), ...recent, ...files])];
  const { path: search, ...location } = fileLocation(query, paths, snapshot.file);
  return (search ? matchFiles(paths, search) : paths).map(path => ({ key: path, label: path.split('/').at(-1),
    detail: location.line === undefined ? path : `${path}:${location.line + 1}:${location.character + 1}`, target: { file: path, ...location } }));
}
