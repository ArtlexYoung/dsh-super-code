export const toolbarActions = [
  { id: 'back', label: 'back', icon: 'back', shortcut: 'back' },
  { id: 'forward', label: 'forward', icon: 'forward', shortcut: 'forward' },
  { id: 'find', label: 'find', icon: 'find', shortcut: 'find' },
  { id: 'replace', label: 'replace', icon: 'replace', shortcut: 'replace' },
  { id: 'project', label: 'search', icon: 'search', shortcut: 'project' },
  { id: 'projectReplace', label: 'projectReplace', icon: 'replace', shortcut: 'projectReplace' },
  { id: 'definition', label: 'definition', icon: 'definition', shortcut: 'definition' },
  { id: 'complete', label: 'complete', icon: 'complete', shortcut: 'complete' },
  { id: 'parameters', label: 'parameters', icon: 'function', shortcut: 'parameters' },
  { id: 'codeHistory', label: 'codeHistory', icon: 'git' },
  { id: 'save', label: 'save', icon: 'save', shortcut: 'save', fixed: true },
  { id: 'git', label: 'git', icon: 'git', fixed: true },
  { id: 'refresh', label: 'refreshShort', title: 'refresh', icon: 'refresh', fixed: true },
  { id: 'window', label: 'windowOpen', icon: 'window', fixed: true },
  { id: 'settings', label: 'settings', icon: 'settings', fixed: true },
  { id: 'undo', label: 'action_undo', shortcut: 'undo' },
  { id: 'redo', label: 'action_redo', shortcut: 'redo' },
];

export function readToolbar(value) {
  const defaults = toolbarActions.filter(item => !item.fixed).map(({ id }) => ({ id, visible: true }));
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
