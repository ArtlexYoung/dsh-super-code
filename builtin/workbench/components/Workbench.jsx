import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { openSearchPanel } from '@codemirror/search';
import { startCompletion } from '@codemirror/autocomplete';
import { navigationPointer, workbenchKeydown } from '../editor/input.js';
import { Floating, FloatingBoundary } from './Floating.jsx';
import { Selection } from './Selection.jsx';
import { Settings } from './Settings.jsx';
import { GitPanel } from '../git/Panel.jsx';
import { message } from '../locales.js';
import { ReadingPanel } from '../reading/Panel.jsx';
import { Splitter } from './Splitter.jsx';
import { readLayout, saveLayout } from '../layout.js';
import { FileList } from '../git/FileList.jsx';
import { FileChanges } from '../git/Changes.jsx';
import { Files } from './Files.jsx';
import { FileIcon } from './FileIcon.jsx';
import { QuickConversations } from './QuickConversations.jsx';

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

export function Workbench({ workbench, Button, Select, MarkdownText, Conversation, conversationRemote, conversationT, sessionId, useSessions, useSessionStatus, useInput, inputActions, openView, t }) {
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot), editor = useRef(null), tooltips = useRef(null);
  const [layout, setLayout] = useState(() => readLayout(localStorage)), savedLayout = useRef(layout);
  const [learningOpen, setLearningOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(true);
  const changeLayout = patch => { savedLayout.current = { ...savedLayout.current, ...patch }; setLayout(savedLayout.current); };
  const persistLayout = () => { try { saveLayout(localStorage, savedLayout.current); } catch { workbench.fail(new Error(t('settingsFailed'))); } };
  useEffect(() => {
    void workbench.attach(editor.current, tooltips.current).catch(workbench.fail);
    const warn = event => { if ([...workbench.documents.values()].some(doc => doc.original !== doc.text)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { workbench.reading.stop(); workbench.detach(); window.removeEventListener('beforeunload', warn); };
  }, [workbench]);
  useEffect(() => { if (learningOpen) void workbench.reading.verify(); }, [workbench, learningOpen]);
  const current = snapshot.tabs.find(item => item.path === snapshot.file), panel = snapshot.panel;
  const symbols = useMemo(() => snapshot.symbols.map(symbol => ({ key: symbol.offset, symbol })), [snapshot.symbols]);
  const action = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  return <section className="sc-workbench sc-wb-main" data-conversation-composer-overlay="" data-palette={snapshot.preferences.palette} aria-label={t('title')}
    style={{ '--wb-explorer-width': `${layout.explorer}px`, '--wb-reading-width': `${layout.reading}px`, '--wb-files-height': `${layout.files}px` }}
    onKeyDown={event => {
      if (event.target.closest('.sc-wb-conversation,.sc-wb-file-search,.sc-wb-file-menu,.sc-wb-file-dialog')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void workbench.save().catch(workbench.fail); }
      else workbenchKeydown(event, workbench.view());
    }} onPointerDownCapture={event => navigationPointer(event, direction => { void workbench.move(direction).catch(workbench.fail); })}
    onPointerUpCapture={event => navigationPointer(event)}>
    <FloatingBoundary preferences={snapshot.preferences}><header className="sc-wb-toolbar"><div className="sc-wb-nav">
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
      <span className="sc-wb-toolbar-divider" />
      <Button title={t(learningOpen ? 'readingClose' : 'readingOpen')} aria-pressed={learningOpen} aria-controls="sc-reading-panel"
        onClick={() => { setLearningOpen(!learningOpen); setConversationOpen(true); }}>{t('readingTitle')}</Button>
    </div></header>
    <div className="sc-wb-body"><aside className="sc-wb-explorer" data-files-open={layout.filesOpen} data-outline-open={layout.outlineOpen}>
      <section className="sc-wb-explorer-files" data-open={layout.filesOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.filesOpen} aria-controls="sc-wb-file-list" title={t('files')}
          onClick={() => { changeLayout({ filesOpen: !layout.filesOpen }); persistLayout(); }}><span aria-hidden>{layout.filesOpen ? '⌄' : '›'}</span><strong>{t('files')}</strong><small>{snapshot.indexing ? t('indexing') : snapshot.indexed}</small></Button>
        <div id="sc-wb-file-list" hidden={!layout.filesOpen} className="sc-wb-explorer-content"><Files snapshot={snapshot} workbench={workbench} Button={Button} t={t} visible={layout.filesOpen} /></div>
      </section>
      {layout.filesOpen && layout.outlineOpen && <Splitter panel="files" label={t('resizeFiles')} value={layout.files} ratio={.85}
        change={value => changeLayout({ files: value })} commit={persistLayout} />}
      <section className="sc-wb-explorer-outline" data-open={layout.outlineOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.outlineOpen} aria-controls="sc-wb-outline" title={t('symbols')}
          onClick={() => { changeLayout({ outlineOpen: !layout.outlineOpen }); persistLayout(); }}><span aria-hidden>{layout.outlineOpen ? '⌄' : '›'}</span><strong>{t('symbols')}</strong><small>{snapshot.symbols.length}</small></Button>
        {layout.outlineOpen && <FileList id="sc-wb-outline" className="sc-wb-outline" items={symbols} rowHeight={27}>{({ symbol: item }) => <Button title={item.declaration} className="sc-wb-file" onClick={action(() => workbench.visit(item))}><i aria-hidden>{item.kind === 'function' ? 'ƒ' : 'v'}</i><span>{item.name}</span><small>{item.line + 1}</small></Button>}</FileList>}
      </section>
    </aside><Splitter panel="explorer" label={t('resizeExplorer')} value={layout.explorer} ratio={.3}
      change={value => changeLayout({ explorer: value })} commit={persistLayout} /><main className="sc-wb-code">
      <nav className="sc-wb-tabs" aria-label={t('files')}>{snapshot.tabs.map(item => <Button key={item.path} aria-current={snapshot.file === item.path ? 'page' : undefined} title={item.path}
        onContextMenu={event => { event.preventDefault(); workbench.menu({ path: item.path, type: 'file', x: event.clientX, y: event.clientY }); }}
        onClick={action(() => workbench.visit({ file: item.path }))}><FileIcon path={item.path} />{item.path.split('/').at(-1)}{item.pinned && <span aria-label={t('filePinned')}><FileIcon pinned /></span>}{item.dirty && <i aria-label={t('unsaved')}>•</i>}</Button>)}</nav>
      <div className="sc-wb-path">{snapshot.file || t('title')}</div><div ref={editor} className="sc-wb-editor" />
      {!snapshot.file && <div className="sc-wb-empty"><strong>{t('title')}</strong><span>{t('empty')}</span></div>}
    </main><Splitter panel="reading" label={t('resizeReading')} value={layout.reading} ratio={.48}
      change={value => changeLayout({ reading: value })} commit={persistLayout} /><aside className="sc-wb-right">
      <Button className="sc-wb-section" aria-expanded={conversationOpen} aria-controls="sc-wb-right-content" title={t(learningOpen ? 'readingTitle' : 'conversation')}
        onClick={() => setConversationOpen(!conversationOpen)}><span aria-hidden>{conversationOpen ? '⌄' : '›'}</span><strong>{t(learningOpen ? 'readingTitle' : 'conversation')}</strong></Button>
      <div id="sc-wb-right-content" hidden={!conversationOpen} className="sc-wb-right-content">{learningOpen ? <ReadingPanel workbench={workbench} file={snapshot.file} Button={Button} MarkdownText={MarkdownText} t={t} />
        : <Conversation key={sessionId} sessionId={sessionId} visible={conversationOpen} useSessions={useSessions} useSessionStatus={useSessionStatus} useInput={useInput} inputActions={inputActions}
          remote={conversationRemote} detailT={conversationT} openView={openView} t={t} />}</div>
      <QuickConversations key={sessionId} items={snapshot.assistant?.conversations} workbench={workbench} Button={Button} t={t} />
      <FileChanges workbench={workbench} Button={Button} Select={Select} t={t} palette={snapshot.preferences.palette} />
    </aside></div>
    <footer className="sc-wb-status" role="status"><span className={snapshot.error ? 'sc-wb-error' : ''}>{snapshot.error || snapshot.status}</span>
      {snapshot.cursor && <span>{message(t, 'position', { line: snapshot.cursor.line + 1, column: snapshot.cursor.character + 1 })}{snapshot.cursor.length > 0 && ` · ${message(t, 'selected', { count: snapshot.cursor.length })}`}</span>}</footer>
    {createPortal(<div ref={tooltips} className="sc-workbench sc-wb-tooltips" data-palette={snapshot.preferences.palette} />, document.body)}
    {panel && <Floating key={panel.kind} title={panel.title || t(panel.kind)} close={() => workbench.panel(null)} t={t} Button={Button} palette={snapshot.preferences.palette}
      className={panel.kind === 'git' ? 'sc-wb-git-window' : ''} initialSize={panel.kind === 'git' ? { width: 1180, height: 720 } : undefined}>
      {panel.kind === 'settings' ? <Settings workbench={workbench} preferences={snapshot.preferences} Button={Button} Select={Select} t={t} />
        : panel.kind === 'git' ? <GitPanel workbench={workbench} Button={Button} Select={Select} t={t} palette={snapshot.preferences.palette} />
        : <Locations data={panel} search={panel.kind === 'search'} workbench={workbench} Button={Button} t={t} />}
    </Floating>}
    <Selection value={snapshot.assistant} workbench={workbench} Button={Button} t={t} palette={snapshot.preferences.palette} preferences={snapshot.preferences} />
    </FloatingBoundary>
  </section>;
}
