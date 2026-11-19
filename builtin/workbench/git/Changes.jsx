import React, { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from './FileList.jsx';
import { GitDiff } from './Diff.jsx';
import { Floating } from '../components/Floating.jsx';
import { errorText } from '../locales.js';
import { matchFiles } from '../file-search.js';
import { Icon } from '../components/Icon.jsx';
import { Conflict } from './Conflict.jsx';
import { uniqueId } from '../id.js';

function ChangeStat({ stat, t }) {
  if (!stat) return '…';
  if (stat.binary) return t('changesBinary');
  if (stat.limited) return '…';
  return <><b>+{stat.added}</b><em>−{stat.removed}</em></>;
}

export function Comparison({ comparison, workbench, Button, t, palette }) {
  const snapshot = useSyncExternalStore(workbench.changes.subscribe, workbench.changes.snapshot);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), request = useRef(null);
  useEffect(() => () => request.current?.abort(), [comparison.id]);
  async function restore(hunk) {
    const abort = new AbortController(); request.current = abort; setBusy(true); setError('');
    const update = patch => { if (!abort.signal.aborted && workbench.snapshot().panel?.id === comparison.id) workbench.panel({ ...workbench.snapshot().panel, ...patch }); };
    try {
      const result = await workbench.git({ action: 'restoreHunk', path: comparison.path, side: 'total', hunk, version: comparison.version }, abort.signal);
      if (!result.state.changes.some(file => file.path === comparison.path)) { if (!abort.signal.aborted) workbench.panel(null); return; }
      const next = await workbench.git({ action: 'diff', path: comparison.path, side: 'total', version: result.state.version }, abort.signal);
      update({ diff: next.diff, version: result.state.version, exists: result.state.changes.some(file => file.path === comparison.path && file.worktree !== 0) });
    } catch (failure) { if (!abort.signal.aborted) setError(errorText(failure, t)); }
    finally { if (request.current === abort) { request.current = null; setBusy(false); } }
  }
  if (comparison.conflict) return <Conflict workbench={workbench} path={comparison.path} Button={Button} t={t} palette={palette} close={() => workbench.panel(null)} />;
  return comparison.diff ? <>{error && <p role="alert" className="sc-wb-error">{error}</p>}<GitDiff diff={comparison.diff} labels={[t('gitHead'), t('gitDisk')]} palette={palette} t={t} Button={Button}
    restore={comparison.version ? restore : undefined} restoring={busy || !snapshot.state?.writable || comparison.version !== snapshot.state?.version}
    open={workbench.view() && comparison.exists ? () => { workbench.panel(null); void workbench.visit({ file: comparison.path }).catch(workbench.fail); } : undefined} /></>
    : <div className="sc-wb-git-empty" role={comparison.error ? 'alert' : 'status'}>{comparison.error || t('loading')}</div>;
}

export function FileChanges({ workbench, Button, Select, t, revision, expanded, toggle, standalone = false }) {
  const state = useSyncExternalStore(workbench.subscribe, workbench.snapshot), { preferences } = state, { palette } = preferences;
  const store = workbench.changes, snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  const [source, setSource] = useState('all');
  const comparison = state.panel?.kind === 'diff' && state.panel.origin === 'sidebar' ? state.panel : null;
  const [localOpen, setOpen] = useState(false), [text, setText] = useState('');
  const open = expanded ?? localOpen;
  const query = useDeferredValue(text), id = useId();
  const request = useRef(null), owner = useRef(Symbol());
  useEffect(() => { if (request.current && request.current.id !== state.panel?.id) request.current.abort(); }, [state.panel?.id]);
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
    request.current?.abort(); const abort = new AbortController();
    const panel = { kind: 'diff', id: uniqueId(), origin: standalone ? 'sidebar' : 'workbench', path, conflict: rows.some(file => file.path === path && file.conflict), version: snapshot.state.version, exists: rows.some(file => file.path === path && file.worktree !== 0) };
    request.current = { id: panel.id, abort: () => abort.abort() }; workbench.panel(panel);
    if (panel.conflict) return;
    const update = patch => { if (!abort.signal.aborted && workbench.snapshot().panel?.id === panel.id) workbench.panel({ ...panel, ...patch }); };
    try { update({ diff: await store.diff(path, abort.signal) }); }
    catch (error) { update({ error: errorText(error, t) }); }
  }
  function close() { request.current?.abort(); workbench.panel(null); }
  return <section className="sc-workbench sc-wb-changes" data-open={open} data-palette={palette} aria-label={t('changesTitle')}>
    <Button className="sc-wb-section" aria-expanded={open} aria-controls={id} title={t('changesTitle')} onClick={toggle ?? (() => setOpen(!open))}>
      <Icon name="chevron" /><strong>{t('changesTitle')}</strong><small>{snapshot.state?.changes.length ?? '—'}</small></Button>
    <div id={id} className="sc-wb-changes-content" hidden={!open}>
    <div className="sc-wb-changes-tools"><div className="sc-wb-file-search"><input aria-label={t('changesSearch')} placeholder={t('fileSearchPlaceholder')} value={text} onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape' && text) { event.preventDefault(); event.stopPropagation(); setText(''); } }} />
      {text && <Button title={t('clearFileSearch')} aria-label={t('clearFileSearch')} onClick={() => setText('')}><Icon name="close" /></Button>}</div>
      <Button title={t('changesRefresh')} disabled={snapshot.busy} onClick={() => { void store.refresh(); }}><Icon name="refresh" /></Button></div>
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
    {standalone && comparison && <Floating key={comparison.id} title={comparison.path} close={close} t={t} Button={Button} palette={palette} preferences={preferences} openWindow={workbench.openWindow ? () => workbench.openWindow({ kind: 'panel' }) : undefined} className="sc-wb-git-window" initialSize={{ width: 1100, height: 680 }}>
      <Comparison comparison={comparison} workbench={workbench} t={t} palette={palette} Button={Button} />
    </Floating>}
  </section>;
}
