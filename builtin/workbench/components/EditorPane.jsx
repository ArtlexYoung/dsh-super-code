import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Tabs } from './Tabs.jsx';
import { Icon } from './Icon.jsx';
import { FileIcon } from './FileIcon.jsx';
import { ScopePath } from './ScopePath.jsx';
import { MarkdownPreview } from './MarkdownPreview.jsx';
import { EmptyWorkspace } from './WorkspaceRecovery.jsx';
import { groupRect } from '../editor/groups.js';

export async function openGroupTab(pane, item) {
  const workbench = pane.workbench;
  await pane.ready;
  await workbench.visit({ ...item.cursor, file: item.path, kind: item.kind });
  const { file, editorKind } = workbench.snapshot();
  if (file !== item.path || editorKind !== item.kind) return false;
  workbench.keepTab(item.path);
  return true;
}

export function EditorPane({ pane, rect, groups, active, hidden, drop, drag, split, Button, t, fileOnly, closeOnly, focus, toggleFocus, viewportLayout, cwd, list, revealDirectory, initialPreview }) {
  const workbench = pane.workbench;
  const snapshot = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const editor = useRef(null), tooltips = useRef(null), opened = useRef(false);
  const [previews, setPreviews] = useState(() => pane.previews || new Set(initialPreview ? [initialPreview] : []));
  const markdown = snapshot.editorKind === 'markdown';
  const file = snapshot.file, parts = file?.split('/') || [], name = parts.pop();
  const isMarkdown = /\.(md|markdown|mdown)$/i.test(name || ''), showBoth = isMarkdown && !markdown && previews.has(file);
  const { fileMenu, panel, closingFile, assistant } = snapshot;

  useLayoutEffect(() => {
    const ready = workbench.attach(editor.current, tooltips.current);
    pane.ready = ready;
    const initial = pane.initial;
    if (!initial) void ready.catch(workbench.fail);
    else void ready.then(async () => {
      if (pane.ready !== ready) return;
      const success = initial.restore ? await initial.restore(workbench) : await openGroupTab(pane, initial.item);
      if (pane.ready !== ready) return;
      pane.initial = null;
      if (success) await initial.opened(pane);
      else if (!workbench.snapshot().file) groups.remove(pane);
    }).catch(error => {
      if (pane.ready !== ready) return;
      pane.initial = null; initial.fail(error);
      if (!initial.restore) groups.remove(pane);
    });
    return () => { pane.ready = null; if (!pane.closed) workbench.detach(); };
  }, [groups, pane, workbench]);
  useLayoutEffect(() => {
    if (snapshot.tabs.length) opened.current = true;
    else if (!hidden && !pane.initial && opened.current) groups.remove(pane);
  }, [groups, pane, hidden, snapshot.tabs.length]);
  useLayoutEffect(() => { workbench.view()?.requestMeasure(); }, [workbench, rect.width, rect.height, focus, viewportLayout, showBoth]);

  const inlineScope = snapshot.preferences.palette === 'vscode';
  const view = name && !markdown && workbench.view();
  const scope = view && <ScopePath view={view} file={file} workbench={workbench} inline={inlineScope} Button={Button} t={t} />;
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  const preview = name && (markdown || showBoth) && <MarkdownPreview key={file} document={workbench.view()?.state.doc} file={file}
    cwd={cwd} workbench={workbench} list={list} revealDirectory={revealDirectory} t={t} />;
  return <section className="sc-wb-editor-group" data-editor-group={pane.id} data-group-active={active} style={groupRect(rect)} hidden={hidden}
    onFocusCapture={() => groups.activate(pane)} onPointerDownCapture={() => groups.activate(pane)}>
    {!closeOnly && <Tabs snapshot={snapshot} workbench={workbench} Button={Button} t={t} onlyFile={fileOnly} drag={drag} />}
    <div className="sc-wb-path">
      <div className="sc-wb-path-row">
        <div className="sc-wb-path-location">
          {parts.length > 0 && <span className="sc-wb-path-folders" title={parts.join('/')}>{parts.map((part, index) => <React.Fragment key={index}>{part}<i className="sc-wb-path-separator" aria-hidden="true" /></React.Fragment>)}</span>}
          {name && <FileIcon path={name} />}<span className="sc-wb-path-name" title={file}>{name || t('title')}</span>
        </div>
        {inlineScope && scope}
        {isMarkdown && <Button title={t(markdown ? 'markdownSource' : 'markdownPreview')} aria-label={t(markdown ? 'markdownSource' : 'markdownPreview')}
          onClick={act(() => workbench.visit({ file, kind: markdown ? 'file' : 'markdown' }))}>
          <Icon name="reading" /><span>{t(markdown ? 'markdownSource' : 'markdownPreview')}</span>
        </Button>}
        {isMarkdown && !markdown && <Button className="sc-wb-markdown-mode" title={t('markdownSplit')} aria-label={t('markdownSplit')} aria-pressed={showBoth}
          onClick={() => {
            const next = new Set(previews);
            if (!next.delete(file)) next.add(file);
            pane.previews = next; setPreviews(next);
          }}><Icon name="splitRight" /><span>{t('markdownSplit')}</span></Button>}
        {name && !markdown && <Button className="sc-wb-reader-toggle" title={t('readerMode')} aria-label={t('readerMode')} aria-pressed={snapshot.preferences.readerMode}
          onClick={act(() => {
            const { preferences } = workbench.snapshot();
            workbench.settings({ ...preferences, readerMode: !preferences.readerMode });
          })}><Icon name="reader" /><span>{t('readerMode')}</span></Button>}
        {name && toggleFocus && active && <Button className="sc-wb-reading-focus" title={t('readingFocus')} aria-label={t('readingFocus')} aria-pressed={focus}
          onClick={toggleFocus}><Icon name={focus ? 'focusReturn' : 'focus'} /><span>{t('readingFocus')}</span></Button>}
      </div>
    </div>
    <div className="sc-wb-editor-area" data-markdown-split={showBoth}>
      <div ref={editor} className="sc-wb-editor" hidden={markdown} />
      {preview}
      {!file && <EmptyWorkspace workbench={workbench} snapshot={snapshot} Button={Button} t={t} />}
      {split && drag?.dragging && <div className="sc-wb-editor-drop-zones" aria-hidden="true">
        {['left', 'right', 'up', 'down'].map(direction => <i key={direction} data-direction={direction} />)}
        {drop?.direction && <div className="sc-wb-editor-drop-preview" data-direction={drop.direction} />}
        {drop?.type === 'move' && <div className="sc-wb-editor-drop-preview" />}
      </div>}
    </div>
    {!inlineScope && scope}
    {createPortal(<div ref={tooltips} className="sc-workbench sc-wb-tooltips" data-palette={snapshot.preferences.palette} data-overlay-open={!active || Boolean(fileMenu || panel || closingFile || assistant?.visible)} />, document.body)}
  </section>;
}
