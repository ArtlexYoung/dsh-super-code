import React, { useState, useSyncExternalStore } from 'react';

function ModuleToggle({ preference, Button, t, title, hint }) {
  const enabled = useSyncExternalStore(preference.subscribe, preference.snapshot), [error, setError] = useState('');
  return <div><div className="sc-wb-module-row"><div><strong>{title}</strong><p>{hint}</p></div>
      <Button role="switch" aria-checked={enabled} aria-label={title} className="sc-wb-switch" onClick={() => {
        try { preference.save(!enabled); setError(''); } catch { setError(t('settingsFailed')); }
      }}><i /></Button>
    </div>{error && <p role="alert">{error}</p>}</div>;
}
export function ModuleSettings({ preference, readingPreference, Button, t }) {
  return <section className="sc-workbench sc-wb-module-settings"><h2>{t('title')}</h2>
    <ModuleToggle preference={preference} Button={Button} t={t} title={t('enable')} hint={t('enableHint')} />
    <ModuleToggle preference={readingPreference} Button={Button} t={t} title={t('readingEnable')} hint={t('readingEnableHint')} />
  </section>;
}
