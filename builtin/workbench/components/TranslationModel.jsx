import React, { useEffect, useState } from 'react';
import { errorText } from '../locales.js';

export function TranslationModel({ workbench, preferences, apply, Select, Button, t }) {
  const [models, setModels] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, retry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    workbench.models(abort.signal).then(value => { if (!abort.signal.aborted) setModels(value); })
      .catch(failure => { if (!abort.signal.aborted) setError(errorText(failure, t)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [workbench, revision, t]);
  const identity = model => JSON.stringify([model.provider, model.model]), selected = preferences.translationModel;
  const choices = [['', t('translationCurrent')], ...models.map(model => [identity(model), model.name])];
  if (selected && !models.some(model => identity(model) === identity(selected))) choices.push([identity(selected), `${selected.provider} · ${selected.model}`]);
  return <div className="sc-wb-translation-setting"><label>{t('translationModel')}<Select label={t('translationModel')} value={selected ? identity(selected) : ''} choices={choices} onChange={value => {
    const next = { ...preferences }; delete next.translationModel;
    if (value) { const [provider, model] = JSON.parse(value); next.translationModel = { provider, model }; }
    apply(next);
  }} /></label><small>{t(loading ? 'loading' : 'translationHint')}</small>
    {error && <p role="alert">{error} <Button onClick={() => retry(value => value + 1)}>{t('translationRetry')}</Button></p>}
  </div>;
}
