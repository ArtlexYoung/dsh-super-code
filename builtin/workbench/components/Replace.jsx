import React, { useEffect, useRef, useState } from 'react';
import { FileList } from '../git/FileList.jsx';
import { errorText, message } from '../locales.js';

export function Replace({ workbench, Button, t }) {
  const [query, setQuery] = useState({ search: '', replace: '', caseSensitive: true }), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [applied, setApplied] = useState(null);
  const pending = useRef(null), rows = preview?.rows || [];
  useEffect(() => () => pending.current?.abort(), []);
  const change = patch => { setQuery({ ...query, ...patch }); setPreview(null); setApplied(null); setError(''); };
  async function scan() {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setBusy(true); setError(''); setPreview(null); setApplied(null);
    const matches = [];
    try {
      for await (const event of workbench.searchProject(query, abort.signal)) {
        if (event.kind === 'file') matches.push({ ...event, key: event.path });
        else setPreview({ rows: matches, ...event });
      }
    } catch (error) { if (!abort.signal.aborted) setError(errorText(error, t)); }
    finally { if (pending.current === abort) setBusy(false); }
  }
  async function apply() {
    const abort = new AbortController(); pending.current = abort; setBusy(true); setError('');
    try {
      await workbench.replaceProject(rows, query, value => setApplied(value), abort.signal);
      setPreview(null);
    } catch (error) { if (!abort.signal.aborted) setError(errorText(error, t)); }
    finally { if (pending.current === abort) setBusy(false); }
  }
  return <div className="sc-wb-replace">
    <form onSubmit={event => { event.preventDefault(); void scan(); }}>
      <label>{t('find')}<input autoFocus required aria-label={t('replaceSearch')} value={query.search} disabled={busy} onChange={event => change({ search: event.target.value })} /></label>
      <label>{t('replaceWith')}<textarea aria-label={t('replaceWith')} value={query.replace} disabled={busy} onChange={event => change({ replace: event.target.value })} /></label>
      <label className="sc-wb-replace-case"><input type="checkbox" checked={query.caseSensitive} disabled={busy} onChange={event => change({ caseSensitive: event.target.checked })} />{t('caseSensitive')}</label>
      <nav><Button type="submit" disabled={busy || !query.search}>{t('replacePreview')}</Button><Button disabled={busy || !rows.length} onClick={() => { void apply(); }}>{message(t, 'replaceApply', { count: rows.length })}</Button>{busy && <Button onClick={() => { pending.current?.abort(); setPreview(null); }}>{t('stop')}</Button>}</nav>
    </form>
    {busy && <p role="status">{t('working')}</p>}
    {preview && <p role="status">{message(t, 'replaceScope', { count: preview.scanned, skipped: preview.skipped })}</p>}
    {applied && <div role="status">{message(t, 'replaceResult', { count: applied.changed.length, failed: applied.failed.length })}{applied.failed.map(item => <p key={item.path}>{item.path} · {errorText(item.error, t)}</p>)}</div>}
    {error && <p role="alert">{error}</p>}
    <FileList items={rows} rowHeight={52} className="sc-wb-replace-results">{row => <div className="sc-wb-replace-row"><span>{row.path}<small>{row.count}</small></span><code>{row.sample}</code></div>}</FileList>
    {preview && !rows.length && <p>{t('noResults')}</p>}
  </div>;
}
