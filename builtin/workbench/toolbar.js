export const toolbarActions = [
  { id: 'back', label: 'back', icon: 'back', shortcut: 'back' },
  { id: 'forward', label: 'forward', icon: 'forward', shortcut: 'forward' },
  { id: 'navigateFiles', label: 'navigateFiles', icon: 'files', shortcut: 'navigateFiles' },
  { id: 'find', label: 'find', icon: 'find', shortcut: 'find' },
  { id: 'replace', label: 'replace', icon: 'replace', shortcut: 'replace', secondary: true },
  { id: 'project', label: 'search', icon: 'search', shortcut: 'project' },
  { id: 'projectReplace', label: 'projectReplace', icon: 'replace', shortcut: 'projectReplace', secondary: true },
  { id: 'definition', label: 'definition', icon: 'definition', shortcut: 'definition', secondary: true },
  { id: 'complete', label: 'complete', icon: 'complete', shortcut: 'complete', secondary: true },
  { id: 'parameters', label: 'parameters', icon: 'function', shortcut: 'parameters', secondary: true },
  { id: 'codeHistory', label: 'codeHistory', icon: 'git', secondary: true },
  { id: 'saveAll', label: 'saveAll', icon: 'save', shortcut: 'saveAll', secondary: true },
  { id: 'drafts', label: 'drafts', icon: 'files', secondary: true },
  { id: 'save', label: 'save', icon: 'save', shortcut: 'save', fixed: true },
  { id: 'git', label: 'git', icon: 'git', fixed: true },
  { id: 'refresh', label: 'refreshShort', title: 'refresh', icon: 'refresh', fixed: true },
  { id: 'window', label: 'windowOpen', icon: 'window', fixed: true },
  { id: 'settings', label: 'settings', icon: 'settings', fixed: true },
  { id: 'commandPalette', label: 'commandPalette', icon: 'complete', shortcut: 'commandPalette', fixed: true },
  { id: 'undo', label: 'action_undo', shortcut: 'undo', secondary: true },
  { id: 'redo', label: 'action_redo', shortcut: 'redo', secondary: true },
  { id: 'navigateSymbols', label: 'navigateSymbols', icon: 'outline', shortcut: 'navigateSymbols', secondary: true },
  { id: 'readingFocus', label: 'readingFocus', icon: 'focus', shortcut: 'readingFocus', secondary: true },
  { id: 'saveConflict', label: 'saveConflict', icon: 'replace', secondary: true },
  { id: 'reopenTab', label: 'reopenTab', icon: 'back', shortcut: 'reopenTab', secondary: true },
];

export function readToolbar(value) {
  const defaults = toolbarActions.filter(item => !item.fixed).map(({ id, secondary }) => ({ id, visible: !secondary }));
  if (value === undefined) return defaults;
  if (!Array.isArray(value)) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  const found = new Set();
  for (const item of value) {
    if (!item || !toolbarActions.some(({ id }) => id === item.id) || found.has(item.id) || typeof item.visible !== 'boolean') throw new Error('WORKBENCH_PREFERENCES_INVALID');
    found.add(item.id);
  }
  return [...value.filter(item => !toolbarActions.find(action => action.id === item.id).fixed).map(({ id, visible }) => ({ id, visible })), ...defaults.filter(({ id }) => !found.has(id))];
}

export function moveToolbar(items, id, offset) {
  const from = items.findIndex(item => item.id === id), to = from + offset;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const moved = [...items];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}
