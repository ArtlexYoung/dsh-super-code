import { matchFiles } from './file-search.js';

export function navigationMode(query) { return query.startsWith('>') ? 'commands' : query.startsWith('@') ? 'symbols' : 'files'; }

export function navigationItems(query, snapshot, files, commands) {
  const mode = navigationMode(query), text = (mode === 'files' ? query : query.slice(1)).trim().toLowerCase();
  if (mode === 'commands') return commands.filter(item => `${item.label} ${item.id}`.toLowerCase().includes(text))
    .map(item => ({ ...item, key: item.id, detail: item.shortcut }));
  if (mode === 'symbols') return snapshot.symbols.filter(item => item.name.toLowerCase().includes(text))
    .map(item => ({ key: `symbol:${item.offset}`, label: item.name, detail: `${item.file}:${item.line + 1}`, target: item }));
  const recent = snapshot.recentFiles || [], paths = [...new Set([...recent.filter(path => path !== snapshot.file), ...recent, ...files])];
  return (text ? matchFiles(paths, text) : paths).map(path => ({ key: path, label: path.split('/').at(-1), detail: path, target: { file: path } }));
}
