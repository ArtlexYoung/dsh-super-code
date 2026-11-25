import React, { useRef, useState, useSyncExternalStore } from 'react';
import { errorText } from '../locales.js';
import { actions, keyOf, keyLabel, shortcutOf, conflict, layoutDensities } from '../editor/preferences.js';
import { settingEntries, settingGroups, settingMatches, resetPreference } from '../settings.js';
import { ModelSettings } from './TranslationModel.jsx';
import { saveDelays } from '../editing/autosave.js';
import { ToolbarSettings } from './ToolbarSettings.jsx';
import { ReadingSettings } from './ReadingSettings.jsx';
import { LanguageSettings } from './LanguageSettings.jsx';
import { Setting, SettingGroup, SettingText, SettingsContext } from './Setting.jsx';

const emptyPaths = {}, emptySubscribe = () => () => {};

export function Settings({ workbench, preferences, Button, Select, t, general = false }) {
  const [error, setError] = useState(''), [query, setQuery] = useState(''), [modifiedOnly, setModifiedOnly] = useState(false);
  const [undoDraft, setUndoDraft] = useState(null), [active, setActive] = useState('appearanceSettings');
  const change = useRef(0), sections = useRef({});
  const paths = useSyncExternalStore(workbench.subscribe || emptySubscribe, () => workbench.snapshot().environmentPaths || emptyPaths);
  const entries = new Map(settingEntries(preferences, paths).filter(entry => !general || !['languageSettings', 'toolbar', 'shortcut'].includes(entry.group))
    .map(entry => [entry.id, { ...entry, visible: settingMatches(entry, query, modifiedOnly, t) }]));
  const visible = [...entries.values()].filter(entry => entry.visible), groups = settingGroups.filter(group => visible.some(entry => entry.group === group));
  const save = async operation => {
    const revision = ++change.current; setError('');
    try { await operation(); return true; }
    catch (error) { if (revision === change.current) setError(errorText(error, t)); return false; }
  };
  const apply = value => save(() => workbench.settings(value));
  const reset = async id => {
    const saved = await save(() => {
    const current = workbench.snapshot();
    if (id.startsWith('environment.')) { const paths = { ...current.environmentPaths }; delete paths[id.slice(12)]; return workbench.environmentPaths(paths); }
    return workbench.settings(resetPreference(current.preferences, id));
    });
    if (saved && id === 'undoLimit') setUndoDraft(value => value === undoDraft ? null : value);
  };
  return <SettingsContext.Provider value={{ query, entries, reset, sections, Button, t }}><div className="sc-wb-settings-frame" data-general={general}><div className="sc-wb-settings" data-general={general}>
    <div className="sc-wb-settings-filter">
      <input type="search" aria-label={t('searchSettings')} placeholder={t('searchSettings')} value={query} onChange={event => setQuery(event.target.value)} />
      <label><input type="checkbox" checked={modifiedOnly} onChange={event => setModifiedOnly(event.target.checked)} />{t('settingsModifiedOnly')}</label>
      {(query || modifiedOnly) && <Button onClick={() => { setQuery(''); setModifiedOnly(false); }}>{t('settingsClear')}</Button>}
      <small role="status">{visible.length} {t('settingsCount')}</small>
      {error && <p role="alert">{error}</p>}
    </div>
    {!general && <nav className="sc-wb-settings-nav" aria-label={t('settings')}>{groups.map(key => <Button key={key} aria-current={(groups.includes(active) ? active : groups[0]) === key ? 'location' : undefined} onClick={() => sections.current[key]?.scrollIntoView({ block: 'start' })}><SettingText>{t(key)}</SettingText></Button>)}</nav>}
    <div className="sc-wb-settings-content" onScroll={event => {
      const top = event.currentTarget.getBoundingClientRect().top + 24;
      let current = groups[0];
      for (const key of groups) if (sections.current[key]?.getBoundingClientRect().top <= top) current = key;
      setActive(current);
    }}>
    {!visible.length && <p className="sc-wb-setting-note">{t('settingsEmpty')}</p>}
    <SettingGroup id="appearanceSettings">
    {['palette', 'keymap'].map(key => <Setting id={key} key={key}><Select label={t(key)} value={preferences[key]} choices={[["idea", 'IntelliJ IDEA'], ['vscode', 'VS Code']]} onChange={value => apply({ ...preferences, [key]: value })} /></Setting>)}
    <Setting id="density"><Select label={t('density')} value={preferences.density} choices={layoutDensities.map(value => [value, t(`density_${value}`)])} onChange={density => apply({ ...preferences, density })} /></Setting>
    {['showToolbarShortcuts', 'showToolNames'].map(key => <Setting id={key} key={key}><span className="sc-wb-setting-toggle"><input aria-label={t(key)} type="checkbox" checked={preferences[key]} onChange={event => apply({ ...preferences, [key]: event.target.checked })} /></span></Setting>)}
    <Setting id="windowMode"><Select label={t('windowMode')} value={preferences.windowMode} choices={['internal', 'external'].map(value => [value, t(`windowMode_${value}`)])} onChange={windowMode => apply({ ...preferences, windowMode })} /></Setting>
    </SettingGroup>
    <SettingGroup id="readingSettings"><ReadingSettings workbench={workbench} preferences={preferences} apply={apply} Select={Select} Button={Button} t={t} /></SettingGroup>
    <SettingGroup id="editingSettings">
    {['followFile', 'previewTabs'].map(key => <Setting id={key} key={key}><span className="sc-wb-setting-toggle"><input aria-label={t(key)} type="checkbox" checked={preferences[key]} onChange={event => apply({ ...preferences, [key]: event.target.checked })} /></span></Setting>)}
    <Setting id="autoSave"><Select label={t('autoSave')} value={preferences.autoSave} choices={saveDelays.map(value => [value, t(`autoSave_${value}`)])} onChange={autoSave => apply({ ...preferences, autoSave })} /></Setting>
    <Setting id="undoLimit"><input aria-label={t('undoLimit')} type="number" min="1" step="1" value={undoDraft ?? String(preferences.undoLimit)} onChange={event => setUndoDraft(event.target.value)}
      onBlur={async () => { if (undoDraft !== null && await apply({ ...workbench.snapshot().preferences, undoLimit: Number(undoDraft) })) setUndoDraft(value => value === undoDraft ? null : value); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setUndoDraft(null); } }} /><p className="sc-wb-setting-note">{t('undoHint')}</p></Setting>
    </SettingGroup>
    {!general && <SettingGroup id="languageSettings"><LanguageSettings workbench={workbench} Select={Select} Button={Button} t={t} /></SettingGroup>}
    <SettingGroup id="assistantSettings"><ModelSettings workbench={workbench} preferences={preferences} apply={apply} Select={Select} Button={Button} t={t} /></SettingGroup>
    {!general && <SettingGroup id="toolbar" heading={false}><ToolbarSettings items={preferences.toolbar} change={toolbar => apply({ ...preferences, toolbar })} Button={Button} t={t} /></SettingGroup>}
    {!general && <SettingGroup id="shortcut" heading={false}><ShortcutSettings preferences={preferences} apply={apply} Button={Button} t={t} setError={setError} /></SettingGroup>}
    </div>
  </div></div></SettingsContext.Provider>;
}

function ShortcutSettings({ preferences, apply, Button, t, setError }) {
  const [recording, record] = useState(null);
  return <div onKeyDownCapture={event => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape' && recording !== 'close') { record(null); return; }
    const key = shortcutOf(event); if (!key) return;
    if (conflict(preferences, recording, key)) { setError(t('shortcutConflict')); return; }
    apply({ ...preferences, shortcuts: { ...preferences.shortcuts, [recording]: key } }); record(null);
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) record(null); }}>
    <div className="sc-wb-section"><strong><SettingText>{t('shortcut')}</SettingText></strong><Button onClick={() => apply({ ...preferences, shortcuts: {} })}>{t('reset')}</Button></div>
    {actions.map(action => <Setting key={action.id} id={`shortcuts.${action.id}`} className="sc-wb-shortcut"><Button title={t(`action_${action.id}`)} aria-label={t(`action_${action.id}`)} onClick={event => { record(action.id); event.currentTarget.focus({ preventScroll: true }); }} aria-pressed={recording === action.id}>{recording === action.id ? t('record') : keyLabel(keyOf(preferences, action.id), t('space'))}</Button></Setting>)}
  </div>;
}
