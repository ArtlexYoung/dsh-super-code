import React, { useRef, useState } from 'react';
import { FileIcon } from './FileIcon.jsx';
import { Floating } from './Floating.jsx';
import { errorText, message } from '../locales.js';

function CloseFile({ path, workbench, snapshot, Button, t }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) workbench.cancelCloseFile(); };
  const confirm = mode => async () => {
    setBusy(true); setError('');
    try { await workbench.closeFile(path, mode); }
    catch (failure) { setError(errorText(failure, t)); }
    finally { setBusy(false); }
  };
  return <Floating title={t('closeFile')} close={close} t={t} Button={Button} palette={snapshot.preferences.palette}
    className="sc-wb-close-file" initialSize={{ width: 530, height: 240 }}>
    <p>{message(t, 'tabCloseQuestion', { path })}</p>
    {error && <p role="alert">{error}</p>}
    <footer><Button disabled={busy} onClick={close}>{t('fileCancel')}</Button>
      <Button disabled={busy} onClick={confirm('keep')}>{t('tabKeepAndClose')}</Button>
      <Button className="sc-wb-primary" disabled={busy} onClick={confirm('save')}>{t(busy ? 'working' : 'tabSaveAndClose')}</Button></footer>
  </Floating>;
}

export function Tabs({ snapshot, workbench, Button, t }) {
  const gesture = useRef(null), suppressClick = useRef(false), [drop, setDrop] = useState(null);
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  const close = path => { void workbench.closeFile(path).catch(workbench.fail); };
  const reset = () => { gesture.current = null; setDrop(null); };
  const targetAt = event => {
    const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('[data-file-tab]');
    if (!target || !event.currentTarget.contains(target)) return null;
    const item = snapshot.tabs.find(item => item.path === target.dataset.fileTab), source = snapshot.tabs.find(item => item.path === gesture.current?.path);
    return item && source && item.pinned === source.pinned ? { path: item.path, after: event.clientX > target.getBoundingClientRect().left + target.offsetWidth / 2 } : null;
  };
  return <>
    <nav className="sc-wb-tabs" aria-label={t('files')} onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }} onPointerDown={event => {
      suppressClick.current = false;
      if (event.button === 1) { event.preventDefault(); return; }
      if (event.button !== 0 || event.target.closest('.sc-wb-tab-close')) return;
      const tab = event.target.closest('[data-file-tab]'); if (!tab) return;
      gesture.current = { path: tab.dataset.fileTab, x: event.clientX, y: event.clientY, moved: false };
    }} onPointerMove={event => {
      const start = gesture.current; if (!start) return;
      if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId);
      start.moved = true; suppressClick.current = true; event.preventDefault();
      setDrop(targetAt(event));
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX > rect.right - 24 || event.clientX < rect.left + 24) event.currentTarget.scrollBy(event.clientX < rect.left + 24 ? -24 : 24, 0);
    }} onPointerUp={event => {
      const start = gesture.current;
      if (start?.moved) {
        const target = targetAt(event);
        if (target) workbench.moveTab(start.path, target.path, target.after);
        else if (!event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('.sc-wb-tabs')) workbench.fail(new Error('WORKBENCH_TAB_WINDOW'));
      }
      reset();
    }} onPointerCancel={() => { suppressClick.current = false; reset(); }} onLostPointerCapture={reset}>
      {snapshot.tabs.map(item => <div key={item.path} data-file-tab={item.path} data-active={snapshot.file === item.path}
        data-drop={drop?.path === item.path ? drop.after ? 'after' : 'before' : undefined} className="sc-wb-tab"
        onContextMenu={event => { event.preventDefault(); workbench.menu({ path: item.path, type: 'file', source: 'tab', x: event.clientX, y: event.clientY }); }}
        onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(item.path); } }}>
        <Button aria-current={snapshot.file === item.path ? 'page' : undefined} title={item.path} onClick={act(() => workbench.visit({ file: item.path }))}>
          <FileIcon path={item.path} />{item.path.split('/').at(-1)}{item.pinned && <span aria-label={t('filePinned')}><FileIcon pinned /></span>}{item.dirty && <i aria-label={t('unsaved')}>•</i>}
        </Button>
        <Button className="sc-wb-tab-close" title={t('closeFile')} aria-label={message(t, 'tabCloseLabel', { path: item.path })} onClick={event => { event.stopPropagation(); close(item.path); }}>×</Button>
      </div>)}
    </nav>
    {snapshot.closingFile && <CloseFile key={snapshot.closingFile} path={snapshot.closingFile} workbench={workbench} snapshot={snapshot} Button={Button} t={t} />}
  </>;
}
