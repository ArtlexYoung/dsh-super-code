import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from '../git/FileList.jsx';
import { navigationItems, navigationMode, symbolItems } from '../navigation.js';
import { workbenchCommands } from '../commands.js';
import { toolbarActions } from '../toolbar.js';
import { keyLabel, keyOf } from '../editor/preferences.js';
import { errorText, message } from '../locales.js';
import { usePanelState } from './panel-state.js';

const pendingSymbols = { matches: [], busy: true };
const noSymbols = { matches: [] };

function NavigationStatus({ mode, catalog, snapshot, error, waiting, count, truncated, workbench, Button, t }) {
  return <>
    <div className="sc-wb-navigator-status" role="status">{t('navigateHint')}<span>{waiting ? t('fileSearching') : message(t, 'navigateCount', { count })}</span></div>
    {error && <p role="alert" className="sc-wb-error">{error}</p>}
    {mode === 'files' && catalog.error && <p role="alert">{errorText(catalog.error, t)} <Button onClick={workbench.files.reset}>{t('fileSearchRetry')}</Button></p>}
    {mode === 'files' && catalog.truncated && <p>{t('fileSearchLimit')}</p>}
    {mode === 'symbols' && snapshot.indexing && <p role="status">{t('indexing')}</p>}
    {mode === 'projectSymbols' && <p className="sc-wb-symbol-source" role="status">{message(t, 'navigateSymbolSource', { count: snapshot.indexed })} · {t(snapshot.indexing ? 'indexing' : snapshot.indexPartial ? 'navigateIndexPartial' : 'navigateIndexReady')}
      {snapshot.indexPartial && <Button disabled={snapshot.indexing} onClick={() => { void workbench.refresh().catch(workbench.fail); }}>{t('refreshShort')}</Button>}</p>}
    {truncated && <p>{t('navigateSymbolLimit')}</p>}
  </>;
}

function NavigationResults({ id, rows, index, active, mode, busy, searching, setVisible, open, query, Button, t }) {
  return <div id={id} role="listbox" aria-label={t('navigate')} aria-busy={busy} className="sc-wb-navigator-list">
    {!rows.length && !searching && <p>{t(mode === 'symbols' ? 'outlineEmpty' : 'noResults')}</p>}
    <FileList key={query} items={rows} rowHeight={46} focusKey={active?.key} visible={setVisible}>{(item, row) =>
      <Button id={`${id}-${row}`} role="option" aria-selected={row === index} aria-disabled={!!item.disabled} aria-posinset={row + 1} aria-setsize={rows.length} tabIndex={-1}
        title={item.detail} onClick={() => { void open(item); }}><span>{item.label}</span><small>{item.detail}</small></Button>}
    </FileList>
  </div>;
}

function useProjectSymbols(query, workbench) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (navigationMode(query) !== 'projectSymbols') return;
    const abort = new AbortController();
    let revision = -1, timer, running = false;
    function schedule() {
      if (running || timer || revision === workbench.snapshot().indexRevision) return;
      timer = setTimeout(async () => {
        timer = null; running = true; revision = workbench.snapshot().indexRevision;
        try {
          const value = await workbench.index.symbols(query.slice(1), 1000, abort.signal);
          if (!abort.signal.aborted) setResult({ ...value, query, workbench });
        } catch (error) {
          if (!abort.signal.aborted) setResult({ matches: [], error, query, workbench });
        } finally {
          running = false;
          if (!abort.signal.aborted) schedule();
        }
      }, 100);
    }
    const unsubscribe = workbench.subscribe(schedule);
    schedule();
    return () => { unsubscribe(); clearTimeout(timer); abort.abort(); };
  }, [query, workbench]);
  if (navigationMode(query) !== 'projectSymbols') return noSymbols;
  return result?.query === query && result.workbench === workbench ? result : pendingSymbols;
}

export function Navigator({ panel, workbench, Button, t, toggleFocus }) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot), catalog = useSyncExternalStore(workbench.files.subscribe, workbench.files.snapshot);
  const [text, setText] = usePanelState(workbench, 'navigationQuery', panel.query || '');
  const [chosen, setChosen] = useState(null), [visible, setVisible] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const query = useDeferredValue(text), mode = navigationMode(text), id = useId(), input = useRef(null);
  const project = useProjectSymbols(query, workbench);
  const commands = workbenchCommands(workbench, snapshot, t, toggleFocus);
  const actions = toolbarActions.map(item => ({ ...commands[item.id], id: item.id, label: t(item.id === 'window' && workbench.external ? 'windowReturn' : item.label), shortcut: item.shortcut ? keyLabel(keyOf(snapshot.preferences, item.shortcut), t('space')) : '' }));
  const openedFiles = snapshot.tabs.filter(tab => tab.kind === 'file').map(tab => ({ id: `file:${tab.path}`, label: tab.path, shortcut: t(tab.dirty ? 'unsavedFile' : 'openFileTab'), run: () => workbench.visit({ file: tab.path }) }));
  const rows = useMemo(() => navigationMode(query) === 'projectSymbols' ? symbolItems(project.matches) : navigationItems(query, snapshot, catalog.files, [...actions, ...openedFiles]), [query, snapshot, catalog.files, project.matches, t, toggleFocus]);
  const index = chosen?.query === query ? Math.max(0, rows.findIndex(item => item.key === chosen.key)) : 0, active = rows[index];
  const waiting = query !== text || !!project.busy, searching = mode === 'files' && catalog.searching || mode === 'projectSymbols' && project.busy;
  const activeId = !waiting && visible.some(item => item.key === active?.key) ? `${id}-${index}` : undefined;
  useEffect(() => {
    workbench.files.activate(mode === 'files', id);
    return () => workbench.files.activate(false, id);
  }, [workbench.files, mode, id]);
  const change = value => { setText(value); setChosen(null); setError(''); input.current?.focus(); };
  async function open(item) {
    if (!item || item.disabled || busy || waiting) return;
    setBusy(true); setError('');
    try {
      if (item.target) await workbench.visit(item.target);
      if (workbench.snapshot().panel?.id === panel.id) workbench.panel(null);
      if (item.run) await Promise.resolve().then(item.run).catch(workbench.fail);
    } catch (failure) { setError(errorText(failure, t)); }
    finally { setBusy(false); }
  }
  function keydown(event) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') { void open(active); return; }
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setChosen({ query, key: next.key });
  }
  return <div className="sc-wb-navigator">
    <nav aria-label={t('navigate')} className="sc-wb-navigator-modes">{[['files', '', 'navigateFiles'], ['symbols', '@', 'navigateSymbols'], ['projectSymbols', '#', 'navigateProjectSymbols'], ['commands', '>', 'commandPalette']].map(([key, prefix, label]) =>
      <Button key={key} aria-pressed={mode === key} onClick={() => change(prefix)}>{t(label)}</Button>)}</nav>
    <input ref={input} autoFocus role="combobox" aria-label={t('navigate')} placeholder={t('navigateHint')} value={text} autoComplete="off" spellCheck={false}
      aria-autocomplete="list" aria-expanded={true} aria-controls={id} aria-activedescendant={activeId} onChange={event => change(event.target.value)} onKeyDown={keydown} />
    <NavigationStatus mode={mode} catalog={catalog} snapshot={snapshot} error={error || (mode === 'projectSymbols' && project.error ? errorText(project.error, t) : '')} waiting={searching || waiting} count={rows.length} truncated={mode === 'projectSymbols' && project.truncated} workbench={workbench} Button={Button} t={t} />
    <NavigationResults id={id} rows={rows} index={index} active={active} mode={mode} busy={busy || waiting || searching} searching={searching} setVisible={setVisible} open={open} query={query} Button={Button} t={t} />
    <footer>{t('locationKeys')} · {t('navigateClose')}</footer>
  </div>;
}
