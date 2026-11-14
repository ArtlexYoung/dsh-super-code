import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Floating } from './Floating.jsx';
import { errorText, message } from '../locales.js';

function Menu({ target, entries, close, palette, Button, t }) {
  const menu = useRef(null), [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const rect = menu.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)) });
    menu.current.querySelector('[role=menuitem]:not(:disabled)')?.focus();
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
      onClick={entry.run}>{t(entry.id)}</Button>)}</div>, document.body);
}

function FileActionForm({ state: { dialog, name, error, busy }, actions, Button, t }) {
  const naming = !['trash', 'copyPath'].includes(dialog.action);
  return <form onSubmit={actions.submit}>
    {dialog.action === 'copyPath' ? <input aria-label={t('fileCopyPath')} value={dialog.path} readOnly autoFocus onFocus={event => event.target.select()} />
      : naming ? <><small>{dialog.parent || '.'}</small><label>{t('fileName')}<input aria-label={t('fileName')} value={name} disabled={busy} autoFocus onChange={event => actions.name(event.target.value)} /></label></>
      : <p>{message(t, 'fileTrashConfirm', { path: dialog.path })}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><Button type="button" disabled={busy} onClick={actions.close}>{t('fileCancel')}</Button>
      {dialog.action !== 'copyPath' && <Button type="submit" className="sc-wb-primary" disabled={busy || naming && !name.trim()}>{t(busy ? 'working' : naming ? 'fileConfirm' : 'fileTrash')}</Button>}</footer>
  </form>;
}

export function FileActions({ snapshot, workbench, Button, t }) {
  const [dialog, setDialog] = useState(null), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const target = snapshot.fileMenu, palette = snapshot.preferences.palette;
  const closeMenu = () => workbench.menu(null);
  const close = () => { if (!busy) { setDialog(null); setError(''); } };
  function show(action) {
    const parent = target.type === 'directory' ? target.path : target.path.split('/').slice(0, -1).join('/');
    const source = snapshot.fileClipboard;
    setName(action === 'copy' ? source.path.split('/').at(-1) : '');
    setError(''); setDialog({ action, parent, path: target.path, source }); closeMenu();
  }
  async function copyPath(absolute) {
    const path = absolute ? (await workbench.fileOperation({ action: 'absolutePath', path: target.path })).path : target.path || '.';
    closeMenu();
    try { await navigator.clipboard.writeText(path); }
    catch { setDialog({ action: 'copyPath', path }); setError(t('fileClipboardManual')); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const path = dialog.action === 'trash' ? dialog.path : [dialog.parent, name].filter(Boolean).join('/');
      if (dialog.action !== 'trash' && (!name.trim() || /[/\\\0]/.test(name) || ['.', '..'].includes(name))) throw new Error('WORKBENCH_FILE_NAME');
      const input = dialog.action === 'copy' ? { action: 'copy', path: dialog.source.path, destination: path } : { action: dialog.action, path };
      const result = await workbench.fileOperation(input);
      if (dialog.action === 'createFile') await workbench.visit({ file: result.path });
      setDialog(null);
    } catch (failure) { setError(errorText(failure, t)); }
    finally { setBusy(false); }
  }
  const act = callback => () => { Promise.resolve().then(callback).catch(workbench.fail); };
  const pinned = target && snapshot.tabs.some(tab => tab.path === target.path && tab.pinned);
  const entries = target ? [
    ...(target.source === 'tab' ? [{ id: 'closeFile', run: act(async () => { closeMenu(); await workbench.closeFile(target.path); }) }] : []),
    { id: 'fileNew', run: () => show('createFile') }, { id: 'fileNewDirectory', run: () => show('createDirectory') },
    { id: 'fileCopy', disabled: !target.path, run: () => { workbench.copyFile(target); closeMenu(); } },
    { id: 'filePaste', disabled: !snapshot.fileClipboard, run: () => show('copy') },
    { id: pinned ? 'fileUnpin' : 'filePin', disabled: target.type !== 'file', run: act(async () => { closeMenu(); await workbench.pinFile(target.path); }) },
    { id: 'fileRelativePath', run: act(() => copyPath(false)) }, { id: 'fileAbsolutePath', run: act(() => copyPath(true)) },
    { id: 'fileTrash', disabled: !target.path, run: () => show('trash') },
  ] : [];
  return <>
    {target && <Menu target={target} entries={entries} close={closeMenu} palette={palette} Button={Button} t={t} />}
    {dialog && <Floating title={t(({ createFile: 'fileNew', createDirectory: 'fileNewDirectory', copy: 'filePaste', trash: 'fileTrash', copyPath: 'fileCopyPath' })[dialog.action])}
      close={close} t={t} Button={Button} palette={palette} className="sc-wb-file-dialog" initialSize={{ width: 470, height: 260 }}>
      <FileActionForm state={{ dialog, name, error, busy }} actions={{ submit, close, name: setName }} Button={Button} t={t} />
    </Floating>}
  </>;
}
