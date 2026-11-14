import React, { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from '../git/FileList.jsx';
import { matchFiles } from '../file-search.js';
import { errorText, message } from '../locales.js';
import { FileIcon } from './FileIcon.jsx';
import { FileActions } from './FileActions.jsx';

function File({ path, current, workbench, Button, children }) {
  return <Button className="sc-wb-file" title={path} aria-current={current === path ? 'page' : undefined}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); workbench.menu({ path, type: 'file', x: event.clientX, y: event.clientY }); }}
    onClick={() => { void workbench.visit({ file: path }).catch(workbench.fail); }}>
    <FileIcon path={path} />{children}
  </Button>;
}

function Directory({ path = '', snapshot, workbench, Button, t }) {
  const [open, setOpen] = useState(path === '');
  const list = snapshot.directories.get(path);
  useEffect(() => {
    if (path && snapshot.file?.startsWith(`${path}/`)) {
      setOpen(true);
      if (!snapshot.directories.has(path)) void workbench.list(path).catch(workbench.fail);
    }
  }, [path, snapshot.file, workbench]);
  return <div className="sc-wb-directory">
    {path && <Button aria-expanded={open} title={path} className="sc-wb-file"
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); workbench.menu({ path, type: 'directory', x: event.clientX, y: event.clientY }); }} onClick={() => {
      const next = !open; setOpen(next); if (next) void workbench.list(path).catch(workbench.fail);
    }}><span aria-hidden>{open ? '⌄' : '›'}</span><FileIcon path={path} directory open={open} /><span>{path.split('/').at(-1)}</span></Button>}
    {open && <div role="group">{list?.entries.map(entry => entry.type === 'directory'
      ? <Directory key={entry.path} path={entry.path} snapshot={snapshot} workbench={workbench} Button={Button} t={t} />
      : <File key={entry.path} path={entry.path} current={snapshot.file} workbench={workbench} Button={Button}><span>{entry.name}</span></File>)}
      {list?.truncated && <small>{t('fileSearchLimit')}</small>}</div>}
  </div>;
}

export function Files({ snapshot, workbench, Button, t, visible }) {
  const [text, setText] = useState(''), input = useRef(null), query = useDeferredValue(text);
  const search = useSyncExternalStore(workbench.files.subscribe, workbench.files.snapshot);
  const filtering = Boolean(text.trim());
  const searching = search.searching || query !== text;
  const matches = useMemo(() => matchFiles(search.files, query).map(path => ({ key: path, path })), [search.files, query]);
  useEffect(() => {
    workbench.files.activate(visible && filtering);
    return () => workbench.files.activate(false);
  }, [workbench, visible, filtering]);
  const clear = () => { setText(''); input.current?.focus(); };
  return <div className="sc-wb-files" onContextMenu={event => {
    if (event.target.closest('input')) return;
    event.preventDefault(); event.stopPropagation(); workbench.menu({ path: '', type: 'directory', x: event.clientX, y: event.clientY });
  }}>
    <div className="sc-wb-file-search">
      <input ref={input} aria-label={t('fileSearch')} placeholder={t('fileSearchPlaceholder')} autoComplete="off" spellCheck={false}
        value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); }
          if (event.key === 'Enter' && matches.length && query === text) { event.preventDefault(); void workbench.visit({ file: matches[0].path }).catch(workbench.fail); }
        }} />
      {text && <Button title={t('clearFileSearch')} aria-label={t('clearFileSearch')} onClick={clear}>×</Button>}
    </div>
    <div className="sc-wb-file-list" hidden={filtering}><Directory snapshot={snapshot} workbench={workbench} Button={Button} t={t} /></div>
    {filtering && <>
      <div className="sc-wb-file-search-status" role="status">{searching ? t('fileSearching') : message(t, 'fileSearchCount', { count: matches.length })}</div>
      {search.error && <div className="sc-wb-file-search-status" role="alert" title={errorText(search.error, t)}>{t('fileSearchFailed')}<Button title={t('fileSearchRetry')} onClick={() => workbench.files.reset()}>{t('fileSearchRetry')}</Button></div>}
      {search.truncated && <div className="sc-wb-file-search-status">{t('fileSearchLimit')}</div>}
      {!searching && !matches.length && <p className="sc-wb-file-search-status">{t('noResults')}</p>}
      <FileList key={query} className="sc-wb-file-matches" items={matches} rowHeight={42}>{({ path }) => <File path={path} current={snapshot.file} workbench={workbench} Button={Button}>
        <span className="sc-wb-file-match"><span>{path.split('/').at(-1)}</span><small>{path}</small></span>
      </File>}</FileList>
    </>}
    <FileActions snapshot={snapshot} workbench={workbench} Button={Button} t={t} />
  </div>;
}
