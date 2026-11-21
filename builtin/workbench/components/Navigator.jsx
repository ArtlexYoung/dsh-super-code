import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from '../git/FileList.jsx';
import { navigationItems, navigationMode } from '../navigation.js';
import { workbenchCommands } from '../commands.js';
import { toolbarActions } from '../toolbar.js';
import { keyLabel, keyOf } from '../editor/preferences.js';
import { errorText, message } from '../locales.js';
import { usePanelState } from './panel-state.js';

function NavigationStatus({ mode, catalog, snapshot, error, waiting, count, workbench, Button, t }) {
  return <>
    <div className="sc-wb-navigator-status" role="status">{t('navigateHint')}<span>{waiting ? t('fileSearching') : message(t, 'navigateCount', { count })}</span></div>
    {error && <p role="alert" className="sc-wb-error">{error}</p>}
    {mode === 'files' && catalog.error && <p role="alert">{errorText(catalog.error, t)} <Button onClick={workbench.files.reset}>{t('fileSearchRetry')}</Button></p>}
    {mode === 'files' && catalog.truncated && <p>{t('fileSearchLimit')}</p>}
    {mode === 'symbols' && snapshot.indexing && <p role="status">{t('indexing')}</p>}
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

export function Navigator({ panel, workbench, Button, t, toggleFocus }) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot), catalog = useSyncExternalStore(workbench.files.subscribe, workbench.files.snapshot);
  const [text, setText] = usePanelState(workbench, 'navigationQuery', panel.query || '');
  const [chosen, setChosen] = useState(null), [visible, setVisible] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const query = useDeferredValue(text), mode = navigationMode(text), id = useId(), input = useRef(null);
  const commands = workbenchCommands(workbench, snapshot, t, toggleFocus);
  const actions = toolbarActions.map(item => ({ ...commands[item.id], id: item.id, label: t(item.id === 'window' && workbench.external ? 'windowReturn' : item.label), shortcut: item.shortcut ? keyLabel(keyOf(snapshot.preferences, item.shortcut), t('space')) : '' }));
  const rows = useMemo(() => navigationItems(query, snapshot, catalog.files, actions), [query, snapshot, catalog.files, t, toggleFocus]);
  const index = chosen?.query === query ? Math.max(0, rows.findIndex(item => item.key === chosen.key)) : 0, active = rows[index];
  const waiting = query !== text, searching = mode === 'files' && catalog.searching;
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
    <nav aria-label={t('navigate')} className="sc-wb-navigator-modes">{[['files', '', 'navigateFiles'], ['symbols', '@', 'navigateSymbols'], ['commands', '>', 'commandPalette']].map(([key, prefix, label]) =>
      <Button key={key} aria-pressed={mode === key} onClick={() => change(prefix)}>{t(label)}</Button>)}</nav>
    <input ref={input} autoFocus role="combobox" aria-label={t('navigate')} placeholder={t('navigateHint')} value={text} autoComplete="off" spellCheck={false}
      aria-autocomplete="list" aria-expanded={true} aria-controls={id} aria-activedescendant={activeId} onChange={event => change(event.target.value)} onKeyDown={keydown} />
    <NavigationStatus mode={mode} catalog={catalog} snapshot={snapshot} error={error} waiting={searching || waiting} count={rows.length} workbench={workbench} Button={Button} t={t} />
    <NavigationResults id={id} rows={rows} index={index} active={active} mode={mode} busy={busy || waiting || searching} searching={searching} setVisible={setVisible} open={open} query={query} Button={Button} t={t} />
    <footer>{t('locationKeys')} · {t('navigateClose')}</footer>
  </div>;
}
