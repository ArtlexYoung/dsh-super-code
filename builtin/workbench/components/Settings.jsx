import React, { useEffect, useState } from 'react';
import { errorText } from '../locales.js';
import { actions, keyOf, keyLabel, shortcutOf, conflict } from '../editor/preferences.js';
import { TranslationModel } from './TranslationModel.jsx';
import { saveDelays } from '../editing/autosave.js';

export function Settings({ workbench, preferences, Button, Select, t }) {
  const [recording, record] = useState(null), [error, setError] = useState('');
  const [undoLimit, setUndoLimit] = useState(String(preferences.undoLimit));
  useEffect(() => { setUndoLimit(String(preferences.undoLimit)); }, [preferences.undoLimit]);
  const apply = value => { try { workbench.settings(value); setError(''); } catch (error) { setError(errorText(error,t)); } };
  return <div className="sc-wb-settings" onKeyDownCapture={event => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape' && recording !== 'close') { record(null); return; }
    const key = shortcutOf(event); if (!key) return;
    if (conflict(preferences, recording, key)) { setError(t('shortcutConflict')); return; }
    apply({ ...preferences, shortcuts: { ...preferences.shortcuts, [recording]: key } }); record(null);
  }}>
    {[['palette', t('palette')], ['keymap', t('keymap')]].map(([key, label]) => <label key={key}>{label}<Select label={label} value={preferences[key]} choices={[["idea", 'IntelliJ IDEA'], ['vscode', 'VS Code']]} onChange={value => apply({ ...preferences, [key]: value })} /></label>)}
    <label>{t('autoSave')}<Select label={t('autoSave')} value={preferences.autoSave} choices={saveDelays.map(value => [value, t(`autoSave_${value}`)])} onChange={autoSave => apply({ ...preferences, autoSave })} /></label>
    <label>{t('undoLimit')}<input aria-label={t('undoLimit')} type="number" min="1" step="1" value={undoLimit}
      onChange={event => setUndoLimit(event.target.value)} onBlur={() => { apply({ ...preferences, undoLimit: Number(undoLimit) }); setUndoLimit(String(workbench.snapshot().preferences.undoLimit)); }} /></label>
    <p className="sc-wb-setting-note">{t('undoHint')}</p>
    <TranslationModel workbench={workbench} preferences={preferences} apply={apply} Select={Select} Button={Button} t={t} />
    <div className="sc-wb-section"><strong>{t('shortcut')}</strong><Button onClick={() => apply({ ...preferences, shortcuts: {} })}>{t('reset')}</Button></div>
    {actions.map(action => <div key={action.id} className="sc-wb-shortcut"><span>{t(`action_${action.id}`)}</span>
      <Button title={t(`action_${action.id}`)} onClick={() => record(action.id)} aria-pressed={recording === action.id}>{recording === action.id ? t('record') : keyLabel(keyOf(preferences, action.id), t('space'))}</Button>
      {preferences.shortcuts[action.id] && <Button title={t('reset')} onClick={() => { const shortcuts = { ...preferences.shortcuts }; delete shortcuts[action.id]; apply({ ...preferences, shortcuts }); }}>{t('reset')}</Button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
