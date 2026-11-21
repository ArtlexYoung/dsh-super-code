import React, { useEffect, useRef, useState } from 'react';
import { ConflictEditor } from '../git/Conflict.jsx';
import { usePanelState } from './panel-state.js';
import { errorText } from '../locales.js';

function RecoveryColumns({ recovery, update, busy, Button, t, palette }) {
  const { entry } = recovery;
  return <div className="sc-wb-conflict-columns">{[
    ['draft', entry.draft, 'conflictDraft'], ['result', recovery.text, 'conflictResult'], ['disk', entry.disk.text, 'conflictDisk'],
  ].map(([side, text, label]) => <section key={side}><header><span>{t(label)}</span>{side !== 'result' && <Button disabled={busy} onClick={() => update(text)}>{t(side === 'draft' ? 'conflictUseDraft' : 'conflictUseDisk')}</Button>}</header>
    <ConflictEditor path={entry.path} text={text} change={side === 'result' ? update : undefined} disabled={busy} label={t(label)} palette={palette} base={entry.base} wrap />
  </section>)}</div>;
}

export function SaveConflict({ panel, workbench, Button, t, palette }) {
  const [recovery, setRecovery] = usePanelState(workbench, 'saveRecovery', null);
  const [error, setError] = useState(''), [confirmReload, setConfirmReload] = useState(false), request = useRef(null);
  const entry = recovery?.entry, busy = panel.busy;
  const update = text => setRecovery({ ...recovery, text, reviewed: true });
  const setBusy = value => {
    const current = workbench.snapshot().panel;
    if (current?.id === panel.id) workbench.panel({ ...current, busy: value });
  };
  async function load() {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setBusy(true); setError(''); setConfirmReload(false);
    try {
      const next = await workbench.readSaveConflict(panel.path, abort.signal);
      if (!abort.signal.aborted) setRecovery(previous => previous?.text === recovery?.text && previous?.entry?.disk.version === entry?.disk.version
        ? { entry: next, text: next.merged ?? next.draft, reviewed: next.merged !== null } : previous);
    } catch (failure) { if (!abort.signal.aborted) setError(errorText(failure, t)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  useEffect(() => { if (!entry) void load(); return () => request.current?.abort(); }, [panel.id]);
  async function apply() {
    setBusy(true); setError('');
    try {
      await workbench.applySaveConflict(entry, recovery.text);
      if (workbench.snapshot().panel?.state?.saveRecovery?.text !== recovery.text) { setError(t('conflictResultChanged')); return; }
      await workbench.visit({ file: entry.path });
      if (workbench.snapshot().panel?.id === panel.id) workbench.panel(null);
    } catch (failure) { setError(errorText(failure, t)); }
    finally { setBusy(false); }
  }
  return <section className="sc-wb-conflict sc-wb-save-conflict" aria-label={t('saveConflict')} aria-busy={!!busy}>
    <header><strong>{t('conflictHint')}</strong><Button disabled={busy} onClick={() => entry ? setConfirmReload(true) : void load()}>{t('conflictReload')}</Button></header>
    {confirmReload && <div className="sc-wb-conflict-actions"><span>{t('conflictReloadConfirm')}</span><Button onClick={() => setConfirmReload(false)}>{t('fileCancel')}</Button><Button onClick={() => { void load(); }}>{t('conflictReload')}</Button></div>}
    {error && <p role="alert" className="sc-wb-error">{error}</p>}
    {!entry ? <p role="status">{t(busy ? 'loading' : 'conflictReload')}</p> : <>
      <p className="sc-wb-conflict-summary" role="status">{t(entry.merged === null ? 'conflictManual' : 'conflictMerged')}</p>
      <details className="sc-wb-conflict-base"><summary>{t('conflictBase')}</summary><pre>{entry.base}</pre></details>
      <RecoveryColumns recovery={recovery} update={update} busy={busy} Button={Button} t={t} palette={palette} />
      <footer><small>{t('conflictApplyHint')}</small><nav><Button disabled={busy} onClick={() => workbench.panel(null)}>{t('fileCancel')}</Button><Button className="sc-wb-primary" disabled={busy || !recovery.reviewed} onClick={() => { void apply(); }}>{t(busy ? 'working' : 'conflictApply')}</Button></nav></footer>
    </>}
  </section>;
}
