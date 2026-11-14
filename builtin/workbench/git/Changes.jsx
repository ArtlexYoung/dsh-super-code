import React, { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from './FileList.jsx';
import { GitDiff } from './Diff.jsx';
import { Floating } from '../components/Floating.jsx';
import { errorText } from '../locales.js';
import { matchFiles } from '../file-search.js';

function ChangeStat({ stat, t }) {
  if (!stat) return '…';
  if (stat.binary) return t('changesBinary');
  if (stat.limited) return '…';
  return <><b>+{stat.added}</b><em>−{stat.removed}</em></>;
}

export function FileChanges({ workbench, Button, Select, t, revision, palette = 'idea' }) {
  const store = workbench.changes, snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  const [source, setSource] = useState('all'), [comparison, setComparison] = useState(null);
  const [open, setOpen] = useState(false), [text, setText] = useState('');
  const query = useDeferredValue(text), id = useId();
  const request = useRef(null), owner = useRef(Symbol());
  useEffect(() => {
    if (source !== 'all' && source !== 'unknown' && !snapshot.sources.some(item => item.id === source)) setSource('all');
  }, [source, snapshot.sources]);
  useEffect(() => {
    void store.refresh();
    const refresh = () => store.invalidate(); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); request.current?.abort(); store.forget(owner.current); };
  }, [store]);
  useEffect(() => { store.invalidate(); }, [store, revision]);
  useEffect(() => { if (!open) store.forget(owner.current); }, [store, open]);
  const associated = useMemo(() => {
    const result = new Map();
    for (const source of snapshot.sources) for (const path of source.files) {
      if (!result.has(path)) result.set(path, []);
      result.get(path).push(source);
    }
    return result;
  }, [snapshot.sources]);
  const rows = useMemo(() => {
    const changes = snapshot.state?.changes || [], matches = query.trim() ? new Set(matchFiles(changes.map(file => file.path), query)) : null;
    return changes.filter(file => (!matches || matches.has(file.path)) && (source === 'all' || (source === 'unknown' ? !associated.has(file.path) : associated.get(file.path)?.some(item => item.id === source))))
      .map(file => ({ ...file, key: file.path }));
  }, [snapshot.state?.changes, source, associated, query]);
  const visible = useCallback(items => store.visible(items.map(file => file.path), owner.current), [store, snapshot.state?.version]);
  async function show(path) {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setComparison({ path, loading: true });
    try { const diff = await store.diff(path, abort.signal); if (!abort.signal.aborted) setComparison({ path, diff }); }
    catch (error) { if (!abort.signal.aborted) setComparison({ path, error: errorText(error, t) }); }
  }
  function close() { request.current?.abort(); setComparison(null); }
  return <section className="sc-workbench sc-wb-changes" data-open={open} data-palette={palette} aria-label={t('changesTitle')}>
    <header><Button aria-expanded={open} aria-controls={id} title={t('changesTitle')} onClick={() => setOpen(!open)}><span aria-hidden>{open ? '⌄' : '›'}</span><strong>{t('changesTitle')} <small>{snapshot.state?.changes.length ?? '—'}</small></strong></Button>
      <Button title={t('changesRefresh')} disabled={snapshot.busy} onClick={() => { void store.refresh(); }}>↻</Button></header>
    <div id={id} className="sc-wb-changes-content" hidden={!open}>
    <div className="sc-wb-file-search"><input aria-label={t('changesSearch')} placeholder={t('fileSearchPlaceholder')} value={text} onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape' && text) { event.preventDefault(); event.stopPropagation(); setText(''); } }} />
      {text && <Button title={t('clearFileSearch')} onClick={() => setText('')}>×</Button>}</div>
    {snapshot.sources.length > 0 && <div className="sc-wb-changes-filter"><Select label={t('gitSource')} value={source} onChange={setSource}
      choices={[["all", t('gitAll')], ['unknown', t('gitUnknown')], ...snapshot.sources.map(item => [item.id, item.name])]} /></div>}
    {snapshot.error && <p className="sc-wb-error" role="alert">{snapshot.error}</p>}
    {open && <FileList items={rows} rowHeight={38} visible={visible} className="sc-wb-changes-list">{file => {
      const stat = snapshot.stats.get(file.path), sources = associated.get(file.path) || [];
      const status = file.conflict ? 'U' : !file.worktree ? 'D' : !file.head ? 'A' : 'M';
      return <Button className="sc-wb-change" title={`${file.path}\n${sources.map(item => item.name).join(' · ') || t('gitUnknown')}`}
        onClick={() => { void show(file.path); }}>
        <i data-status={status}>{status}</i><span><strong>{file.path.split('/').at(-1)}</strong><small>{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : sources.map(item => item.name).join(' · ') || t('gitUnknown')}</small></span>
        <span className="sc-wb-change-stat"><ChangeStat stat={stat} t={t} /></span>
      </Button>;
    }}</FileList>}
    {!rows.length && <p>{snapshot.busy ? t('loading') : !snapshot.state ? '' : snapshot.state.exists ? t(!snapshot.state.changes.length ? 'gitClean' : 'noResults') : t('gitNoRepository')}</p>}
    </div>
    {comparison && <Floating title={comparison.path} close={close} t={t} Button={Button} palette={palette} className="sc-wb-git-window" initialSize={{ width: 1100, height: 680 }}>
      {comparison.diff ? <GitDiff diff={comparison.diff} labels={[t('gitHead'), t('gitDisk')]} palette={palette} t={t} Button={Button}
        open={workbench.view() && rows.some(file => file.path === comparison.path && file.worktree !== 0) ? () => { close(); void workbench.visit({ file: comparison.path }).catch(workbench.fail); } : undefined} />
        : <div className="sc-wb-git-empty" role={comparison.error ? 'alert' : 'status'}>{comparison.error || t('loading')}</div>}
    </Floating>}
  </section>;
}
