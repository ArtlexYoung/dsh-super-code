import React, { useEffect, useRef, useState } from 'react';
import { errorText } from '../locales.js';
import { actions, keyOf, keyLabel, shortcutOf, conflict } from '../editor/preferences.js';
import { ModelSettings } from './TranslationModel.jsx';
import { saveDelays } from '../editing/autosave.js';
import { ToolbarSettings } from './ToolbarSettings.jsx';
import { ReadingSettings } from './ReadingSettings.jsx';
import { LanguageSettings } from './LanguageSettings.jsx';

export function Settings({ workbench, preferences, Button, Select, t, general = false }) {
  const [recording, record] = useState(null), [error, setError] = useState('');
  const [undoLimit, setUndoLimit] = useState(String(preferences.undoLimit));
  const [active, setActive] = useState('appearanceSettings');
  const change = useRef(0), sections = useRef({});
  const groups = ['appearanceSettings', 'readingSettings', 'editingSettings', ...(!general ? ['languageSettings'] : []), 'assistantSettings', 'toolbar', 'shortcut'];
  useEffect(() => { setUndoLimit(String(preferences.undoLimit)); }, [preferences.undoLimit]);
  const apply = async value => {
    const revision = ++change.current; setError('');
    try { await workbench.settings(value); }
    catch (error) { if (revision === change.current) setError(errorText(error, t)); }
  };
  return <div className="sc-wb-settings" data-general={general} onKeyDownCapture={event => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape' && recording !== 'close') { record(null); return; }
    const key = shortcutOf(event); if (!key) return;
    if (conflict(preferences, recording, key)) { setError(t('shortcutConflict')); return; }
    apply({ ...preferences, shortcuts: { ...preferences.shortcuts, [recording]: key } }); record(null);
  }}>
    {!general && <nav className="sc-wb-settings-nav" aria-label={t('settings')}>{groups.map(key => <Button key={key} aria-current={active === key ? 'location' : undefined} onClick={() => sections.current[key]?.scrollIntoView({ block: 'start' })}>{t(key)}</Button>)}</nav>}
    <div className="sc-wb-settings-content" onScroll={event => {
      const top = event.currentTarget.getBoundingClientRect().top + 24;
      let current = groups[0];
      for (const key of groups) if (sections.current[key]?.getBoundingClientRect().top <= top) current = key;
      setActive(current);
    }}>
    <section className="sc-wb-settings-group" ref={node => { sections.current.appearanceSettings = node; }}><h2>{t('appearanceSettings')}</h2>
    {[['palette', t('palette')], ['keymap', t('keymap')]].map(([key, label]) => <div className="sc-wb-setting" key={key}><span>{label}</span><Select label={label} value={preferences[key]} choices={[["idea", 'IntelliJ IDEA'], ['vscode', 'VS Code']]} onChange={value => apply({ ...preferences, [key]: value })} /></div>)}
    <div className="sc-wb-setting"><span>{t('showToolbarShortcuts')}</span><span className="sc-wb-setting-toggle"><input aria-label={t('showToolbarShortcuts')} type="checkbox" checked={preferences.showToolbarShortcuts}
      onChange={event => apply({ ...preferences, showToolbarShortcuts: event.target.checked })} /></span></div>
    <div className="sc-wb-setting"><span>{t('showToolNames')}</span><span className="sc-wb-setting-toggle"><input aria-label={t('showToolNames')} type="checkbox" checked={preferences.showToolNames}
      onChange={event => apply({ ...preferences, showToolNames: event.target.checked })} /></span></div>
    <div className="sc-wb-setting"><span>{t('windowMode')}</span><Select label={t('windowMode')} value={preferences.windowMode} choices={['internal', 'external'].map(value => [value, t(`windowMode_${value}`)])}
      onChange={windowMode => apply({ ...preferences, windowMode })} /></div>
    </section>
    <section className="sc-wb-settings-group" ref={node => { sections.current.readingSettings = node; }}><h2>{t('readingSettings')}</h2>
    <ReadingSettings workbench={workbench} preferences={preferences} apply={apply} Select={Select} Button={Button} t={t} />
    </section>
    <section className="sc-wb-settings-group" ref={node => { sections.current.editingSettings = node; }}><h2>{t('editingSettings')}</h2>
    {['followFile', 'previewTabs'].map(key => <div className="sc-wb-setting" key={key}><span>{t(key)}</span><span className="sc-wb-setting-toggle"><input aria-label={t(key)} type="checkbox" checked={preferences[key]}
      onChange={event => apply({ ...preferences, [key]: event.target.checked })} /></span></div>)}
    <div className="sc-wb-setting"><span>{t('autoSave')}</span><Select label={t('autoSave')} value={preferences.autoSave} choices={saveDelays.map(value => [value, t(`autoSave_${value}`)])} onChange={autoSave => apply({ ...preferences, autoSave })} /></div>
    <div className="sc-wb-setting"><span>{t('undoLimit')}</span><input aria-label={t('undoLimit')} type="number" min="1" step="1" value={undoLimit}
      onChange={event => setUndoLimit(event.target.value)} onBlur={() => { apply({ ...preferences, undoLimit: Number(undoLimit) }); setUndoLimit(String(workbench.snapshot().preferences.undoLimit)); }} /></div>
    <p className="sc-wb-setting-note">{t('undoHint')}</p>
    </section>
    {!general && <section className="sc-wb-settings-group" ref={node => { sections.current.languageSettings = node; }}><h2>{t('languageSettings')}</h2>
    <LanguageSettings workbench={workbench} Select={Select} Button={Button} t={t} />
    </section>}
    <section className="sc-wb-settings-group" ref={node => { sections.current.assistantSettings = node; }}><h2>{t('assistantSettings')}</h2>
    <ModelSettings workbench={workbench} preferences={preferences} apply={apply} Select={Select} Button={Button} t={t} />
    </section>
    {!general && <section className="sc-wb-settings-group" ref={node => { sections.current.toolbar = node; }}><ToolbarSettings items={preferences.toolbar} change={toolbar => apply({ ...preferences, toolbar })} Button={Button} t={t} /></section>}
    {!general && <section className="sc-wb-settings-group" ref={node => { sections.current.shortcut = node; }}><div className="sc-wb-section"><strong>{t('shortcut')}</strong><Button onClick={() => apply({ ...preferences, shortcuts: {} })}>{t('reset')}</Button></div>
    {actions.map(action => <div key={action.id} className="sc-wb-shortcut"><span>{t(`action_${action.id}`)}</span>
      <Button title={t(`action_${action.id}`)} onClick={event => { record(action.id); event.currentTarget.focus({ preventScroll: true }); }} aria-pressed={recording === action.id}>{recording === action.id ? t('record') : keyLabel(keyOf(preferences, action.id), t('space'))}</Button>
      {preferences.shortcuts[action.id] && <Button title={t('reset')} onClick={() => { const shortcuts = { ...preferences.shortcuts }; delete shortcuts[action.id]; apply({ ...preferences, shortcuts }); }}>{t('reset')}</Button>}
    </div>)}</section>}
    {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
