import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GitDiff } from './Diff.jsx';
import { GitBranches, GitRemotes, GitConfirmation } from './Controls.jsx';
import { errorText } from '../locales.js';
import { FileList } from './FileList.jsx';
import { usePanelState } from '../components/panel-state.js';
import { Conflict } from './Conflict.jsx';
import { uniqueId } from '../id.js';
import { Icon } from '../components/Icon.jsx';
import { FileIcon } from '../components/FileIcon.jsx';

const DISK_ACTIONS = ['checkout', 'pull', 'merge', 'abortMerge'];
export function GitPanel({ workbench, Button, Select, palette, t }) {
  const snapshot = useSyncExternalStore(workbench.changes.subscribe, workbench.changes.snapshot), { state, sources } = snapshot;
  const [tab, setTab] = usePanelState(workbench, 'gitTab', 'changes');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState('');
  const [diff, setDiff] = usePanelState(workbench, 'gitDiff', null), [selected, setSelected] = usePanelState(workbench, 'gitSelected', '');
  const [conflict, setConflict] = usePanelState(workbench, 'gitConflictPath', '');
  const [source, setSource] = usePanelState(workbench, 'gitSource', 'all'), [confirmation, setConfirmation] = useState(null);
  const [summary, setSummary] = usePanelState(workbench, 'gitSummary', ''), [name, setName] = usePanelState(workbench, 'gitName', state?.author.name || ''), [email, setEmail] = usePanelState(workbench, 'gitEmail', state?.author.email || '');
  const [commit, setCommit] = usePanelState(workbench, 'gitCommit', null);
  const [read, setRead] = usePanelState(workbench, 'gitRead', null);
  const active = useRef(null), mounted = useRef(false);

  async function run(input) {
    const reading = ['diff', 'commitFiles', 'historyDiff'].includes(input.action);
    const selection = input.action === 'commitFiles' ? `commit:${input.oid}` : `${input.side || input.oid}:${input.path}`;
    const id = uniqueId();
    const currentRead = () => { const state = workbench.snapshot().panel?.state; return state?.gitRead === id && (!reading || state.gitSelected === selection); };
    if (active.current) { if (!reading || !active.current.reading) return; active.current.abort(); }
    const abort = new AbortController(); abort.reading = reading; active.current = abort; setBusy(true); setError(null); setNotice('');
    setRead(id);
    if (reading) { setSelected(selection); if (input.action !== 'commitFiles') setDiff(null); }
    try {
      const version = input.version || state?.version;
      const result = await workbench.git({ ...input, ...(input.action === 'status' || input.action === 'init' ? {} : { version }) }, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      if (input.action === 'commit') setSummary(previous => previous === input.message ? '' : previous);
      if (DISK_ACTIONS.includes(input.action)) await workbench.refresh();
      if (!currentRead()) return;
      if (result.kind === 'diff') { setDiff({ ...result.diff, version, side: input.side }); setConflict(''); }
      else if (result.kind === 'commitFiles') { setCommit(result); setDiff(null); setSelected(''); }
      else if (input.action === 'restoreHunk' && result.state.changes.some(file => file.path === input.path)) {
        const next = await workbench.git({ action: 'diff', path: input.path, side: input.side, version: result.state.version }, abort.signal);
        if (!abort.signal.aborted && currentRead()) setDiff({ ...next.diff, side: input.side, version: result.state.version });
      }
      else {
        setDiff(null); setSelected(''); setCommit(null);
        if (input.action !== 'status') setNotice(t('gitDone'));
      }
    } catch (failure) { if (mounted.current && active.current === abort && (!reading || currentRead())) setError({ read: reading ? id : null, text: abort.signal.aborted ? t('gitCancelled') : errorText(failure, t) }); }
    finally { if (active.current === abort) { active.current = null; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => {
    mounted.current = true;
    void workbench.changes.refresh();
    return () => { mounted.current = false; active.current?.abort(); };
  }, [workbench]);
  useEffect(() => {
    if (source !== 'all' && source !== 'unknown' && !sources.some(item => item.id === source)) setSource('all');
  }, [source, sources]);
  const failure = (error?.read && error.read !== read ? '' : error?.text) || snapshot.error;
  const canWrite = !!state?.writable && !busy;
  const sourcesByFile = useMemo(() => {
    const result = new Map();
    for (const source of sources) for (const path of source.files) {
      if (!result.has(path)) result.set(path, []);
      result.get(path).push(source);
    }
    return result;
  }, [sources]);
  const associated = file => sourcesByFile.get(file.path) || [];
  const visible = file => source === 'all' || (source === 'unknown' ? !associated(file).length : associated(file).some(item => item.id === source));
  const confirm = input => setConfirmation({ ...input, ...(state?.exists ? { version: state.version } : {}) });
  const command = input => () => { void run(input); };
  const author = { name, email }, authorValid = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const openFile = () => { const file = diff.path; workbench.panel(null); void workbench.visit({ file }).catch(workbench.fail); };
  const staged = useMemo(() => state?.changes.filter(file => file.head !== file.stage && !file.conflict) || [], [state?.changes]);
  const rows = useMemo(() => ['worktree', 'staged'].flatMap(side => {
    const files = state?.changes.filter(file => visible(file) && (side === 'staged' ? !file.conflict && file.head !== file.stage : file.conflict || file.worktree !== file.stage)) || [];
    return [{ key: side, side, files }, ...files.map(file => ({ key: `${side}:${file.path}`, side, file }))];
  }), [state?.changes, source, sourcesByFile]);
  const commitFiles = useMemo(() => commit?.files.map(path => ({ key: path, path })) || [], [commit]);
  const comparison = (history = false) => <GitDiff diff={diff} loading={busy && !!selected} palette={palette} t={t} Button={Button}
    labels={history ? undefined : selected.startsWith('staged:') ? [t('gitHead'), t('gitIndex')] : [t(state?.changes.find(file => file.path === diff?.path)?.conflict ? 'gitHead' : 'gitIndex'), t('gitDisk')]}
    restore={!history && diff?.side && !state?.changes.find(file => file.path === diff.path)?.conflict ? hunk => { void run({ action: 'restoreHunk', path: diff.path, side: diff.side, hunk, version: diff.version }); } : undefined}
    restoring={!canWrite || diff?.version !== state?.version}
    open={!history && diff && state?.changes.find(file => file.path === diff.path)?.worktree !== 0 ? openFile : undefined} />;
  const changeTab = value => { if (active.current?.reading) active.current.abort(); setRead(null); setTab(value); setDiff(null); setSelected(''); setConflict(''); };

  return <div className="sc-wb-git" aria-label={t('git')} aria-busy={busy} onClickCapture={event => event.target.closest('button')?.focus({ preventScroll: true })}>
    <header className="sc-wb-git-toolbar"><div><Icon name="git" /><strong>{state?.branch || (state?.head ? t('gitDetached') : 'Git')}</strong><code>{state?.head?.slice(0, 8)}</code>
      {state && <small className="sc-wb-git-engine">{t(state.backend === 'native' ? 'gitNative' : 'gitBuiltin')}{!state.writable && ` · ${t('gitReadonly')}`}</small>}</div>
      <div>{busy && <Button title={t('stop')} onClick={() => active.current?.abort()}><Icon name="stop" />{t('stop')}</Button>}<Button title={t('refresh')} disabled={busy || !!confirmation} onClick={command({ action: 'status' })}><Icon name="refresh" />{t('refresh')}</Button></div></header>
    {state?.exists && <nav className="sc-wb-git-tabs">{['changes', 'history', 'branches', 'remotes'].map(key => <Button key={key} title={t(`git_${key}`)} aria-pressed={tab === key} onClick={() => changeTab(key)}>{t(`git_${key}`)}{key === 'changes' && <small>{state.changes.length}</small>}</Button>)}</nav>}
    {(failure || notice || busy) && <div className={`sc-wb-git-notice ${failure ? 'sc-wb-error' : ''}`} role={failure ? 'alert' : 'status'}>{failure || (busy ? t('working') : notice)}</div>}
    {state?.merging && <div className="sc-wb-git-merge"><span>{t('gitMerging')}</span><Button title={t('gitAbortMerge')} disabled={!canWrite} onClick={() => confirm({ action: 'abortMerge' })}>{t('gitAbortMerge')}</Button></div>}
    {state && !state.exists && <div className="sc-wb-git-empty"><strong>{t('gitNoRepository')}</strong><p>{t('gitInitHint')}</p><Button title={t('gitInit')} disabled={!canWrite} onClick={() => confirm({ action: 'init', branch: 'main' })}>{t('gitInit')}</Button></div>}
    {state?.exists && tab === 'changes' && <div className="sc-wb-git-split"><aside className="sc-wb-git-files">
      <div className="sc-wb-git-source"><Select label={t('gitSource')} value={source} choices={[["all", t('gitAll')], ['unknown', t('gitUnknown')], ...sources.map(item => [item.id, `${item.parent ? 'Agent' : t('gitSession')} · ${item.name}`])]} onChange={setSource} /></div>
      <FileList items={rows} rowHeight={48}>{({ side, files, file }) => {
        const action = side === 'staged' ? 'unstage' : 'stage';
        if (files) return <h3><span>{t(`git_${side}`)} <small>{files.length}</small></span><Button title={t(side === 'staged' ? 'gitUnstageAll' : 'gitStageAll')} aria-label={t(side === 'staged' ? 'gitUnstageAll' : 'gitStageAll')} disabled={!canWrite || !files.length} onClick={command({ action, paths: files.map(file => file.path) })}><Icon name={side === 'staged' ? 'minus' : 'plus'} /></Button></h3>;
        return <div className="sc-wb-git-file">
            <Button title={file.path} aria-pressed={file.conflict ? conflict === file.path : selected === `${side}:${file.path}`} disabled={busy && !active.current?.reading} onClick={file.conflict ? () => { active.current?.abort(); setRead(null); setConflict(file.path); setDiff(null); setSelected(''); } : command({ action: 'diff', path: file.path, side })}>
              <FileIcon path={file.path} />
              <span><span>{file.path}</span><small>{file.conflict ? t('gitConflict') : associated(file).map(item => item.name).join(' · ') || t('gitUnknown')}</small></span></Button>
            <i data-status={file.conflict ? 'U' : (side === 'staged' ? file.stage : file.worktree) === 0 ? 'D' : file.head === 0 ? 'A' : 'M'}>{file.conflict ? '!' : (side === 'staged' ? file.stage : file.worktree) === 0 ? 'D' : file.head === 0 ? 'A' : 'M'}</i>
            <Button title={t(side === 'staged' ? 'gitUnstage' : 'gitStage')} aria-label={t(side === 'staged' ? 'gitUnstage' : 'gitStage')} disabled={!canWrite} onClick={command({ action, paths: [file.path] })}><Icon name={side === 'staged' ? 'minus' : 'plus'} /></Button>
          </div>;
      }}</FileList>
      {!state.changes.length && <p className="sc-wb-git-source-hint">{t('gitClean')}</p>}
      <small className="sc-wb-git-source-hint">{t('gitSourceHint')}{sources.some(item => item.partial) && ` ${t('gitSourcePartial')}`}</small>
      <form className="sc-wb-git-commit" onSubmit={event => { event.preventDefault(); confirm({ action: 'commit', message: summary, author }); }}>
        <textarea aria-label={t('gitCommitMessage')} placeholder={t('gitCommitMessage')} value={summary} onChange={event => setSummary(event.target.value)} disabled={busy} />
        <div className="sc-wb-git-author"><input aria-label={t('gitAuthor')} placeholder={t('gitAuthor')} value={name} onChange={event => setName(event.target.value)} autoComplete="off" disabled={busy} />
          <input type="email" aria-label={t('gitEmail')} placeholder={t('gitEmail')} value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" disabled={busy} /></div>
        <Button title={t(state.merging ? 'gitContinueMerge' : 'gitCommit')} type="submit" className="sc-wb-primary" disabled={!canWrite || !summary.trim() || !authorValid || state.changes.some(file => file.conflict) || !state.merging && !staged.length}>{t(state.merging ? 'gitContinueMerge' : 'gitCommit')} <small>{staged.length}</small></Button>
      </form>
    </aside>{conflict ? <Conflict workbench={workbench} path={conflict} Button={Button} t={t} palette={palette} close={() => setConflict('')} /> : comparison()}</div>}
    {state?.exists && tab === 'history' && <div className="sc-wb-git-history-body"><div className="sc-wb-git-history">{state.history.map(item => <Button key={item.oid} title={item.message} aria-pressed={commit?.oid === item.oid} disabled={busy && !active.current?.reading} onClick={command({ action: 'commitFiles', oid: item.oid })}>
      <code>{item.oid.slice(0, 8)}</code><span><strong>{item.message.split('\n')[0]}</strong><small>{item.author} · {new Date(item.timestamp * 1000).toLocaleString()}</small></span></Button>)}{!state.history.length && <p>{t('gitNoHistory')}</p>}</div>
      {commit && <div className="sc-wb-git-split sc-wb-git-history-diff"><aside className="sc-wb-git-files"><FileList items={commitFiles} rowHeight={30}>{({ path }) => <Button className="sc-wb-git-history-file" title={path} disabled={busy && !active.current?.reading} aria-pressed={selected === `${commit.oid}:${path}`} onClick={command({ action: 'historyDiff', oid: commit.oid, path })}>{path}</Button>}</FileList></aside>{comparison(true)}</div>}</div>}
    {state?.exists && tab === 'branches' && <GitBranches workbench={workbench} state={state} canWrite={canWrite} author={author} authorValid={authorValid} setName={setName} setEmail={setEmail} run={run} confirm={confirm} t={t} Button={Button} />}
    {state?.exists && tab === 'remotes' && <GitRemotes workbench={workbench} state={state} canWrite={canWrite} run={run} confirm={confirm} t={t} Button={Button} Select={Select} />}
    {confirmation && <GitConfirmation input={confirmation} state={state} staged={staged} cancel={() => setConfirmation(null)} accept={() => { const input = confirmation; setConfirmation(null); void run(input); }} t={t} Button={Button} />}
  </div>;
}
