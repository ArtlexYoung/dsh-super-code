import React, { useState, useSyncExternalStore } from 'react';

export function ModuleSettings({ preference, Button, t }) {
  const enabled = useSyncExternalStore(preference.subscribe, preference.snapshot), [error, setError] = useState('');
  return <section className="sc-workbench sc-wb-module-settings">
    <h2>{t('title')}</h2><div className="sc-wb-module-row"><div><strong>{t('enable')}</strong><p>{t('enableHint')}</p></div>
      <Button role="switch" aria-checked={enabled} aria-label={t('enable')} className="sc-wb-switch" onClick={() => {
        try { preference.save(!enabled); setError(''); } catch { setError(t('settingsFailed')); }
      }}><i /></Button>
    </div>{error && <p role="alert">{error}</p>}
  </section>;
}
