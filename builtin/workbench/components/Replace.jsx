import React, { useEffect, useRef } from 'react';
import { FileList } from '../git/FileList.jsx';
import { errorText, message } from '../locales.js';
import { useReplacement } from './replace-state.js';
import { ReplacementPreview } from './ReplacementPreview.jsx';

function ReplaceFiles({ review, workbench, palette, Button, t }) {
  const { preview, busy, select, selectAll, inspect } = review, selected = new Set(preview.selected), all = useRef(null);
  useEffect(() => { all.current.indeterminate = selected.size > 0 && selected.size < preview.rows.length; }, [selected.size, preview.rows.length]);
  return <section className="sc-wb-replace-review" aria-label={t('replaceReview')}>
    <div className="sc-wb-replace-files"><label className="sc-wb-replace-selection"><input ref={all} type="checkbox" aria-label={t('replaceSelectAll')} checked={selected.size === preview.rows.length} disabled={busy} onChange={event => selectAll(event.target.checked)} />
      {message(t, 'replaceSelected', { count: selected.size, total: preview.rows.length })}</label>
      <FileList items={preview.rows} rowHeight={56} className="sc-wb-replace-results">{row => <div className="sc-wb-replace-row" data-active={preview.active === row.path}>
        <input type="checkbox" aria-label={message(t, 'replaceSelectFile', { path: row.path })} checked={selected.has(row.path)} disabled={busy} onChange={event => select(row.path, event.target.checked)} />
        <Button type="button" title={row.path} aria-label={message(t, 'replaceInspectFile', { path: row.path })} aria-pressed={preview.active === row.path} onClick={() => inspect(row.path)}>
          <span>{row.path}<small>{row.count}</small></span><code>{row.sample}</code></Button>
      </div>}</FileList>
    </div>
    <ReplacementPreview preview={preview} workbench={workbench} palette={palette} Button={Button} t={t} />
  </section>;
}

export function Replace({ workbench, Button, t, palette }) {
  const review = useReplacement(workbench, t), { query, preview, busy, failure, applied, change, scan, apply, stop } = review;
  const count = preview?.selected.length || 0;
  return <div className="sc-wb-replace">
    <form onSubmit={event => { event.preventDefault(); void scan(); }}>
      <label className="sc-wb-search-row"><span>{t('replaceSearch')}</span><input autoFocus required aria-label={t('replaceSearch')} value={query.search} disabled={busy} onChange={event => change({ search: event.target.value })} /></label>
      <label className="sc-wb-search-row"><span>{t('replaceWith')}</span><textarea rows={2} aria-label={t('replaceWith')} value={query.replace} disabled={busy} onChange={event => change({ replace: event.target.value })} /></label>
      <label className="sc-wb-replace-case"><input type="checkbox" checked={query.caseSensitive} disabled={busy} onChange={event => change({ caseSensitive: event.target.checked })} />{t('caseSensitive')}</label>
      <nav><Button type="submit" disabled={busy || !query.search}>{t('replacePreview')}</Button><Button type="button" className="sc-wb-primary" disabled={busy || !count} onClick={() => { void apply(); }}>{message(t, 'replaceApply', { count })}</Button>{busy && <Button type="button" onClick={stop}>{t('stop')}</Button>}</nav>
    </form>
    {busy && <p role="status">{t('working')}</p>}
    {preview && <p role="status">{message(t, 'replaceScope', { count: preview.scanned, skipped: preview.skipped })}</p>}
    {applied && <div role="status">{message(t, 'replaceResult', { count: applied.changed.length, failed: applied.failed.length })}{applied.failed.map(item => <p key={item.path}>{item.path} · {errorText(item.error, t)}</p>)}</div>}
    {failure && <p role="alert">{failure}</p>}
    {preview && !!preview.rows.length && <><div className="sc-wb-replace-help"><small>{t('replaceReviewHint')}</small><Button disabled={busy} onClick={() => { void scan(true); }}>{t('replaceRecheck')}</Button></div>
      <ReplaceFiles review={review} workbench={workbench} palette={palette} Button={Button} t={t} /></>}
    {preview && !preview.rows.length && <p>{t('noResults')}</p>}
  </div>;
}
