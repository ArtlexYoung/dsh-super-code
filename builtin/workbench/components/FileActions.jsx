import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { message } from '../locales.js';
import { uniqueId } from '../id.js';
import { Icon } from './Icon.jsx';

const menuIcons = { closeFile: 'close', splitRight: 'splitRight', splitDown: 'splitDown', tabWindow: 'window', fileNew: 'newFile', fileNewDirectory: 'folder', fileCopy: 'copy', filePaste: 'paste', filePin: 'pin', fileUnpin: 'unpin', fileCompare: 'diff', fileRelativePath: 'link', fileAbsolutePath: 'link', fileTrash: 'trash' };

function Menu({ target, entries, close, palette, Button, t }) {
  const menu = useRef(null), [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const node = menu.current, previous = document.activeElement, rect = node.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)) });
    node.querySelector('[role=menuitem]:not(:disabled)')?.focus();
    return () => { if (previous?.isConnected && node.contains(document.activeElement)) previous.focus({ preventScroll: true }); };
  }, [target]);
  useEffect(() => {
    const outside = event => { if (!menu.current.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); } };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true); };
  }, [close]);
  return createPortal(<div ref={menu} role="menu" aria-label={t('fileMenu')} className="sc-workbench sc-wb-file-menu" data-palette={palette} style={position}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
      event.stopPropagation();
      const items = [...menu.current.querySelectorAll('[role=menuitem]:not(:disabled)')], at = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === 'Tab') close();
    }}>{entries.map(entry => <Button key={entry.id} role="menuitem" disabled={entry.disabled} className={entry.id === 'fileTrash' ? 'sc-wb-danger' : ''}
      data-action={entry.id} onClick={entry.run}><Icon name={menuIcons[entry.id]} /><span>{t(entry.id)}</span></Button>)}</div>, document.body);
}

export function FileAction({ dialog, workbench, Button, t }) {
  const { name, error, busy } = dialog;
  const update = patch => { if (workbench.snapshot().panel?.id === dialog.id) workbench.panel({ ...workbench.snapshot().panel, ...patch }); };
  const close = () => { if (!busy) workbench.panel(null); };
  const naming = !['trash', 'copyPath'].includes(dialog.action);
  return <form onSubmit={event => { event.preventDefault(); void workbench.submitFileAction().catch(workbench.fail); }}>
    {dialog.action === 'copyPath' ? <input aria-label={t('fileCopyPath')} value={dialog.path} readOnly autoFocus onFocus={event => event.target.select()} />
      : naming ? <><small>{dialog.parent || '.'}</small><label>{t('fileName')}<input aria-label={t('fileName')} value={name} disabled={busy} autoFocus onChange={event => update({ name: event.target.value })} /></label></>
      : <p>{message(t, 'fileTrashConfirm', { path: dialog.path })}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><Button type="button" disabled={busy} onClick={close}>{t('fileCancel')}</Button>
      {dialog.action !== 'copyPath' && <Button type="submit" className="sc-wb-primary" disabled={busy || naming && !name.trim()}>{t(busy ? 'working' : naming ? 'fileConfirm' : 'fileTrash')}</Button>}</footer>
  </form>;
}

export function FileActions({ snapshot, workbench, Button, t, splitTab, detachTab }) {
  const target = snapshot.fileMenu, palette = snapshot.preferences.palette;
  const closeMenu = () => workbench.menu(null);
  const showDialog = (action, values) => workbench.panel({ kind: 'fileAction', id: uniqueId(), action, name: '', error: '', busy: false,
    title: t(({ createFile: 'fileNew', createDirectory: 'fileNewDirectory', copy: 'filePaste', trash: 'fileTrash', copyPath: 'fileCopyPath' })[action]), ...values });
  function show(action) {
    const parent = target.type === 'directory' ? target.path : target.path.split('/').slice(0, -1).join('/');
    const source = snapshot.fileClipboard;
    showDialog(action, { parent, path: target.path, source, name: action === 'copy' ? source.path.split('/').at(-1) : '' }); closeMenu();
  }
  async function copyPath(absolute) {
    const path = absolute ? (await workbench.fileOperation({ action: 'absolutePath', path: target.path })).path : target.path || '.';
    closeMenu();
    try { await navigator.clipboard.writeText(path); }
    catch { showDialog('copyPath', { path, error: t('fileClipboardManual') }); }
  }
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  const pinned = target && snapshot.tabs.some(tab => tab.path === target.path && tab.pinned);
  const entries = target ? [
    ...(target.source === 'tab' ? [{ id: 'closeFile', run: act(async () => { closeMenu(); await workbench.closeFile(target.path, 'check', target.kind); }) }] : []),
    ...(target.source === 'tab' && splitTab ? [
      { id: 'splitRight', run: () => { closeMenu(); splitTab(target, 'right'); } },
      { id: 'splitDown', run: () => { closeMenu(); splitTab(target, 'down'); } },
    ] : []),
    ...(target.source === 'tab' && detachTab ? [{ id: 'tabWindow', run: () => { closeMenu(); detachTab(target); } }] : []),
    { id: 'fileNew', run: () => show('createFile') }, { id: 'fileNewDirectory', run: () => show('createDirectory') },
    { id: 'fileCopy', disabled: !target.path, run: () => { workbench.copyFile(target); closeMenu(); } },
    { id: 'filePaste', disabled: !snapshot.fileClipboard, run: () => show('copy') },
    { id: pinned ? 'fileUnpin' : 'filePin', disabled: target.type !== 'file', run: act(async () => { closeMenu(); await workbench.pinFile(target.path); }) },
    { id: 'fileCompare', disabled: target.type !== 'file', run: () => { workbench.panel({ kind: 'fileCompare', path: target.path, title: t('fileCompare') }); closeMenu(); } },
    { id: 'fileRelativePath', run: act(() => copyPath(false)) }, { id: 'fileAbsolutePath', run: act(() => copyPath(true)) },
    { id: 'fileTrash', disabled: !target.path, run: () => show('trash') },
  ] : [];
  return target && <Menu target={target} entries={entries} close={closeMenu} palette={palette} Button={Button} t={t} />;
}
