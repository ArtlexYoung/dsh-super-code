import React, { useEffect, useState } from 'react';
import { errorText } from '../locales.js';
import { Setting, useSettings } from './Setting.jsx';

export function ModelSettings({ workbench, preferences, apply, Select, Button, t }) {
  const { entries } = useSettings();
  const [models, setModels] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, retry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    workbench.models(abort.signal).then(value => { if (!abort.signal.aborted) setModels(value); })
      .catch(failure => { if (!abort.signal.aborted) setError(errorText(failure, t)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [workbench, revision, t]);
  const identity = model => JSON.stringify([model.provider, model.model]);
  return <div className="sc-wb-model-settings"><p className="sc-wb-setting-note">{t('modelSettingsHint')}</p>{['quick', 'translation'].map(kind => {
    const modelKey = `${kind}Model`, reasoningKey = `${kind}Reasoning`, selected = preferences[modelKey], reasoning = preferences[reasoningKey];
    const choices = [['', t('translationCurrent')], ...models.map(model => [identity(model), model.name])];
    const capability = models.find(model => selected ? identity(model) === identity(selected) : model.current);
    const missing = !!selected && !capability;
    const supportsOff = !capability?.efforts?.length || capability.efforts.some(item => ['off', 'none', 'disabled'].includes(item.id));
    const efforts = [...(supportsOff ? [['off', t('reasoningOff')]] : []), ...(capability?.efforts || []).filter(item => !['off', 'none', 'disabled'].includes(item.id)).map(item => [item.id, item.name])];
    const unavailable = !efforts.some(([id]) => id === reasoning);
    if (unavailable) efforts.push([reasoning, t(reasoning === 'off' ? 'reasoningOffUnavailable' : 'reasoningUnavailable')]);
    if (missing) choices.push([identity(selected), t('modelUnavailable')]);
    return <section key={kind} className="sc-wb-model-setting" hidden={!entries.get(modelKey).visible && !entries.get(reasoningKey).visible}>
      <Setting id={modelKey}><Select label={t(modelKey)} value={selected ? identity(selected) : ''} choices={choices} onChange={value => {
        const next = { ...preferences, [reasoningKey]: 'off' }; delete next[modelKey];
        if (value) { const [provider, model] = JSON.parse(value); next[modelKey] = { provider, model }; }
        apply(next);
      }} /></Setting>
      <Setting id={reasoningKey}><Select label={t(reasoningKey)} value={reasoning} choices={efforts} disabled={loading || !!error}
        onChange={value => apply({ ...preferences, [reasoningKey]: value })} /></Setting>
      {!loading && !error && (unavailable || missing) && <p role="status" className="sc-wb-setting-note">{t('modelSettingsUnavailable')}</p>}
      {!loading && !error && capability && !supportsOff && reasoning === 'off' && <p role="status" className="sc-wb-setting-note">{t('modelThinkingConfiguration')}</p>}
    </section>;
  })}
    {loading && <small role="status">{t('loading')}</small>}
    {error && <p role="alert">{error} <Button onClick={() => retry(value => value + 1)}>{t('translationRetry')}</Button></p>}
  </div>;
}
