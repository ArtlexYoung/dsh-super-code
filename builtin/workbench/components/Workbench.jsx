import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigationPointer, workbenchKeydown } from '../editor/input.js';
import { Floating, FloatingBoundary, useDialogKeyboard } from './Floating.jsx';
import { Selection } from './Selection.jsx';
import { message } from '../locales.js';
import { ReadingPanel } from '../reading/Panel.jsx';
import { Splitter } from './Splitter.jsx';
import { Outline } from './Outline.jsx';
import { Files } from './Files.jsx';
import { FileActions } from './FileActions.jsx';
import { CloseFile } from './Tabs.jsx';
import { EditorGroups, useTabLayout } from './EditorGroups.jsx';
import { Sidebar, rightPanels } from './Sidebar.jsx';
import { Icon } from './Icon.jsx';
import { actions, keyOf, matchesShortcut } from '../editor/preferences.js';
import { workbenchCommands } from '../commands.js';
import { fileTarget, WORKBENCH_VIEW } from '../file-links.js';
import { Toolbar } from './Toolbar.jsx';
import { PanelContent } from './PanelContent.jsx';
import { RecoveryNotice } from './WorkspaceRecovery.jsx';


export function Workbench({ workbench: primary, Button, Select, MarkdownText, Conversation, conversationRemote, conversationT, sessionId, useSessions, useSessionStatus, useInput, inputActions, useChat, useConversation, fileContext, fileMentions, openView, viewRequest, completeViewRequest, presentation = { kind: 'workbench' }, t }) {
  const groups = primary.groups, groupLayout = useSyncExternalStore(groups.subscribe, groups.snapshot), { active } = groupLayout;
  const workbench = useMemo(() => {
    const view = active.workbench;
    return view === primary ? primary : { ...view, list: primary.list, files: primary.files, changes: primary.changes, refresh: primary.refresh,
      returnToHost: primary.returnToHost,
      reading: primary.reading.forView?.({ currentFile: () => view.snapshot().file, visit: view.visit }) || view.reading };
  }, [primary, active]);
  const base = useSyncExternalStore(primary.subscribe, primary.snapshot), currentView = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const snapshot = workbench === primary ? base : { ...currentView, directories: base.directories, indexed: base.indexed, indexing: base.indexing };
  const layout = useSyncExternalStore(primary.layout.subscribe, primary.layout.snapshot), rightOpen = layout.panes;
  const [readingFocus, setReadingFocus] = useState(false), [directory, setDirectory] = useState(null);
  const [expandedTool, setExpandedTool] = useState(null);
  const expandedPane = rightOpen[expandedTool] ? expandedTool : null;
  const sidebarId = useId();
  const explorerOpen = layout.explorerOpen && (layout.filesOpen || layout.outlineOpen), rightVisible = Object.values(rightOpen).some(Boolean);
  const fileOnly = presentation.kind === 'file', panelOnly = presentation.kind === 'panel', selectionOnly = presentation.kind === 'selection', closeOnly = presentation.kind === 'closeFile', focused = fileOnly || panelOnly || selectionOnly || closeOnly;
  const closingConflict = closeOnly && snapshot.panel?.kind === 'saveConflict';
  const canSplit = !focused && Boolean(primary.createPane);
  const openTabWindow = primary.openFileWindow || primary.openWindow;
  const tabLayout = useTabLayout(groups, openTabWindow, canSplit);
  const dialog = useRef({ order: 0 });
  Object.assign(dialog.current, { shortcut: keyOf(snapshot.preferences, 'close'), close: () => {
    if (snapshot.panel?.busy) return;
    if (closeOnly && !closingConflict) workbench.cancelCloseFile(); else workbench.panel(null);
    void workbench.returnToHost().catch(workbench.fail);
  } });
  useDialogKeyboard(dialog.current, panelOnly || closeOnly);
  const openFile = useCallback((file, options) => {
    const target = fileTarget(file, options, fileContext?.() || {});
    const pane = groups.snapshot().active;
    void Promise.resolve(pane.ready).then(() => pane.workbench.visit(target)).catch(pane.workbench.fail);
  }, [groups, fileContext]);
  const changeLayout = primary.layout.change;
  const persistLayout = () => { void Promise.resolve().then(primary.layout.save).catch(() => workbench.fail(new Error(t('settingsFailed')))); };
  const revealDirectory = useCallback(path => {
    setDirectory({ path });
    if (!fileOnly) changeLayout({ explorerOpen: true, filesOpen: true });
  }, [changeLayout, fileOnly]);
  useEffect(() => {
    const warn = event => {
      if (!primary.external && primary.hasUnsavedFiles()) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => { if (!primary.snapshot().window) primary.reading.stop(); window.removeEventListener('beforeunload', warn); };
  }, [primary]);
  useEffect(() => {
    if (viewRequest?.view !== WORKBENCH_VIEW || !viewRequest.focus) return;
    let pending = true;
    const pane = groups.snapshot().active;
    void Promise.resolve(pane.ready).then(() => {
      if (pending) return pane.workbench.visit(JSON.parse(viewRequest.focus));
    }).catch(pane.workbench.fail).finally(() => { if (pending) completeViewRequest(); });
    return () => { pending = false; };
  }, [groups, viewRequest, completeViewRequest]);
  useEffect(() => { if (rightOpen.learning) void workbench.reading.verify(); }, [workbench, rightOpen.learning]);
  const current = snapshot.tabs.find(item => item.path === snapshot.file && item.kind === 'file'), panel = snapshot.panel;
  useEffect(() => { if (fileOnly) setDirectory(null); }, [fileOnly, snapshot.file]);
  const readingFocusActive = Boolean(snapshot.file && !focused && readingFocus);
  const toggleFocus = useCallback(() => setReadingFocus(value => !value), []);
  const toggleExplorer = key => {
    const next = { filesOpen: layout.explorerOpen && layout.filesOpen, outlineOpen: layout.explorerOpen && layout.outlineOpen };
    next[key] = !next[key];
    changeLayout({ ...next, explorerOpen: Object.values(next).some(Boolean) }); persistLayout();
  };
  const toggleRight = key => {
    setExpandedTool(null);
    if (expandedPane && rightOpen[key]) return;
    changeLayout({ panes: { [key]: !rightOpen[key] } }); persistLayout();
  };
  const searchDocked = !focused && panel?.kind === 'search' && !!panel.docked;
  const action = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  return <section className="sc-workbench sc-wb-main" lang={t('languageTag')} tabIndex={-1} data-conversation-composer-overlay="" data-palette={snapshot.preferences.palette} data-density={snapshot.preferences.density} data-search-docked={searchDocked} data-tool-names={snapshot.preferences.showToolNames} aria-label={t('title')}
    style={{ '--wb-explorer-width': `${layout.explorer}px`, '--wb-reading-width': `${layout.reading}px`, '--wb-files-height': `${layout.files}px` }}
    onKeyDownCapture={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.target.closest('.sc-wb-conversation,[data-workbench-dialog]')) return;
      const action = actions.find(item => item.surface && matchesShortcut(event, keyOf(snapshot.preferences, item.id)));
      if (!action) return;
      const command = workbenchCommands(workbench, snapshot, t, !focused ? toggleFocus : undefined)[action.id];
      event.preventDefault(); event.stopPropagation();
      if (!command.disabled) void Promise.resolve().then(command.run).catch(workbench.fail);
    }}
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
    <div className="sc-wb-window-content">
    <FloatingBoundary preferences={snapshot.preferences}>
    {focused ? <header className="sc-wb-focused-toolbar"><strong>{fileOnly ? snapshot.file : panelOnly || closingConflict ? panel?.title || panel?.path || t(panel?.kind || 'title') : t(closeOnly ? 'closeFile' : 'selection')}</strong><nav>
      {fileOnly && <Button disabled={!current?.dirty} onClick={action(() => workbench.save())}><Icon name="save" />{t('save')}</Button>}
      <Button onClick={workbench.returnToHost}><Icon name="back" />{t('windowReturn')}</Button></nav></header>
      : <Toolbar workbench={workbench} snapshot={snapshot} current={current} Button={Button} t={t} toggleFocus={toggleFocus} />}
    <RecoveryNotice workbench={primary} state={base.recovery} Button={Button} t={t} />
    <div className="sc-wb-body" data-focused={focused} data-reading-focus={readingFocusActive || searchDocked} data-left-open={explorerOpen} data-right-open={rightVisible} hidden={panelOnly || selectionOnly || closeOnly}>
      {!focused && <nav className="sc-wb-side-rail" aria-label={t('explorerBar')}>{[{ key: 'filesOpen', label: 'files', icon: 'files' }, { key: 'outlineOpen', label: 'symbols', icon: 'outline' }].map(item =>
        <Button key={item.key} aria-pressed={explorerOpen && layout[item.key]} title={t(item.label)} onClick={() => toggleExplorer(item.key)}><Icon name={item.icon} /><span>{t(item.label)}</span></Button>)}</nav>}
      {!focused && <aside className="sc-wb-explorer" hidden={!explorerOpen} data-files-open={layout.filesOpen} data-outline-open={layout.outlineOpen}>
      <section className="sc-wb-explorer-files" data-open={layout.filesOpen} hidden={!layout.filesOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.filesOpen} aria-controls="sc-wb-file-list" title={t('files')}
          onClick={() => toggleExplorer('filesOpen')}><Icon name="chevron" /><strong>{t('files')}</strong><small>{snapshot.indexing ? t('indexing') : snapshot.indexed}</small></Button>
        <div id="sc-wb-file-list" hidden={!layout.filesOpen} className="sc-wb-explorer-content"><Files snapshot={snapshot} workbench={workbench} Button={Button} t={t} visible={layout.filesOpen} directory={directory} /></div>
      </section>
      {layout.filesOpen && layout.outlineOpen && <Splitter panel="files" label={t('resizeFiles')} value={layout.files} ratio={.85}
        change={value => changeLayout({ files: value })} commit={persistLayout} />}
      <section className="sc-wb-explorer-outline" data-open={layout.outlineOpen} hidden={!layout.outlineOpen}>
        <Button className="sc-wb-section" aria-expanded={layout.outlineOpen} aria-controls="sc-wb-outline" title={t('symbols')}
          onClick={() => toggleExplorer('outlineOpen')}><Icon name="chevron" /><strong>{t('symbols')}</strong></Button>
        {layout.outlineOpen && <Outline key={snapshot.file} symbols={snapshot.symbols} readerMode={snapshot.preferences.readerMode} workbench={workbench} Button={Button} t={t} />}
      </section>
    </aside>}{!focused && explorerOpen && <Splitter panel="explorer" label={t('resizeExplorer')} value={layout.explorer} ratio={.3}
      change={value => changeLayout({ explorer: value })} commit={persistLayout} />}<EditorGroups groups={groups} layout={groupLayout} tabLayout={tabLayout} canSplit={canSplit} Button={Button} t={t}
      fileOnly={fileOnly} closeOnly={closeOnly} focus={readingFocusActive} toggleFocus={!focused ? toggleFocus : undefined}
      viewportLayout={layout} cwd={fileContext?.()?.cwd} list={primary.list} revealDirectory={revealDirectory}
      initialPreview={presentation.markdownSplit ? presentation.file : undefined} />{!focused && rightVisible && <Splitter panel="reading" label={t('resizeReading')} value={layout.reading} ratio={.48}
      change={value => changeLayout({ reading: value })} commit={persistLayout} />}{!focused && <Sidebar key={sessionId} hidden={!rightVisible} id={sidebarId}
      workbench={workbench} Button={Button} Select={Select} t={t} layout={layout} changeLayout={changeLayout} persistLayout={persistLayout}
      open={rightOpen} toggle={toggleRight} expandedPane={expandedPane} expand={setExpandedTool} items={snapshot.assistant?.conversations}
      learning={<ReadingPanel workbench={workbench} file={snapshot.file} Button={Button} MarkdownText={MarkdownText} t={t} />}
      conversation={<Conversation key={sessionId} sessionId={sessionId} visible={rightOpen.conversation && (!expandedPane || expandedPane === 'conversation')} useSessions={useSessions} useSessionStatus={useSessionStatus} useInput={useInput} inputActions={inputActions}
          remote={conversationRemote} detailT={conversationT} openView={openView} openFile={openFile} useChat={useChat} useConversation={useConversation} fileMentions={fileMentions} t={t} />} />}
      {!focused && <nav className="sc-wb-side-rail sc-wb-side-rail-right" aria-label={t('conversationBar')}>{rightPanels.map(item =>
        <Button key={item.key} aria-pressed={rightOpen[item.key]} aria-controls={`${sidebarId}-${item.key}`} title={t(item.label)} onClick={() => toggleRight(item.key)}><Icon name={item.icon} /><span>{t(item.label)}</span></Button>)}</nav>}
    </div>
    {(panelOnly || closingConflict) && <section className={`sc-wb-focused-panel${panel?.kind === 'fileAction' ? ' sc-wb-file-dialog' : ''}`} data-workbench-dialog>{panel ? <PanelContent key={panel.id} panel={panel} workbench={workbench} Button={Button} Select={Select} t={t} /> : <div className="sc-wb-empty">{t('windowContentClosed')}</div>}</section>}
    {closeOnly && !closingConflict && <section className="sc-wb-focused-panel" data-workbench-dialog>{snapshot.closingFile ? <CloseFile path={snapshot.closingFile} workbench={workbench} snapshot={snapshot} Button={Button} t={t} inline /> : <p>{t('windowContentClosed')}</p>}</section>}
    <footer className="sc-wb-status" role="status"><span className={snapshot.error || snapshot.studyError ? 'sc-wb-error' : ''}>{snapshot.error || snapshot.studyError || snapshot.status}</span>
      {(snapshot.unsaved?.length > 0 || snapshot.drafts?.candidates.length > 0 || snapshot.drafts?.error) && <Button onClick={() => workbench.panel({ kind: 'drafts' })}>{message(t, 'draftCount', { count: snapshot.unsaved?.length || 0 })}{snapshot.drafts?.error ? ' !' : snapshot.drafts?.candidates.length ? ` · ${t('draftAvailable')}` : ''}</Button>}
      {snapshot.saveConflict && <Button className="sc-wb-conflict-link" onClick={() => workbench.panel({ kind: 'saveConflict', path: snapshot.saveConflict })}>{t('saveConflict')}</Button>}
      {snapshot.cursor && <span>{message(t, 'position', { line: snapshot.cursor.line + 1, column: snapshot.cursor.character + 1 })}{snapshot.cursor.length > 0 && ` · ${message(t, 'selected', { count: snapshot.cursor.length })}`}</span>}</footer>
    {panel && (!focused || fileOnly) && !(panel.kind === 'diff' && panel.origin === 'sidebar' && !workbench.external) && <Floating key={panel.id || panel.kind} openWindow={workbench.openWindow ? () => workbench.openWindow({ kind: 'panel' }) : undefined} title={panel.title || panel.path || t(panel.kind)} close={() => { if (panel.busy) return; workbench.panel(null); if (panel.kind === 'navigate') workbench.view()?.focus(); }} t={t} Button={Button} palette={snapshot.preferences.palette}
      docked={searchDocked} toggleDock={!focused && panel.kind === 'search' ? () => workbench.panel({ ...panel, docked: !searchDocked }) : undefined}
      className={['git', 'diff', 'lineHistory', 'fileCompare', 'saveConflict'].includes(panel.kind) ? 'sc-wb-git-window' : panel.kind === 'fileAction' ? 'sc-wb-file-dialog' : ''}
      initialSize={['git', 'diff', 'lineHistory', 'fileCompare', 'saveConflict'].includes(panel.kind) ? { width: 1180, height: 720 } : panel.kind === 'settings' ? { width: 920, height: 680 } : panel.kind === 'fileAction' ? { width: 470, height: 260 } : undefined}>
      <PanelContent panel={panel} workbench={workbench} Button={Button} Select={Select} t={t} toggleFocus={!focused ? toggleFocus : undefined} />
    </Floating>}
    {fileOnly && directory && <Floating title={t('files')} close={() => setDirectory(null)} t={t} Button={Button} palette={snapshot.preferences.palette}>
      <Files snapshot={snapshot} workbench={workbench} Button={Button} t={t} visible directory={directory} />
    </Floating>}
    <FileActions snapshot={snapshot} workbench={workbench} Button={Button} t={t}
      splitTab={canSplit ? (item, direction) => tabLayout.split(active, item, direction) : undefined}
      detachTab={openTabWindow ? item => tabLayout.detach(active, item) : undefined} />
    {(!focused || fileOnly || selectionOnly) && <Selection value={snapshot.assistant} workbench={workbench} Button={Button} t={t} palette={snapshot.preferences.palette} preferences={snapshot.preferences} inline={selectionOnly} />}
    </FloatingBoundary></div>
  </section>;
}
