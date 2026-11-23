import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { errorText } from '../locales.js';
import { environmentLanguages } from '../settings.js';
import { Setting, useSettings } from './Setting.jsx';

const emptyPaths = {};

export function LanguageSettings({ workbench, Select, Button, t }) {
  const { entries } = useSettings(), choices = environmentLanguages.filter(([id]) => entries.get(`environment.${id}`).visible);
  const { environmentPaths = emptyPaths } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const [selected, setLanguage] = useState('python'), [path, setPath] = useState(''), [revision, refresh] = useState(0), [result, setResult] = useState(null), [error, setError] = useState('');
  const language = choices.some(([id]) => id === selected) ? selected : choices[0]?.[0] || selected;
  useEffect(() => { setPath(environmentPaths[language] || ''); }, [environmentPaths, language]);
  useEffect(() => {
    const abort = new AbortController(); setResult(null); setError('');
    if (!workbench.environments) { setError(t('WORKBENCH_ENV_UNAVAILABLE')); return () => abort.abort(); }
    void workbench.environments(abort.signal).then(value => { if (!abort.signal.aborted) setResult(value); }).catch(failure => { if (!abort.signal.aborted) setError(errorText(failure, t)); });
    return () => abort.abort();
  }, [workbench, environmentPaths, revision, t]);
  const current = result?.environments.find(item => item.language === language);
  return <>
    <div className="sc-wb-setting"><span>{t('language')}</span><Select label={t('language')} value={language} choices={choices} onChange={setLanguage} /></div>
    <Setting id={`environment.${language}`}><input aria-label={t('environmentPath')} placeholder={t('environmentAutomatic')} value={path} onChange={event => setPath(event.target.value)}
      onBlur={() => { if (path !== (environmentPaths[language] || '')) void workbench.environmentPaths({ ...workbench.snapshot().environmentPaths, [language]: path.trim() }).catch(failure => setError(errorText(failure, t))); }} /></Setting>
    <p className="sc-wb-setting-note">{t('environmentHint')}</p>
    <Button onClick={() => refresh(value => value + 1)}>{t('environmentRefresh')}</Button>
    {error ? <p role="alert">{error}</p> : <div className="sc-wb-environment-status" role="status">
      <p>{!result ? t('loading') : current?.roots.length ? t('environmentFound') : t('environmentMissing')}</p>
      {current?.roots.map(path => <code key={path}>{path}</code>)}
      {!!result?.warnings.length && <p>{t('environmentWarnings')}</p>}
    </div>}
  </>;
}
