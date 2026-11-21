import { saveDelays } from '../editing/autosave.js';
import { readToolbar } from '../toolbar.js';
import { appearanceDefaults, readAppearance } from './appearance.js';

export const actions = [
  { id: 'navigateFiles', idea: 'Mod-Shift-o', vscode: 'Mod-p', surface: true },
  { id: 'navigateSymbols', idea: 'Mod-F12', vscode: 'Mod-Shift-o', surface: true },
  { id: 'commandPalette', idea: 'Mod-Shift-p', vscode: 'Mod-Shift-p', surface: true },
  { id: 'readingFocus', idea: 'Mod-Shift-Enter', vscode: 'Mod-Shift-Enter', surface: true },
  { id: 'close', idea: 'Escape', vscode: 'Escape', dialog: true },
  { id: 'definition', idea: 'Mod-b', vscode: 'F12' },
  { id: 'complete', idea: 'Ctrl-Space', vscode: 'Ctrl-Space' },
  { id: 'parameters', idea: 'Mod-p', vscode: 'Mod-Shift-Space' },
  { id: 'find', idea: 'Mod-f', vscode: 'Mod-f', global: true },
  { id: 'project', idea: 'Mod-Shift-f', vscode: 'Mod-Shift-f', global: true },
  { id: 'replace', idea: 'Mod-r', vscode: 'Mod-r', global: true },
  { id: 'projectReplace', idea: 'Mod-Shift-r', vscode: 'Mod-Shift-r', global: true },
  { id: 'save', idea: 'Mod-s', vscode: 'Mod-s', global: true },
  { id: 'back', idea: 'Alt-ArrowLeft', vscode: 'Alt-ArrowLeft', global: true },
  { id: 'forward', idea: 'Alt-ArrowRight', vscode: 'Alt-ArrowRight', global: true },
  { id: 'indent', idea: 'Tab', vscode: 'Tab' },
  { id: 'outdent', idea: 'Shift-Tab', vscode: 'Shift-Tab' },
  { id: 'undo', idea: 'Mod-z', vscode: 'Mod-z', global: true },
  { id: 'redo', idea: 'Mod-Shift-z', vscode: 'Mod-y', global: true },
  { id: 'comment', idea: 'Mod-/', vscode: 'Mod-/' },
  { id: 'caretAbove', idea: 'Ctrl-Alt-ArrowUp', vscode: 'Mod-Alt-ArrowUp' },
  { id: 'caretBelow', idea: 'Ctrl-Alt-ArrowDown', vscode: 'Mod-Alt-ArrowDown' },
  { id: 'nextOccurrence', idea: 'Alt-j', vscode: 'Mod-d' },
  { id: 'allOccurrences', idea: 'Ctrl-Alt-Shift-j', vscode: 'Mod-Shift-l' },
  { id: 'wordLeft', idea: 'Ctrl-ArrowLeft', vscode: 'Ctrl-ArrowLeft' },
  { id: 'wordRight', idea: 'Ctrl-ArrowRight', vscode: 'Ctrl-ArrowRight' },
  { id: 'deleteLine', idea: 'Mod-y', vscode: 'Mod-Shift-k' },
];
export const defaults = () => ({ keymap: 'idea', palette: 'idea', shortcuts: {}, autoSave: 'manual', undoLimit: 1000, toolbar: readToolbar(), showToolbarShortcuts: false, showToolNames: true, windowMode: 'internal', followFile: true, previewTabs: true, quickReasoning: 'off', translationReasoning: 'off', ...appearanceDefaults });
const profiles = ['idea', 'vscode'];
const knownKeys = /^((?:(?:Mod|Ctrl|Meta|Alt|Shift)-)*)([a-z0-9]|[\[\]\\/.,;='`-]|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|F(?:[1-9]|1\d|2[0-4]))$/;
const modifierOrder = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
const punctuation = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/' };

function normalize(key) {
  const parsed = typeof key === 'string' && knownKeys.exec(key);
  if (!parsed) throw new Error('WORKBENCH_SHORTCUT_INVALID');
  const modifiers = parsed[1].split('-').filter(Boolean);
  if (new Set(modifiers).size !== modifiers.length || modifiers.includes('Mod') && modifiers.some(value => value === 'Ctrl' || value === 'Meta')) throw new Error('WORKBENCH_SHORTCUT_INVALID');
  return [...modifierOrder.filter(value => modifiers.includes(value)), parsed[2]].join('-');
}
function identities(key) {
  if (!key) return [];
  const normalized = normalize(key);
  return ['Ctrl', 'Meta'].map(modifier => normalize(normalized.replace(/^Mod-/, `${modifier}-`)));
}

export function readPreferences(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') throw new Error('WORKBENCH_PREFERENCES_INVALID');
  if (![value.keymap, value.palette].every(profile => profiles.includes(profile))) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  if (Object.prototype.toString.call(value.shortcuts) !== '[object Object]') throw new Error('WORKBENCH_SHORTCUT_INVALID');
  const shortcuts = Object.entries(value.shortcuts).map(([id, key]) => {
    if (!actions.some(action => action.id === id)) throw new Error('WORKBENCH_SHORTCUT_INVALID');
    return [id, normalize(key)];
  });
  const autoSave = value.autoSave === undefined ? 'manual' : value.autoSave, undoLimit = value.undoLimit === undefined ? 1000 : value.undoLimit;
  if (!saveDelays.includes(autoSave) || !Number.isSafeInteger(undoLimit) || undoLimit < 1) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  const showToolbarShortcuts = value.showToolbarShortcuts === undefined ? false : value.showToolbarShortcuts;
  const showToolNames = value.showToolNames === undefined ? true : value.showToolNames;
  const windowMode = value.windowMode === undefined ? 'internal' : value.windowMode;
  const followFile = value.followFile === undefined ? true : value.followFile, previewTabs = value.previewTabs === undefined ? true : value.previewTabs;
  if (![showToolbarShortcuts, showToolNames, followFile, previewTabs].every(item => typeof item === 'boolean') || !['internal', 'external'].includes(windowMode)) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  const result = { keymap: value.keymap, palette: value.palette, shortcuts: Object.fromEntries(shortcuts), autoSave, undoLimit, toolbar: readToolbar(value.toolbar), showToolbarShortcuts, showToolNames, windowMode, followFile, previewTabs, ...readAppearance(value) };
  for (const key of ['quickReasoning', 'translationReasoning']) {
    const effort = value[key] === undefined ? 'off' : value[key];
    if (typeof effort !== 'string' || !effort.trim() || effort.length > 256) throw new Error('WORKBENCH_MODEL_SETTING');
    result[key] = effort;
  }
  for (const key of ['quickModel', 'translationModel']) if (value[key] !== undefined) {
    const model = value[key];
    if (!model || typeof model !== 'object' || Object.keys(model).length !== 2 || !['provider', 'model'].every(key => typeof model[key] === 'string' && model[key].trim().length > 0 && model[key].length <= 256)) throw new Error('WORKBENCH_TRANSLATION_MODEL');
    result[key] = { provider: model.provider, model: model.model };
  }
  for (const action of actions) if (conflict(result, action.id, keyOf(result, action.id))) throw new Error('WORKBENCH_SHORTCUT_CONFLICT');
  return result;
}
export function keyOf(preferences, id) {
  if (preferences.shortcuts[id]) return preferences.shortcuts[id];
  const action = actions.find(action => action.id === id), key = action[preferences.keymap];
  // 新增入口不能让已保存的自定义快捷键失效；冲突时仍可从工具栏打开或重新绑定。
  if (action.surface && Object.values(preferences.shortcuts).some(value => identities(value).some(identity => identities(key).includes(identity)))) return '';
  return key;
}
export function conflict(preferences, id, key) {
  const wanted = identities(key);
  return actions.find(action => action.id !== id && identities(keyOf(preferences, action.id)).some(identity => wanted.includes(identity)));
}
export function shortcutOf(event) {
  let key = event.key;
  if (/^(Control|Meta|Alt|Shift|Dead|Process|Unidentified)$/.test(key) || event.isComposing) return null;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  key = punctuation[event.code] ?? key;
  if (!knownKeys.test(key)) return null;
  const modifiers = [['ctrlKey', 'Ctrl'], ['metaKey', 'Meta'], ['altKey', 'Alt'], ['shiftKey', 'Shift']].filter(([field]) => event[field]).map(([, label]) => label);
  return normalize([...modifiers, key].join('-'));
}
export function bindingsOf(preferences, commands) {
  const bindings = actions.filter(action => !action.dialog && !action.surface).map(action => ({ key: keyOf(preferences, action.id), run: commands[action.id], scope: action.global ? 'editor workbench' : 'editor', preventDefault: true }));
  if (!preferences.shortcuts.definition && !bindings.some(binding => binding.key === 'F12')) bindings.push({ key: 'F12', run: commands.definition });
  for (const action of actions) {
    const key = keyOf(preferences, action.id);
    const alias = key.replace(/^Mod-/, 'Ctrl-');
    if (!action.dialog && !action.surface && !preferences.shortcuts[action.id] && alias !== key && !bindings.some(binding => binding.key === alias)) bindings.push({ key: alias, run: commands[action.id], scope: action.global ? 'editor workbench' : 'editor', preventDefault: true });
  }
  return bindings;
}
export function matchesShortcut(event, key) {
  const pressed = shortcutOf(event);
  return pressed !== null && identities(key).includes(pressed);
}
export function keyLabel(key, space = 'Space') {
  if (!key) return '—';
  const parsed = knownKeys.exec(key);
  const parts = [...parsed[1].split('-').filter(Boolean), parsed[2]];
  const labels = { Mod: 'Ctrl/⌘', Meta: '⌘', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: space };
  return parts.map(part => labels[part] || (/^[a-z]$/.test(part) ? part.toUpperCase() : part)).join(' + ');
}
