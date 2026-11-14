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
import { Tabs } from './Tabs.jsx';
import { QuickConversations } from './QuickConversations.jsx';
import { Icon } from './Icon.jsx';
import { Replace } from './Replace.jsx';
import { keyOf, keyLabel, matchesShortcut } from '../editor/preferences.js';
import { editingCommands } from '../editor/input.js';

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
  const shortcut = id => <kbd>{keyLabel(keyOf(snapshot.preferences, id), t('space'))}</kbd>;
  return <section className="sc-workbench sc-wb-main" tabIndex={-1} data-conversation-composer-overlay="" data-palette={snapshot.preferences.palette} aria-label={t('title')}
    style={{ '--wb-explorer-width': `${layout.explorer}px`, '--wb-reading-width': `${layout.reading}px`, '--wb-files-height': `${layout.files}px` }}
    onKeyDown={event => {
      if (event.target.closest('.sc-wb-conversation,.sc-wb-file-search,.sc-wb-file-menu,.sc-wb-file-dialog')) return;
      if (event.target.closest('input,textarea,[contenteditable]') && !event.target.closest('.cm-editor')) return;
      if (!workbench.view() && !event.target.closest('[data-workbench-dialog]')) {
        const commands = { undo: () => workbench.undo(), redo: () => workbench.undo('redo'), project: () => workbench.panel({ kind: 'search' }), projectReplace: () => workbench.panel({ kind: 'projectReplace' }) };
        const id = Object.keys(commands).find(id => matchesShortcut(event, keyOf(snapshot.preferences, id)));
        if (id && !event.defaultPrevented) { event.preventDefault(); void Promise.resolve().then(commands[id]).catch(workbench.fail); }
      }
      workbenchKeydown(event, workbench.view());
    }} onPointerDownCapture={event => {
      if (event.button === 0 && event.target.classList.contains('sc-wb-editor') && !workbench.view()) event.currentTarget.focus({ preventScroll: true });
      navigationPointer(event, direction => { void workbench.move(direction).catch(workbench.fail); });
    }}
    onPointerUpCapture={event => navigationPointer(event)}>
    <FloatingBoundary preferences={snapshot.preferences}><header className="sc-wb-toolbar"><div className="sc-wb-nav">
      <Button title={t('back')} disabled={!snapshot.back} onClick={action(() => workbench.move(-1))}><Icon name="back" />{t('back')}{shortcut('back')}</Button>
      <Button title={t('forward')} disabled={!snapshot.forward} onClick={action(() => workbench.move(1))}><Icon name="forward" />{t('forward')}{shortcut('forward')}</Button>
      <span className="sc-wb-toolbar-divider" />
      <Button title={t('find')} disabled={!current} onClick={() => { const view = workbench.view(); view?.focus(); if (view) openSearchPanel(view); }}><Icon name="find" />{t('find')}{shortcut('find')}</Button>
      <Button title={t('replace')} disabled={!current} onClick={() => { const view = workbench.view(); if (view) editingCommands.replace(view); }}><Icon name="replace" />{t('replace')}{shortcut('replace')}</Button>
      <Button title={t('search')} onClick={() => workbench.panel({ kind: 'search' })}><Icon name="search" />{t('search')}{shortcut('project')}</Button>
      <Button title={t('projectReplace')} onClick={() => workbench.panel({ kind: 'projectReplace' })}><Icon name="replace" />{t('projectReplace')}{shortcut('projectReplace')}</Button>
      <Button title={t('definition')} disabled={!current} onClick={action(workbench.definition)}><Icon name="definition" />{t('definition')}{shortcut('definition')}</Button>
      <Button title={t('complete')} disabled={!current} onClick={() => { const view = workbench.view(); view?.focus(); if (view) startCompletion(view); }}><Icon name="complete" />{t('complete')}{shortcut('complete')}</Button>
    </div><div className="sc-wb-nav">
      <Button title={t('git')} onClick={() => workbench.panel({ kind: 'git' })}><Icon name="git" />{t('git')}</Button>
      <Button title={t('refresh')} onClick={action(workbench.refresh)} disabled={snapshot.indexing}><Icon name="refresh" />{t('refreshShort')}</Button>
      <Button title={t('settings')} onClick={() => workbench.panel({ kind: 'settings' })}><Icon name="settings" />{t('settings')}</Button>
      <Button title={t('save')} disabled={!current?.dirty} onClick={action(workbench.save)} className="sc-wb-primary"><Icon name="save" />{t('save')}{shortcut('save')}</Button>
      <Button title={t('action_undo')} onClick={action(() => workbench.undo())}>{t('action_undo')}{shortcut('undo')}</Button>
      <Button title={t('action_redo')} onClick={action(() => workbench.undo('redo'))}>{t('action_redo')}{shortcut('redo')}</Button>
      <span className="sc-wb-toolbar-divider" />
      <Button title={t(learningOpen ? 'readingClose' : 'readingOpen')} aria-pressed={learningOpen} aria-controls="sc-reading-panel"
        onClick={() => { setLearningOpen(!learningOpen); setConversationOpen(true); }}><Icon name="reading" />{t('readingTitle')}</Button>
    </div></header>
    <div className="sc-wb-body"><aside className="sc-wb-explorer" data-files-open={layout.filesOpen} data-outline-open={layout.outlineOpen}>
      <section className="sc-wb-explorer-files" data-open={layout.filesOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.filesOpen} aria-controls="sc-wb-file-list" title={t('files')}
          onClick={() => { changeLayout({ filesOpen: !layout.filesOpen }); persistLayout(); }}><Icon name="chevron" /><strong>{t('files')}</strong><small>{snapshot.indexing ? t('indexing') : snapshot.indexed}</small></Button>
        <div id="sc-wb-file-list" hidden={!layout.filesOpen} className="sc-wb-explorer-content"><Files snapshot={snapshot} workbench={workbench} Button={Button} t={t} visible={layout.filesOpen} /></div>
      </section>
      {layout.filesOpen && layout.outlineOpen && <Splitter panel="files" label={t('resizeFiles')} value={layout.files} ratio={.85}
        change={value => changeLayout({ files: value })} commit={persistLayout} />}
      <section className="sc-wb-explorer-outline" data-open={layout.outlineOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.outlineOpen} aria-controls="sc-wb-outline" title={t('symbols')}
          onClick={() => { changeLayout({ outlineOpen: !layout.outlineOpen }); persistLayout(); }}><Icon name="chevron" /><strong>{t('symbols')}</strong><small>{snapshot.symbols.length}</small></Button>
        {layout.outlineOpen && <FileList id="sc-wb-outline" className="sc-wb-outline" items={symbols} rowHeight={27}>{({ symbol: item }) => <Button title={item.declaration} className="sc-wb-file" onClick={action(() => workbench.visit(item))}><Icon name={item.kind === 'function' ? 'function' : 'variable'} /><span>{item.name}</span><small>{item.line + 1}</small></Button>}</FileList>}
      </section>
    </aside><Splitter panel="explorer" label={t('resizeExplorer')} value={layout.explorer} ratio={.3}
      change={value => changeLayout({ explorer: value })} commit={persistLayout} /><main className="sc-wb-code">
      <Tabs snapshot={snapshot} workbench={workbench} Button={Button} t={t} />
      <div className="sc-wb-path">{snapshot.file || t('title')}</div><div ref={editor} className="sc-wb-editor" />
      {!snapshot.file && <div className="sc-wb-empty"><strong>{t('title')}</strong><span>{t('empty')}</span></div>}
    </main><Splitter panel="reading" label={t('resizeReading')} value={layout.reading} ratio={.48}
      change={value => changeLayout({ reading: value })} commit={persistLayout} /><aside className="sc-wb-right">
      <Button className="sc-wb-section" aria-expanded={conversationOpen} aria-controls="sc-wb-right-content" title={t(learningOpen ? 'readingTitle' : 'conversation')}
        onClick={() => setConversationOpen(!conversationOpen)}><Icon name="chevron" /><strong>{t(learningOpen ? 'readingTitle' : 'conversation')}</strong></Button>
      <div id="sc-wb-right-content" hidden={!conversationOpen} className="sc-wb-right-content">{learningOpen ? <ReadingPanel workbench={workbench} file={snapshot.file} Button={Button} MarkdownText={MarkdownText} t={t} />
        : <Conversation key={sessionId} sessionId={sessionId} visible={conversationOpen} useSessions={useSessions} useSessionStatus={useSessionStatus} useInput={useInput} inputActions={inputActions}
          remote={conversationRemote} detailT={conversationT} openView={openView} t={t} />}</div>
      <QuickConversations key={sessionId} items={snapshot.assistant?.conversations} workbench={workbench} Button={Button} t={t} />
      <FileChanges workbench={workbench} Button={Button} Select={Select} t={t} />
    </aside></div>
    <footer className="sc-wb-status" role="status"><span className={snapshot.error ? 'sc-wb-error' : ''}>{snapshot.error || snapshot.status}</span>
      {snapshot.cursor && <span>{message(t, 'position', { line: snapshot.cursor.line + 1, column: snapshot.cursor.character + 1 })}{snapshot.cursor.length > 0 && ` · ${message(t, 'selected', { count: snapshot.cursor.length })}`}</span>}</footer>
    {createPortal(<div ref={tooltips} className="sc-workbench sc-wb-tooltips" data-palette={snapshot.preferences.palette} />, document.body)}
    {panel && <Floating key={panel.kind} title={panel.title || t(panel.kind)} close={() => workbench.panel(null)} t={t} Button={Button} palette={snapshot.preferences.palette}
      className={panel.kind === 'git' ? 'sc-wb-git-window' : ''} initialSize={panel.kind === 'git' ? { width: 1180, height: 720 } : undefined}>
      {panel.kind === 'settings' ? <Settings workbench={workbench} preferences={snapshot.preferences} Button={Button} Select={Select} t={t} />
        : panel.kind === 'git' ? <GitPanel workbench={workbench} Button={Button} Select={Select} t={t} palette={snapshot.preferences.palette} />
        : panel.kind === 'projectReplace' ? <Replace workbench={workbench} Button={Button} t={t} />
        : <Locations data={panel} search={panel.kind === 'search'} workbench={workbench} Button={Button} t={t} />}
    </Floating>}
    <Selection value={snapshot.assistant} workbench={workbench} Button={Button} t={t} palette={snapshot.preferences.palette} preferences={snapshot.preferences} />
    </FloatingBoundary>
  </section>;
}
