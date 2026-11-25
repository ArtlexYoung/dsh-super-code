import { actions, defaults } from './editor/preferences.js';
import { toolbarActions, readToolbar } from './toolbar.js';

export const settingGroups = ['appearanceSettings', 'readingSettings', 'editingSettings', 'languageSettings', 'assistantSettings', 'toolbar', 'shortcut'];
export const environmentLanguages = [['python', 'Python'], ['javascript', 'JavaScript / TypeScript'], ['go', 'Go'], ['rust', 'Rust'], ['java', 'Java'], ['cpp', 'C / C++'], ['csharp', 'C#'], ['php', 'PHP'], ['ruby', 'Ruby']];
const fields = {
  appearanceSettings: ['palette', 'keymap', 'density', 'showToolbarShortcuts', 'showToolNames', 'windowMode'],
  readingSettings: ['fontFamily', 'chineseFontFamily', 'fontSize', 'lineHeight', 'stickyScroll', 'readerMode'],
  editingSettings: ['followFile', 'previewTabs', 'autoSave', 'undoLimit'],
  assistantSettings: ['quickModel', 'quickReasoning', 'translationModel', 'translationReasoning'],
};
const labels = { fontFamily: 'editorFont', chineseFontFamily: 'chineseFont', fontSize: 'editorFontSize', lineHeight: 'editorLineHeight' };
const hints = { undoLimit: 'undoHint', readerMode: 'readerModeHint', quickModel: 'modelSettingsHint', translationModel: 'modelSettingsHint' };

export function settingEntries(preferences, paths = {}) {
  const original = defaults(), toolbar = readToolbar();
  return [
    ...Object.entries(fields).flatMap(([group, keys]) => keys.map(id => ({ id, group, label: labels[id] || id, hint: hints[id], modified: preferences[id] !== original[id] }))),
    ...environmentLanguages.map(([language, name]) => ({ id: `environment.${language}`, group: 'languageSettings', label: 'environmentPath', detail: name, hint: 'environmentHint', modified: !!paths[language] })),
    { id: 'toolbarOrder', group: 'toolbar', label: 'toolbarOrder', modified: toolbar.some((item, index) => preferences.toolbar[index].id !== item.id) },
    ...toolbar.map(item => ({ id: `toolbar.${item.id}`, group: 'toolbar', label: toolbarActions.find(action => action.id === item.id).label, modified: preferences.toolbar.find(value => value.id === item.id).visible !== item.visible })),
    ...actions.map(action => ({ id: `shortcuts.${action.id}`, group: 'shortcut', label: `action_${action.id}`, modified: Object.hasOwn(preferences.shortcuts, action.id) })),
  ];
}

export function settingMatches(entry, query, modifiedOnly, t) {
  if (modifiedOnly && !entry.modified) return false;
  const text = [entry.id, t(entry.label), t(entry.group), entry.detail || '', entry.hint ? t(entry.hint) : ''].join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}

export function resetPreference(preferences, id) {
  const next = { ...preferences };
  if (id.startsWith('shortcuts.')) {
    next.shortcuts = { ...preferences.shortcuts }; delete next.shortcuts[id.slice(10)]; return next;
  }
  if (id.startsWith('toolbar.')) {
    const action = id.slice(8), original = readToolbar().find(item => item.id === action);
    next.toolbar = preferences.toolbar.map(item => item.id === action ? { ...item, visible: original.visible } : item); return next;
  }
  if (id === 'toolbarOrder') {
    next.toolbar = readToolbar().map(original => preferences.toolbar.find(item => item.id === original.id)); return next;
  }
  const value = defaults()[id];
  if (value === undefined) { delete next[id]; return next; }
  next[id] = value; return next;
}
