import React, { useEffect, useRef, useState } from 'react';
import { GitDiff } from './Diff.jsx';
import { FileList } from './FileList.jsx';
import { errorText } from '../locales.js';

export function CodeHistory({ workbench, panel, Button, palette, t }) {
  const [history, setHistory] = useState(null), [diff, setDiff] = useState(null), [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(null), version = useRef(null), mounted = useRef(false);
  async function run(entry) {
    active.current?.abort();
    const abort = new AbortController(); active.current = abort; setBusy(true); setError(''); setDiff(null); setSelected(entry);
    if (!entry) { setHistory(null); version.current = null; }
    try {
      let result;
      if (entry) {
        const { oid, parent, before, after } = entry;
        result = await workbench.git({ action: 'lineHistoryDiff', entry: { oid, parent, before, after }, version: version.current }, abort.signal);
      } else {
        const current = await workbench.git({ action: 'status' }, abort.signal);
        abort.signal.throwIfAborted();
        if (!current.state.exists) throw new Error('WORKBENCH_GIT_MISSING');
        version.current = current.state.version;
        result = await workbench.git({ action: 'lineHistory', target: panel.target, text: panel.text, version: version.current }, abort.signal);
      }
      if (!mounted.current || active.current !== abort || abort.signal.aborted) return;
      if (result.kind === 'lineHistory') setHistory(result.history); else if (result.kind === 'diff') setDiff(result.diff);
    } catch (failure) {
      if (mounted.current && active.current === abort) setError(abort.signal.aborted ? t('historyCancelled') : errorText(failure, t));
    } finally { if (active.current === abort) { active.current = null; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => { mounted.current = true; void run(null); return () => { mounted.current = false; active.current?.abort(); }; }, [workbench, panel.id]);
  const rows = history?.entries.map((entry, index) => ({ key: index, entry })) || [];
  return <div className="sc-wb-git sc-wb-code-history" aria-label={t('codeHistory')} aria-busy={busy}>
    <header className="sc-wb-git-toolbar"><div><strong>{panel.target.path}</strong><code>{panel.target.start}–{panel.target.end}</code><small>{rows.length} {t('historyChanges')}</small></div><div>
      {busy && <Button title={t('stop')} onClick={() => active.current?.abort()}>{t('stop')}</Button>}
      <Button title={t('refresh')} onClick={() => { void run(null); }}>{t('refresh')}</Button>
    </div></header>
    {(error || busy) && <div className={`sc-wb-git-notice ${error ? 'sc-wb-error' : ''}`} role={error ? 'alert' : 'status'}>{error || t('historyLoading')}
      {error && <Button title={t('historyRetry')} onClick={() => { void run(selected); }}>{t('historyRetry')}</Button>}</div>}
    {history?.uncommitted && <p className="sc-wb-git-notice">{t('historyUncommitted')}</p>}
    {!!history?.warnings.length && <div className="sc-wb-git-notice" role="status">{t('historyIncomplete')} {history.warnings.map(value => t(`historyWarning_${value}`)).join(' ')}</div>}
    <div className="sc-wb-git-split"><aside className="sc-wb-git-files"><FileList items={rows} rowHeight={76} className="sc-wb-code-history-list">{({ entry }) =>
      <Button title={entry.message} aria-pressed={selected === entry} onClick={() => { void run(entry); }}>
        <span><code>{entry.oid.slice(0, 8)}</code> <strong>{entry.message.split('\n')[0]}</strong></span>
        <small>{entry.author} · {new Date(entry.timestamp * 1000).toLocaleString()}</small>
        <small>{entry.before ? `${entry.before.path}:${entry.before.start}–${entry.before.end}` : t('historyCreated')} · {entry.after.start}–{entry.after.end}{entry.parent && ` · ${entry.parent.slice(0, 8)}`}</small>
      </Button>}</FileList>{history && !rows.length && <p className="sc-wb-git-source-hint">{t('historyEmpty')}</p>}</aside>
      <GitDiff diff={diff} loading={busy && !!selected} palette={palette} t={t} Button={Button}
        labels={selected ? [selected.before ? `${selected.before.path} · ${selected.parent?.slice(0, 8)}` : t('historyCreated'), `${selected.after.path} · ${selected.oid.slice(0, 8)}`] : undefined} />
    </div>
    <footer className="sc-wb-git-source-hint">{t('historyScope')}</footer>
  </div>;
}
