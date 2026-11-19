import React, { useEffect, useRef, useState } from 'react';
import { FileList } from '../git/FileList.jsx';
import { errorText, message } from '../locales.js';
import { usePanelState } from './panel-state.js';
import { uniqueId } from '../id.js';

const sameQuery = (first, second) => first && second && ['search', 'replace', 'caseSensitive'].every(key => first[key] === second[key]);

export function Replace({ workbench, Button, t }) {
  const [query, setQuery] = usePanelState(workbench, 'replaceQuery', { search: '', replace: '', caseSensitive: true }), [savedPreview, setPreview] = usePanelState(workbench, 'replacePreview', null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [applied, setApplied] = useState(null);
  const preview = sameQuery(savedPreview?.query, query) ? savedPreview : null;
  const [read, setRead] = usePanelState(workbench, 'replaceRead', null);
  const failure = error?.read && error.read !== read ? '' : error?.text;
  const pending = useRef(null), rows = preview?.rows || [];
  useEffect(() => () => pending.current?.abort(), []);
  const change = patch => { setRead(null); setQuery({ ...query, ...patch }); setPreview(null); setApplied(null); setError(null); };
  async function scan() {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    const id = uniqueId(), current = () => { const state = workbench.snapshot().panel?.state; return state?.replaceRead === id && sameQuery(state.replaceQuery, query); };
    abort.previewId = id;
    setRead(id);
    setBusy(true); setError(null); setPreview(null); setApplied(null);
    const matches = []; let completion;
    try {
      for await (const event of workbench.searchProject(query, abort.signal)) {
        if (event.kind === 'file') matches.push({ ...event, key: event.path });
        else if (event.kind === 'done') completion = event;
      }
      if (!abort.signal.aborted && current()) {
        if (!completion) throw new Error('WORKBENCH_REMOTE');
        setPreview({ id, query, rows: matches, ...completion });
      }
    } catch (error) { if (!abort.signal.aborted && current()) setError({ read: id, text: errorText(error, t) }); }
    finally { if (pending.current === abort) setBusy(false); }
  }
  async function apply() {
    const abort = new AbortController(); abort.previewId = preview.id; pending.current = abort; setBusy(true); setError(null);
    try {
      await workbench.replaceProject(rows, query, value => setApplied(value), abort.signal);
      setPreview(previous => previous?.id === preview.id ? null : previous);
    } catch (error) { if (!abort.signal.aborted) setError({ text: errorText(error, t) }); }
    finally { if (pending.current === abort) setBusy(false); }
  }
  return <div className="sc-wb-replace">
    <form onSubmit={event => { event.preventDefault(); void scan(); }}>
      <label className="sc-wb-search-row"><span>{t('replaceSearch')}</span><input autoFocus required aria-label={t('replaceSearch')} value={query.search} disabled={busy} onChange={event => change({ search: event.target.value })} /></label>
      <label className="sc-wb-search-row"><span>{t('replaceWith')}</span><textarea rows={2} aria-label={t('replaceWith')} value={query.replace} disabled={busy} onChange={event => change({ replace: event.target.value })} /></label>
      <label className="sc-wb-replace-case"><input type="checkbox" checked={query.caseSensitive} disabled={busy} onChange={event => change({ caseSensitive: event.target.checked })} />{t('caseSensitive')}</label>
      <nav><Button type="submit" disabled={busy || !query.search}>{t('replacePreview')}</Button><Button type="button" disabled={busy || !rows.length} onClick={() => { void apply(); }}>{message(t, 'replaceApply', { count: rows.length })}</Button>{busy && <Button type="button" onClick={() => { const abort = pending.current; abort?.abort(); setPreview(previous => previous?.id === abort?.previewId ? null : previous); }}>{t('stop')}</Button>}</nav>
    </form>
    {busy && <p role="status">{t('working')}</p>}
    {preview && <p role="status">{message(t, 'replaceScope', { count: preview.scanned, skipped: preview.skipped })}</p>}
    {applied && <div role="status">{message(t, 'replaceResult', { count: applied.changed.length, failed: applied.failed.length })}{applied.failed.map(item => <p key={item.path}>{item.path} · {errorText(item.error, t)}</p>)}</div>}
    {failure && <p role="alert">{failure}</p>}
    <FileList items={rows} rowHeight={52} className="sc-wb-replace-results">{row => <div className="sc-wb-replace-row"><span>{row.path}<small>{row.count}</small></span><code>{row.sample}</code></div>}</FileList>
    {preview && !rows.length && <p>{t('noResults')}</p>}
  </div>;
}
