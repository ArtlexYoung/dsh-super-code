import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileIcon } from './FileIcon.jsx';
import { Icon } from './Icon.jsx';
import { Floating } from './Floating.jsx';
import { errorText, message } from '../locales.js';

export function CloseFile({ path, workbench, snapshot, Button, t, inline }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) workbench.cancelCloseFile(); };
  const confirm = mode => async () => {
    setBusy(true); setError('');
    try { await workbench.closeFile(path, mode); }
    catch (failure) { setError(errorText(failure, t)); }
    finally { setBusy(false); }
  };
  const content = <>
    <p>{message(t, 'tabCloseQuestion', { path })}</p>
    {error && <p role="alert">{error}</p>}
    {snapshot.saveConflict === path && <Button disabled={busy} onClick={() => { workbench.cancelCloseFile(); workbench.panel({ kind: 'saveConflict', path }); }}>{t('saveConflict')}</Button>}
    <footer><Button disabled={busy} onClick={close}>{t('fileCancel')}</Button>
      <Button disabled={busy} onClick={confirm('keep')}>{t('tabKeepAndClose')}</Button>
      <Button className="sc-wb-primary" disabled={busy} onClick={confirm('save')}>{t(busy ? 'working' : 'tabSaveAndClose')}</Button></footer>
  </>;
  return inline ? <div className="sc-wb-close-file">{content}</div> : <Floating title={t('closeFile')} close={close} t={t} Button={Button} palette={snapshot.preferences.palette}
    openWindow={workbench.openWindow ? () => workbench.openWindow({ kind: 'closeFile' }) : undefined}
    className="sc-wb-close-file" initialSize={{ width: 530, height: 240 }}>{content}</Floating>;
}

export function Tabs({ snapshot, workbench, Button, t, onlyFile = false, drag }) {
  const container = useRef(null), gesture = useRef(null), suppressClick = useRef(false), [drop, setDrop] = useState(null);
  useLayoutEffect(() => {
    const nav = container.current;
    const reveal = () => {
      const active = nav.querySelector('[data-active=true]'); if (!active) return;
      const bounds = nav.getBoundingClientRect(), tab = active.getBoundingClientRect();
      if (tab.left < bounds.left || tab.width > nav.clientWidth) nav.scrollLeft += tab.left - bounds.left;
      else if (tab.right > bounds.right) nav.scrollLeft += tab.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal); observer.observe(nav);
    return () => observer.disconnect();
  }, [snapshot.file, snapshot.editorKind, snapshot.tabs.length]);
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  const close = item => { void workbench.closeFile(item.path, 'check', item.kind).catch(workbench.fail); };
  const reset = () => { if (gesture.current?.moved) drag?.end(); gesture.current = null; setDrop(null); };
  const targetAt = (event, hit) => {
    const target = hit?.closest('[data-file-tab]');
    if (!target || !event.currentTarget.contains(target)) return null;
    const item = snapshot.tabs.find(item => item.id === target.dataset.tabId), source = snapshot.tabs.find(item => item.id === gesture.current?.id);
    return item && source && item.pinned === source.pinned ? { id: item.id, after: event.clientX > target.getBoundingClientRect().left + target.offsetWidth / 2 } : null;
  };
  return <>
    <nav ref={container} className="sc-wb-tabs" aria-label={t('files')} onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }} onPointerDown={event => {
      suppressClick.current = false;
      if (event.button === 1) { event.preventDefault(); return; }
      if (event.button !== 0 || event.target.closest('.sc-wb-tab-close')) return;
      const tab = event.target.closest('[data-file-tab]'); if (!tab) return;
      gesture.current = { path: tab.dataset.fileTab, id: tab.dataset.tabId, kind: tab.dataset.kind, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
      // 从按下起捕获，快速移出标签栏也能收到后续移动；按钮仍保留正常点击。
      (event.target.closest('button') || tab).setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = gesture.current; if (!start || start.pointer !== event.pointerId) return;
      if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      start.moved = true; suppressClick.current = true; event.preventDefault();
      const hit = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      const local = event.currentTarget.contains(hit);
      setDrop(targetAt(event, hit));
      drag?.moved(local ? { type: 'tabs' } : drag.targetAt(event, hit));
      const rect = event.currentTarget.getBoundingClientRect();
      if (local && (event.clientX > rect.right - 24 || event.clientX < rect.left + 24)) event.currentTarget.scrollBy(event.clientX < rect.left + 24 ? -24 : 24, 0);
    }} onPointerUp={event => {
      const start = gesture.current;
      if (start?.pointer !== event.pointerId) return;
      if (start?.moved) {
        const hit = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
        const target = targetAt(event, hit);
        if (target) workbench.moveTab(start.id, target.id, target.after);
        else if (!event.currentTarget.contains(hit) && drag) drag.drop(drag.targetAt(event, hit), start);
      }
      reset();
    }} onPointerCancel={() => { suppressClick.current = false; reset(); }} onLostPointerCapture={reset}>
      {snapshot.tabs.filter(item => !onlyFile || item.path === snapshot.file).map(item => <div key={item.id} data-file-tab={item.path} data-tab-id={item.id} data-kind={item.kind} data-active={snapshot.file === item.path && (snapshot.editorKind || 'file') === item.kind}
        data-preview={item.preview} data-drop={drop?.id === item.id ? drop.after ? 'after' : 'before' : undefined} className="sc-wb-tab"
        onDoubleClick={() => workbench.keepTab(item.path)}
        onContextMenu={event => { event.preventDefault(); workbench.menu({ path: item.path, kind: item.kind, type: 'file', source: 'tab', x: event.clientX, y: event.clientY }); }}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(item); } }}>
        <Button aria-current={snapshot.file === item.path && (snapshot.editorKind || 'file') === item.kind ? 'page' : undefined} title={item.kind === 'markdown' ? `${item.path} · ${t('markdownPreview')}` : item.path} onClick={act(() => workbench.visit({ file: item.path, kind: item.kind }))}>
          <FileIcon path={item.path} /><span className="sc-wb-tab-name">{item.path.split('/').at(-1)}</span>{item.kind === 'markdown' && <small>{t('markdownPreview')}</small>}{item.pinned && <span aria-label={t('filePinned')}><FileIcon pinned /></span>}{item.dirty && <i aria-label={t('unsaved')}>•</i>}
        </Button>
        <Button className="sc-wb-tab-close" title={t('closeFile')} aria-label={message(t, 'tabCloseLabel', { path: item.path })} onClick={event => { event.stopPropagation(); close(item); }}><Icon name="close" /></Button>
      </div>)}
    </nav>
    {snapshot.closingFile && <CloseFile key={snapshot.closingFile} path={snapshot.closingFile} workbench={workbench} snapshot={snapshot} Button={Button} t={t} />}
  </>;
}
