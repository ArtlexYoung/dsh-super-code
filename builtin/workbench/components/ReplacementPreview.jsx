import React, { useEffect, useState } from 'react';
import { GitDiff } from '../git/Diff.jsx';
import { errorText } from '../locales.js';

export function ReplacementPreview({ preview, workbench, palette, Button, t }) {
  const [result, setResult] = useState(null);
  const row = preview.rows.find(item => item.path === preview.active);
  useEffect(() => {
    if (!row) return;
    const abort = new AbortController(); setResult(null);
    void workbench.previewReplacement(row, preview.query, abort.signal)
      .then(diff => { if (!abort.signal.aborted) setResult({ id: preview.id, path: row.path, diff }); })
      .catch(error => { if (!abort.signal.aborted) setResult({ id: preview.id, path: row.path, error: errorText(error, t) }); });
    return () => abort.abort();
  }, [preview.id, row?.path, workbench, t]);
  if (!row) return <div className="sc-wb-replace-empty">{t('replaceChooseFile')}</div>;
  const current = result?.id === preview.id && result.path === row.path ? result : null;
  if (current?.error) return <div className="sc-wb-replace-empty" role="alert">{current.error}<small>{t('replaceRecheckHint')}</small></div>;
  return <GitDiff diff={current?.diff} loading={!current} palette={palette} Button={Button} t={t} />;
}
