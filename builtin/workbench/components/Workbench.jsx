import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { openSearchPanel } from '@codemirror/search';
import { startCompletion } from '@codemirror/autocomplete';
import { navigationPointer, workbenchKeydown } from '../editor/input.js';
import { Floating } from './Floating.jsx';
import { Selection } from './Selection.jsx';
import { Settings } from './Settings.jsx';
import { GitPanel } from '../git/Panel.jsx';
import { message } from '../locales.js';

function Directory({ path = '', snapshot, workbench, Button, t }) {
  const [open, setOpen] = useState(path === '');
  const list = snapshot.directories.get(path);
  return <div className="sc-wb-directory">
    {path && <Button aria-expanded={open} title={path} className="sc-wb-file" onClick={() => {
      const next = !open; setOpen(next); if (next) void workbench.list(path).catch(workbench.fail);
    }}><span aria-hidden>{open ? '⌄' : '›'}</span><span>{path.split('/').at(-1)}</span></Button>}
    {open && <div role="group">{list?.entries.map(entry => entry.type === 'directory'
      ? <Directory key={entry.path} path={entry.path} snapshot={snapshot} workbench={workbench} Button={Button} t={t} />
      : <Button key={entry.path} className="sc-wb-file" title={entry.path} aria-current={snapshot.file === entry.path ? 'page' : undefined}
        onClick={() => { void workbench.visit({ file: entry.path }).catch(workbench.fail); }}><span className="sc-wb-file-ext" aria-hidden>{entry.name.split('.').at(-1).slice(0, 3)}</span><span>{entry.name}</span></Button>)}
      {list?.truncated && <small>{t('indexLimit')}</small>}</div>}
  </div>;
}

function Locations({ data, query, search, workbench, Button, t }) {
  const [text, setText] = useState(query || '');
  const result = search ? workbench.index.search(text) : data;
  return <div className="sc-wb-locations">
    {search && <input autoFocus aria-label={t('search')} placeholder={t('searchPlaceholder')} value={text} onChange={event => setText(event.target.value)} />}
    <div className="sc-wb-results">{result.matches?.map((item, i) => <Button key={`${item.file}:${item.line}:${item.character}:${i}`} onClick={() => { void workbench.visit(item).catch(workbench.fail); }} title={`${item.file}:${item.line + 1}`}>
      <span className="sc-wb-result-path">{item.file}<small>{item.line + 1}</small></span><code>{item.lineText || item.declaration || item.name}</code>
    </Button>)}{!result.matches?.length && <p>{t('noResults')}</p>}</div>
    <footer>{result.matches?.length || 0} · {t('usageNote')}{result.truncated && <span>{t('indexLimit')}</span>}</footer>
  </div>;
}

export function Workbench({ workbench, Button, Select, t }) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot), editor = useRef(null), tooltips = useRef(null);
  useEffect(() => {
    void workbench.attach(editor.current, tooltips.current).catch(workbench.fail);
    const warn = event => { if ([...workbench.documents.values()].some(doc => doc.original !== doc.text)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { workbench.detach(); window.removeEventListener('beforeunload', warn); };
  }, [workbench]);
  const current = snapshot.tabs.find(item => item.path === snapshot.file), panel = snapshot.panel;
  const action = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  return <section className="sc-workbench sc-wb-main" data-palette={snapshot.preferences.palette} aria-label={t('title')}
    onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void workbench.save().catch(workbench.fail); }
      else workbenchKeydown(event, workbench.view());
    }} onPointerDownCapture={event => navigationPointer(event, direction => { void workbench.move(direction).catch(workbench.fail); })}
    onPointerUpCapture={event => navigationPointer(event)}>
    <header className="sc-wb-toolbar"><div className="sc-wb-nav">
      <Button title={t('back')} disabled={!snapshot.back} onClick={action(() => workbench.move(-1))}>‹</Button>
      <Button title={t('forward')} disabled={!snapshot.forward} onClick={action(() => workbench.move(1))}>›</Button>
      <span className="sc-wb-toolbar-divider" />
      <Button title={t('find')} disabled={!current} onClick={() => { const view = workbench.view(); view?.focus(); if (view) openSearchPanel(view); }}>{t('find')}</Button>
      <Button title={t('search')} onClick={() => workbench.panel({ kind: 'search' })}>{t('search')}</Button>
      <Button title={t('definition')} disabled={!current} onClick={action(workbench.definition)}>{t('definition')}</Button>
      <Button title={t('complete')} disabled={!current} onClick={() => { const view = workbench.view(); view?.focus(); if (view) startCompletion(view); }}>{t('complete')}</Button>
    </div><div className="sc-wb-nav">
      <Button title={t('git')} onClick={() => workbench.panel({ kind: 'git' })}>{t('git')}</Button>
      <Button title={t('refresh')} onClick={action(workbench.refresh)} disabled={snapshot.indexing}>↻</Button>
      <Button title={t('settings')} onClick={() => workbench.panel({ kind: 'settings' })}>{t('settings')}</Button>
      <Button title={`${t('save')} · Ctrl/⌘ + S`} disabled={!current?.dirty} onClick={action(workbench.save)} className="sc-wb-primary">{t('save')}</Button>
    </div></header>
    <div className="sc-wb-body"><aside className="sc-wb-explorer">
      <div className="sc-wb-section"><strong>{t('files')}</strong><small>{snapshot.indexing ? t('indexing') : snapshot.indexed}</small></div>
      <div className="sc-wb-file-list"><Directory snapshot={snapshot} workbench={workbench} Button={Button} t={t} /></div>
      <div className="sc-wb-section"><strong>{t('symbols')}</strong><small>{snapshot.symbols.length}</small></div>
      <div className="sc-wb-outline">{snapshot.symbols.map(item => <Button key={item.offset} title={item.declaration} className="sc-wb-file" onClick={action(() => workbench.visit(item))}><i aria-hidden>{item.kind === 'function' ? 'ƒ' : 'v'}</i><span>{item.name}</span><small>{item.line + 1}</small></Button>)}</div>
    </aside><main className="sc-wb-code">
      <nav className="sc-wb-tabs" aria-label={t('files')}>{snapshot.tabs.map(item => <Button key={item.path} aria-current={snapshot.file === item.path ? 'page' : undefined} title={item.path} onClick={action(() => workbench.visit({ file: item.path }))}>{item.path.split('/').at(-1)}{item.dirty && <i aria-label={t('unsaved')}>•</i>}</Button>)}</nav>
      <div className="sc-wb-path">{snapshot.file || t('title')}</div><div ref={editor} className="sc-wb-editor" />
      {!snapshot.file && <div className="sc-wb-empty"><strong>{t('title')}</strong><span>{t('empty')}</span></div>}
    </main></div>
    <footer className="sc-wb-status" role="status"><span className={snapshot.error ? 'sc-wb-error' : ''}>{snapshot.error || snapshot.status}</span>
      {snapshot.cursor && <span>{message(t, 'position', { line: snapshot.cursor.line + 1, column: snapshot.cursor.character + 1 })}{snapshot.cursor.length > 0 && ` · ${message(t, 'selected', { count: snapshot.cursor.length })}`}</span>}</footer>
    {createPortal(<div ref={tooltips} className="sc-workbench sc-wb-tooltips" data-palette={snapshot.preferences.palette} />, document.body)}
    {panel && <Floating key={panel.kind} title={panel.title || t(panel.kind)} close={() => workbench.panel(null)} t={t} Button={Button} palette={snapshot.preferences.palette}
      className={panel.kind === 'git' ? 'sc-wb-git-window' : ''} initialSize={panel.kind === 'git' ? { width: 1180, height: 720 } : undefined}>
      {panel.kind === 'settings' ? <Settings workbench={workbench} preferences={snapshot.preferences} Button={Button} Select={Select} t={t} />
        : panel.kind === 'git' ? <GitPanel workbench={workbench} Button={Button} Select={Select} t={t} palette={snapshot.preferences.palette} />
        : <Locations data={panel} search={panel.kind === 'search'} workbench={workbench} Button={Button} t={t} />}
    </Floating>}
    <Selection value={snapshot.assistant} workbench={workbench} Button={Button} t={t} palette={snapshot.preferences.palette} />
  </section>;
}
