import React, { useState } from 'react';
import { errorText } from '../locales.js';
import { actions, keyOf, keyLabel, shortcutOf, conflict } from '../editor/preferences.js';

export function Settings({ workbench, preferences, Button, Select, t }) {
  const [recording, record] = useState(null), [error, setError] = useState('');
  const apply = value => { try { workbench.settings(value); setError(''); } catch (error) { setError(errorText(error,t)); } };
  return <div className="sc-wb-settings" onKeyDownCapture={event => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { record(null); return; }
    const key = shortcutOf(event); if (!key) return;
    if (conflict(preferences, recording, key)) { setError(t('shortcutConflict')); return; }
    apply({ ...preferences, shortcuts: { ...preferences.shortcuts, [recording]: key } }); record(null);
  }}>
    {[['palette', t('palette')], ['keymap', t('keymap')]].map(([key, label]) => <label key={key}>{label}<Select label={label} value={preferences[key]} choices={[["idea", 'IntelliJ IDEA'], ['vscode', 'VS Code']]} onChange={value => apply({ ...preferences, [key]: value })} /></label>)}
    <div className="sc-wb-section"><strong>{t('shortcut')}</strong><Button onClick={() => apply({ ...preferences, shortcuts: {} })}>{t('reset')}</Button></div>
    {actions.map(action => <div key={action.id} className="sc-wb-shortcut"><span>{t(`action_${action.id}`)}</span>
      <Button title={t(`action_${action.id}`)} onClick={() => record(action.id)} aria-pressed={recording === action.id}>{recording === action.id ? t('record') : keyLabel(keyOf(preferences, action.id), t('space'))}</Button>
      {preferences.shortcuts[action.id] && <Button title={t('reset')} onClick={() => { const shortcuts = { ...preferences.shortcuts }; delete shortcuts[action.id]; apply({ ...preferences, shortcuts }); }}>{t('reset')}</Button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
