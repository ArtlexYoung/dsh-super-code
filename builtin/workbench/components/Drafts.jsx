import React, { useState, useSyncExternalStore } from 'react';
import { errorText, message } from '../locales.js';
import { keyOf, matchesShortcut } from '../editor/preferences.js';

export function Drafts({ workbench, Button, t }) {
  const { unsaved = [], drafts, saveBatch, preferences } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const [action, setAction] = useState(null), [error, setError] = useState('');
  const run = (name, execute) => {
    setAction(name); setError('');
    void Promise.resolve().then(execute).catch(error => setError(errorText(error, t))).finally(() => setAction(null));
  };
  const busy = !!action || saveBatch?.busy;
  function saveShortcut(event) {
    if (event.nativeEvent.isComposing || !matchesShortcut(event, keyOf(preferences, 'saveAll'))) return;
    event.preventDefault(); event.stopPropagation();
    if (!busy && unsaved.length) run('saveAll', workbench.saveAll);
  }
  return <div className="sc-wb-drafts" aria-busy={busy} onKeyDown={saveShortcut}>
    <header><strong>{message(t, 'draftCount', { count: unsaved.length })}</strong><Button className="sc-wb-primary" disabled={busy || !unsaved.length} onClick={() => run('saveAll', workbench.saveAll)}>{t('saveAll')}</Button></header>
    {error && <p role="alert">{error}</p>}
    {saveBatch && <SaveResult result={saveBatch} workbench={workbench} Button={Button} t={t} />}
    <ul>{unsaved.map(item => <li key={item.path}><Button className="sc-wb-draft-path" title={item.path} onClick={() => run(item.path, () => workbench.visit({ file: item.path }))}>{item.path}</Button>
      {item.review && <small>{t('draftReview')}</small>}<Button disabled={busy} onClick={() => run(item.path, () => workbench.save(item.path))}>{t('save')}</Button></li>)}</ul>
    {!unsaved.length && <p>{t('draftClean')}</p>}
    {drafts && <RecoveryCopies state={drafts} unsaved={unsaved} workbench={workbench} busy={busy} run={run} Button={Button} t={t} />}
  </div>;
}

function SaveResult({ result, workbench, Button, t }) {
  return <section aria-label={t('saveAll')}><p role="status">{message(t, result.busy ? 'draftSaving' : 'draftSaveFinished', { completed: result.completed, total: result.total })}</p>
    {result.failures.map(item => <p key={item.path} role="alert"><code>{item.path}</code> · {item.error}{item.conflict && <Button onClick={() => workbench.panel({ kind: 'saveConflict', path: item.path })}>{t('saveConflict')}</Button>}</p>)}
  </section>;
}

function RecoveryCopies({ state, unsaved, workbench, busy, run, Button, t }) {
  const download = async path => {
    const text = await workbench.draftText(path), url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = path.split('/').at(-1); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const status = state.loading ? 'loading' : state.busy ? 'draftBackingUp' : state.updatedAt ? 'draftBackedUp' : 'draftNoBackup';
  return <section className="sc-wb-draft-backups"><header><strong>{t('draftRecovery')}</strong><Button disabled={busy || state.busy || state.loading} onClick={() => run('retry', workbench.retryDrafts)}>{t('resumeRetry')}</Button></header>
    <p role={state.error ? 'alert' : 'status'}>{state.error || t(status)}</p>
    {state.candidates.some(path => unsaved.some(item => item.path === path)) && <p role="alert">{t('draftPendingCollision')}</p>}
    <ul>{state.candidates.map(path => <RecoveryCopy key={path} path={path} blocked={state.blocked} workbench={workbench} busy={busy} run={run} download={download} Button={Button} t={t} />)}</ul>
    {!state.candidates.length && <p>{t('draftNoCandidate')}</p>}
    <p className="sc-wb-draft-hint">{t('draftStorageHint')}</p>
  </section>;
}

function RecoveryCopy({ path, blocked, workbench, busy, run, download, Button, t }) {
  const [confirm, setConfirm] = useState(false);
  return <li><code className="sc-wb-draft-path">{path}</code><div>
    <Button disabled={busy || blocked} onClick={() => run(path, () => workbench.recoverDraft(path))}>{t('draftRestore')}</Button>
    <Button disabled={busy} onClick={() => run(path, () => download(path))}>{t('draftDownload')}</Button>
    {confirm ? <><Button disabled={busy} onClick={() => { setConfirm(false); run(path, () => workbench.discardDraft(path)); }}>{t('draftDiscardConfirm')}</Button><Button onClick={() => setConfirm(false)}>{t('cancel')}</Button></>
      : <Button disabled={busy || blocked} onClick={() => setConfirm(true)}>{t('draftDiscard')}</Button>}
  </div></li>;
}
