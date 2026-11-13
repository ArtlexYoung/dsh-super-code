export const actions = [
  { id: 'definition', idea: 'Mod-b', vscode: 'F12' },
  { id: 'complete', idea: 'Ctrl-Space', vscode: 'Ctrl-Space' },
  { id: 'find', idea: 'Mod-f', vscode: 'Mod-f', global: true },
  { id: 'project', idea: 'Mod-Shift-f', vscode: 'Mod-Shift-f', global: true },
  { id: 'back', idea: 'Alt-ArrowLeft', vscode: 'Alt-ArrowLeft', global: true },
  { id: 'forward', idea: 'Alt-ArrowRight', vscode: 'Alt-ArrowRight', global: true },
  { id: 'indent', idea: 'Tab', vscode: 'Tab' },
  { id: 'outdent', idea: 'Shift-Tab', vscode: 'Shift-Tab' },
  { id: 'undo', idea: 'Mod-z', vscode: 'Mod-z' },
  { id: 'redo', idea: 'Mod-Shift-z', vscode: 'Mod-y' },
  { id: 'comment', idea: 'Mod-/', vscode: 'Mod-/' },
  { id: 'deleteLine', idea: 'Mod-y', vscode: 'Mod-Shift-k' },
];
export const defaults = () => ({ keymap: 'idea', palette: 'idea', shortcuts: {} });
const profiles = ['idea', 'vscode'];
const knownKeys = /^((?:(?:Mod|Ctrl|Meta|Alt|Shift)-)*)([a-z0-9]|[\[\]\\/.,;='`-]|Space|Tab|Enter|Backspace|Delete|Home|End|PageUp|PageDown|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|F(?:[1-9]|1\d|2[0-4]))$/;
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
  const result = { keymap: value.keymap, palette: value.palette, shortcuts: Object.fromEntries(shortcuts) };
  for (const action of actions) if (conflict(result, action.id, keyOf(result, action.id))) throw new Error('WORKBENCH_SHORTCUT_CONFLICT');
  return result;
}
export function keyOf(preferences, id) {
  return preferences.shortcuts[id] ?? actions.find(action => action.id === id)[preferences.keymap];
}
export function conflict(preferences, id, key) {
  const wanted = identities(key);
  return actions.find(action => action.id !== id && identities(keyOf(preferences, action.id)).some(identity => wanted.includes(identity)));
}
export function shortcutOf(event) {
  let key = event.key;
  if (/^(Control|Meta|Alt|Shift|Escape|Dead|Process|Unidentified)$/.test(key) || event.isComposing) return null;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  key = punctuation[event.code] ?? key;
  if (!knownKeys.test(key)) return null;
  const modifiers = [['ctrlKey', 'Ctrl'], ['metaKey', 'Meta'], ['altKey', 'Alt'], ['shiftKey', 'Shift']].filter(([field]) => event[field]).map(([, label]) => label);
  return normalize([...modifiers, key].join('-'));
}
export function bindingsOf(preferences, commands) {
  const bindings = actions.map(action => ({ key: keyOf(preferences, action.id), run: commands[action.id], scope: action.global ? 'editor workbench' : 'editor', preventDefault: true }));
  if (!preferences.shortcuts.definition && !bindings.some(binding => binding.key === 'F12')) bindings.push({ key: 'F12', run: commands.definition });
  for (const action of actions) {
    const key = keyOf(preferences, action.id);
    const alias = key.replace(/^Mod-/, 'Ctrl-');
    if (!preferences.shortcuts[action.id] && alias !== key && !bindings.some(binding => binding.key === alias)) bindings.push({ key: alias, run: commands[action.id], scope: action.global ? 'editor workbench' : 'editor', preventDefault: true });
  }
  return bindings;
}
export function keyLabel(key, space = 'Space') {
  const parsed = knownKeys.exec(key);
  const parts = [...parsed[1].split('-').filter(Boolean), parsed[2]];
  const labels = { Mod: 'Ctrl/⌘', Meta: '⌘', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: space };
  return parts.map(part => labels[part] || part).join(' + ');
}
