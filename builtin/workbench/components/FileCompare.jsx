import React, { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createFileSearch, matchFiles } from '../file-search.js';
import { FileList } from '../git/FileList.jsx';
import { GitDiff } from '../git/Diff.jsx';
import { errorText } from '../locales.js';
import { usePanelState } from './panel-state.js';
import { uniqueId } from '../id.js';

export function FileCompare({ panel, workbench, Button, t, palette }) {
  const files = useMemo(() => createFileSearch(workbench.list), [workbench]);
  const catalog = useSyncExternalStore(files.subscribe, files.snapshot);
  const [target, setTarget] = usePanelState(workbench, 'compareTarget', '');
  const [savedDiff, setDiff] = usePanelState(workbench, 'compareDiff', null);
  const [read, setRead] = usePanelState(workbench, 'compareRead', null);
  const diff = savedDiff?.target === target && savedDiff.path === panel.path ? savedDiff : null;
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), request = useRef(null);
  const failure = error?.id === read ? error.text : '';
  const query = useDeferredValue(target);
  const rows = useMemo(() => (query.trim() ? matchFiles(catalog.files, query) : catalog.files).filter(path => path !== panel.path).map(path => ({ key: path, path })), [catalog.files, query, panel.path]);
  useEffect(() => { files.activate(true); return () => { request.current?.abort(); files.dispose(); }; }, [files]);
  async function compare(path = target) {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    const id = uniqueId(), current = () => { const state = workbench.snapshot().panel?.state; return state?.compareTarget === path && state.compareRead === id; };
    setTarget(path); setRead(id); setBusy(true); setError(null);
    try {
      const result = await workbench.compareFiles(panel.path, path, abort.signal);
      if (!abort.signal.aborted && current()) setDiff({ ...result, target: path });
    } catch (failure) { if (!abort.signal.aborted && current()) setError({ id, text: errorText(failure, t) }); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <div className="sc-wb-file-compare">
    <form className="sc-wb-compare-picker" onSubmit={event => { event.preventDefault(); void compare(); }}>
      <span title={panel.path}>{panel.path}</span><span aria-hidden>⇄</span>
      <input aria-label={t('fileCompareTarget')} placeholder={t('fileCompareTarget')} value={target} autoFocus onChange={event => { request.current?.abort(); setRead(null); setBusy(false); setError(null); setTarget(event.target.value); setDiff(null); }} />
      <Button type="submit" disabled={busy || !target || target === panel.path}>{t(busy ? 'working' : 'fileCompare')}</Button>
    </form>
    {(failure || catalog.error) && <p role="alert">{failure || errorText(catalog.error, t)}</p>}
    {diff ? <GitDiff diff={diff} labels={[panel.path, diff.target]} palette={palette} t={t} Button={Button} /> : <>
      <p className="sc-wb-setting-note" role="status">{t(catalog.searching ? 'loading' : 'fileCompareHint')}</p>
      {catalog.truncated && <small>{t('fileSearchLimit')}</small>}
      {!catalog.searching && !rows.length && <p>{t('noResults')}</p>}
      <FileList items={rows} rowHeight={30} className="sc-wb-compare-files">{({ path }) => <Button title={path} disabled={busy} onClick={() => { void compare(path); }}>{path}</Button>}</FileList>
    </>}
  </div>;
}
