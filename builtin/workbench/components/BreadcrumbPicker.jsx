import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '../locales.js';
import { FileList } from '../git/FileList.jsx';
import { Icon } from './Icon.jsx';

export function BreadcrumbPicker({ target, list, workbench, close, Button, t }) {
  const popup = useRef(null), input = useRef(null), id = useId();
  const [directory, setDirectory] = useState(target.directory), [result, setResult] = useState(null);
  const [query, setQuery] = useState(''), [chosen, setChosen] = useState(0), [error, setError] = useState('');
  useLayoutEffect(() => {
    const node = popup.current, anchor = target.anchor;
    const place = () => {
      const box = anchor.getBoundingClientRect(), bounds = node.getBoundingClientRect();
      node.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - bounds.width - 4))}px`;
      node.style.top = `${Math.max(4, box.bottom + bounds.height < window.innerHeight ? box.bottom : box.top - bounds.height)}px`;
    };
    node.showPopover(); place(); input.current.focus();
    const toggled = event => { if (event.newState === 'closed') close(); };
    node.addEventListener('toggle', toggled); window.addEventListener('resize', place);
    return () => { node.removeEventListener('toggle', toggled); window.removeEventListener('resize', place); };
  }, [target, close]);
  useEffect(() => {
    if (directory === undefined) return;
    const abort = new AbortController();
    void list(directory, abort.signal).then(value => { if (!abort.signal.aborted) setResult({ ...value, directory }); })
      .catch(failure => { if (!abort.signal.aborted) setError(errorText(failure, t)); });
    return () => abort.abort();
  }, [directory, list, t]);
  const ready = target.symbols || result?.directory === directory;
  const rows = useMemo(() => {
    const entries = target.symbols || (result?.directory === directory ? result?.entries : []) || [];
    return entries.filter(entry => entry.name.toLowerCase().includes(query.trim().toLowerCase())).map(entry => ({ ...entry, key: entry.path ?? String(entry.offset) }));
  }, [target, result, directory, query]);
  const index = Math.min(chosen, rows.length - 1), active = rows[index];
  function enterDirectory(path) { setDirectory(path); setQuery(''); setChosen(0); setError(''); input.current.focus(); }
  async function open(item) {
    if (!item) return;
    if (item.type === 'directory') { enterDirectory(item.path); return; }
    try { await workbench.visit(target.symbols ? item : { file: item.path }); close(); workbench.view()?.focus(); }
    catch (failure) { setError(errorText(failure, t)); }
  }
  function keydown(event) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Enter' && event.target !== input.current) return;
    const actions = { ArrowDown: () => setChosen(Math.max(0, Math.min(rows.length - 1, index + 1))), ArrowUp: () => setChosen(Math.max(0, index - 1)), Enter: () => void open(active), Escape: () => { close(); target.anchor.focus(); } };
    if (actions[event.key]) { event.preventDefault(); event.stopPropagation(); actions[event.key](); }
  }
  return <section ref={popup} popover="auto" className="sc-wb-crumb-picker" aria-label={t('breadcrumbChoose')} data-workbench-dialog onKeyDown={keydown}>
    <header>{directory && <Button title={t('parentDirectory')} aria-label={t('parentDirectory')} onClick={() => enterDirectory(directory.split('/').slice(0,-1).join('/'))}><Icon name="up" /></Button>}<strong>{target.symbols ? t('siblingSymbols') : directory || t('files')}</strong></header>
    <input ref={input} role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={active ? `${id}-${index}` : undefined} aria-label={t('breadcrumbFilter')} value={query} onChange={event => { setQuery(event.target.value); setChosen(0); }} />
    {error && <small role="alert">{error}</small>}{!error && !rows.length && <small role="status">{t(ready ? 'noResults' : 'loading')}</small>}
    <div id={id} role="listbox" aria-label={t('breadcrumbChoose')}><FileList items={rows} rowHeight={30} focusKey={active?.key}>{(item, index) => <Button id={`${id}-${index}`} role="option" tabIndex={-1} aria-selected={item === active} title={item.path || item.name} onClick={() => void open(item)}>
      <Icon name={item.type === 'directory' ? 'folder' : item.kind || 'files'} /><span>{item.name}</span>{target.symbols && <small>{item.line + 1}</small>}
    </Button>}</FileList></div>{result?.truncated && <small>{t('fileSearchLimit')}</small>}
  </section>;
}
