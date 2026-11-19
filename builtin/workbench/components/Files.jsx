import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from '../git/FileList.jsx';
import { matchFiles } from '../file-search.js';
import { errorText, message } from '../locales.js';
import { FileIcon } from './FileIcon.jsx';
import { Icon } from './Icon.jsx';

function File({ path, current, workbench, Button, children, tree = false, ...props }) {
  return <Button {...props} className="sc-wb-file" title={path} aria-current={current === path ? 'page' : undefined}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); workbench.menu({ path, type: 'file', x: event.clientX, y: event.clientY }); }}
    onClick={() => { void workbench.visit({ file: path }).catch(workbench.fail); }}>
    {tree && <span className="sc-wb-tree-arrow" aria-hidden />}<FileIcon path={path} />{children}
  </Button>;
}

function Directory({ snapshot, workbench, Button, t, following, directory }) {
  const [open, setOpen] = useState(new Set(['']));
  const [focus, setFocus] = useState(null);
  const isOpen = path => open.has(path) && snapshot.directories.has(path);
  useEffect(() => {
    setFocus(following ? snapshot.file : null);
    if (!following) return;
    const folders = snapshot.file?.split('/').slice(0, -1).map((_name, i, parts) => parts.slice(0, i + 1).join('/')) || [];
    if (!folders.length) return;
    setOpen(previous => new Set([...previous, ...folders]));
    for (const path of folders) if (!snapshot.directories.has(path)) void workbench.list(path).catch(workbench.fail);
  }, [snapshot.file, workbench, following]);
  useEffect(() => {
    if (!directory) return;
    const folders = ['', ...directory.path.split('/').filter(Boolean).map((_name, i, parts) => parts.slice(0, i + 1).join('/'))];
    setOpen(previous => new Set([...previous, ...folders]));
    setFocus(directory.path || null);
    for (const path of folders) if (!snapshot.directories.has(path)) void workbench.list(path).catch(workbench.fail);
  }, [directory]);
  const { rows, truncated } = useMemo(() => {
    const rows = [], stack = (snapshot.directories.get('')?.entries || []).map(entry => ({ ...entry, depth: 0 })).reverse();
    let truncated = !!snapshot.directories.get('')?.truncated;
    while (stack.length) {
      const entry = stack.pop(); rows.push({ ...entry, key: entry.path });
      if (entry.type !== 'directory' || !open.has(entry.path)) continue;
      const list = snapshot.directories.get(entry.path); truncated ||= !!list?.truncated;
      for (const child of [...(list?.entries || [])].reverse()) stack.push({ ...child, depth: entry.depth + 1 });
    }
    return { rows, truncated };
  }, [snapshot.directories, open]);
  return <>{truncated && <small>{t('fileSearchLimit')}</small>}<FileList className="sc-wb-file-tree" items={rows} rowHeight={30} focusKey={focus}>{entry => <div data-tree-path={entry.path} data-depth={entry.depth} style={{ paddingLeft: entry.depth * 16 }}>
    {entry.type === 'directory' ? <Button aria-expanded={isOpen(entry.path)} title={entry.path} className="sc-wb-file"
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); workbench.menu({ path: entry.path, type: 'directory', x: event.clientX, y: event.clientY }); }} onClick={() => {
        setFocus(null);
        const next = new Set(open); if (isOpen(entry.path)) next.delete(entry.path); else { next.add(entry.path); void workbench.list(entry.path).catch(workbench.fail); } setOpen(next);
      }}><Icon name="chevron" /><FileIcon path={entry.path} directory open={isOpen(entry.path)} /><span>{entry.name}</span></Button>
      : <File path={entry.path} current={snapshot.file} workbench={workbench} Button={Button} tree><span>{entry.name}</span></File>}
  </div>}</FileList></>;
}

export function Files({ snapshot, workbench, Button, t, visible, directory }) {
  const [text, setText] = useState(''), input = useRef(null), list = useRef(null), query = useDeferredValue(text), id = useId();
  const [selection, setSelection] = useState(null), [rendered, setRendered] = useState([]);
  const search = useSyncExternalStore(workbench.files.subscribe, workbench.files.snapshot);
  const filtering = Boolean(text.trim());
  const searching = search.searching || query !== text;
  const matches = useMemo(() => matchFiles(search.files, query).map(path => ({ key: path, path })), [search.files, query]);
  const index = selection?.query === query ? Math.max(0, matches.findIndex(item => item.path === selection.path)) : 0;
  const active = filtering && query === text ? matches[index] : null;
  const activeId = active && rendered.some(item => item.path === active.path) ? `${id}-${index}` : undefined;
  useEffect(() => { if (directory) { setText(''); setSelection(null); } }, [directory]);
  const choose = next => setSelection({ query, path: matches[Math.max(0, Math.min(matches.length - 1, next))].path });
  useEffect(() => {
    workbench.files.activate(visible && filtering);
    return () => workbench.files.activate(false);
  }, [workbench.files, visible, filtering]);
  const clear = () => { setText(''); setSelection(null); input.current?.focus(); };
  function keydown(event) {
    if (event.nativeEvent.isComposing || ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].some(key => event[key]) || !active) return;
    const actions = { ArrowUp: () => choose(index - 1), ArrowDown: () => choose(index + 1), Enter: () => { void workbench.visit({ file: active.path }).catch(workbench.fail); } };
    if (event.currentTarget === list.current) { actions.Home = () => choose(0); actions.End = () => choose(matches.length - 1); }
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault(); event.stopPropagation(); action();
  }
  return <div className="sc-wb-files" onContextMenu={event => {
    if (event.target.closest('input')) return;
    event.preventDefault(); event.stopPropagation(); workbench.menu({ path: '', type: 'directory', x: event.clientX, y: event.clientY });
  }}>
    <div className="sc-wb-file-search">
      <Icon name="find" />
      <input ref={input} role="combobox" aria-expanded={filtering} aria-autocomplete="list" aria-controls={filtering ? id : undefined} aria-activedescendant={activeId}
        aria-label={t('fileSearch')} placeholder={t('fileSearchPlaceholder')} autoComplete="off" spellCheck={false}
        value={text} onChange={event => { setText(event.target.value); setSelection(null); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); return; }
          keydown(event);
        }} />
      {text && <Button title={t('clearFileSearch')} aria-label={t('clearFileSearch')} onClick={clear}><Icon name="close" /></Button>}
    </div>
    <div className="sc-wb-file-list" hidden={filtering}><Directory snapshot={snapshot} workbench={workbench} Button={Button} t={t} directory={directory} following={snapshot.preferences.followFile && visible && !filtering} /></div>
    {filtering && <>
      <div className="sc-wb-file-search-status sc-wb-file-search-info"><span role="status">{searching ? t('fileSearching') : message(t, 'fileSearchCount', { count: matches.length })}</span><small>{t('locationKeys')}</small></div>
      {search.error && <div className="sc-wb-file-search-status" role="alert" title={errorText(search.error, t)}>{t('fileSearchFailed')}<Button title={t('fileSearchRetry')} onClick={() => workbench.files.reset()}>{t('fileSearchRetry')}</Button></div>}
      {search.truncated && <div className="sc-wb-file-search-status">{t('fileSearchLimit')}</div>}
      {!searching && !matches.length && <p className="sc-wb-file-search-status">{t('noResults')}</p>}
      <div ref={list} id={id} role="listbox" aria-label={t('fileSearch')} aria-busy={searching} aria-activedescendant={activeId} tabIndex={0} className="sc-wb-file-results" onKeyDown={keydown}>
      <FileList key={query} className="sc-wb-file-matches" items={matches} rowHeight={42} focusKey={active?.path} visible={setRendered}>{({ path }, row) => <File path={path} current={snapshot.file} workbench={workbench} Button={Button}
        id={`${id}-${row}`} role="option" aria-selected={active?.path === path} aria-posinset={row + 1} aria-setsize={matches.length} tabIndex={-1} onFocus={() => choose(row)}>
        <span className="sc-wb-file-match"><span>{path.split('/').at(-1)}</span><small>{path}</small></span>
      </File>}</FileList></div>
    </>}
  </div>;
}
