import React, { useEffect, useRef, useState } from 'react';
import { GitDiff } from './Diff.jsx';
import { GitBranches, GitRemotes, GitConfirmation } from './Controls.jsx';
import { errorText } from '../locales.js';

const DISK_ACTIONS = ['checkout', 'pull', 'merge', 'abortMerge'];
export function GitPanel({ workbench, Button, Select, palette, t }) {
  const [state, setState] = useState(null), [sources, setSources] = useState([]), [tab, setTab] = useState('changes');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [diff, setDiff] = useState(null);
  const [source, setSource] = useState('all'), [selected, setSelected] = useState(''), [confirmation, setConfirmation] = useState(null);
  const [summary, setSummary] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState('');
  const [commit, setCommit] = useState(null);
  const active = useRef(null), mounted = useRef(false);

  async function run(input) {
    if (active.current) return;
    if (DISK_ACTIONS.includes(input.action) && [...workbench.documents.values()].some(doc => doc.text !== doc.original)) { setError(t('gitUnsaved')); return; }
    const abort = new AbortController(); active.current = abort; setBusy(true); setError(''); setNotice('');
    try {
      const result = await workbench.git({ ...input, ...(input.action === 'status' || input.action === 'init' ? {} : { version: input.version || state.version }) }, abort.signal);
      if (!mounted.current) return;
      if (result.kind === 'diff') { setDiff(result.diff); setSelected(`${input.side || input.oid}:${input.path}`); }
      else if (result.kind === 'commitFiles') { setCommit(result); setDiff(null); setSelected(''); }
      else {
        setState(result.state); setSources(result.sources || []); setDiff(null); setSelected(''); setCommit(null);
        setName(value => value || result.state.author.name); setEmail(value => value || result.state.author.email);
        if (input.action !== 'status') setNotice(t('gitDone'));
        if (input.action === 'commit') setSummary('');
        if (DISK_ACTIONS.includes(input.action)) await workbench.refresh();
      }
    } catch (failure) { if (mounted.current) setError(abort.signal.aborted ? t('gitCancelled') : errorText(failure, t)); }
    finally { if (active.current === abort) active.current = null; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void run({ action: 'status' }); return () => { mounted.current = false; active.current?.abort(); }; }, [workbench]);
  const canWrite = !!state?.writable && !busy;
  const associated = file => sources.filter(item => item.files.includes(file.path));
  const visible = file => source === 'all' || (source === 'unknown' ? !associated(file).length : associated(file).some(item => item.id === source));
  const confirm = input => setConfirmation({ ...input, ...(state?.exists ? { version: state.version } : {}) });
  const command = input => () => { void run(input); };
  const author = { name, email }, authorValid = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const openFile = () => { const file = diff.path; workbench.panel(null); void workbench.visit({ file }).catch(workbench.fail); };
  const staged = state?.changes.filter(file => file.head !== file.stage && !file.conflict) || [];
  const comparison = (history = false) => <GitDiff diff={diff} palette={palette} t={t} Button={Button}
    labels={history ? undefined : selected.startsWith('staged:') ? [t('gitHead'), t('gitIndex')] : [t(state?.changes.find(file => file.path === diff?.path)?.conflict ? 'gitHead' : 'gitIndex'), t('gitDisk')]}
    open={!history && diff && state?.changes.find(file => file.path === diff.path)?.worktree !== 0 ? openFile : undefined} />;
  const changeTab = value => { setTab(value); setDiff(null); setSelected(''); };

  return <div className="sc-wb-git" aria-label={t('git')} aria-busy={busy}>
    <header className="sc-wb-git-toolbar"><div><span aria-hidden>⑂</span><strong>{state?.branch || (state?.head ? t('gitDetached') : 'Git')}</strong><code>{state?.head?.slice(0, 8)}</code>
      {state && <small className="sc-wb-git-engine">{t(state.backend === 'native' ? 'gitNative' : 'gitBuiltin')}{!state.writable && ` · ${t('gitReadonly')}`}</small>}</div>
      <div>{busy && <Button title={t('stop')} onClick={() => active.current?.abort()}>{t('stop')}</Button>}<Button title={t('refresh')} disabled={busy || !!confirmation} onClick={command({ action: 'status' })}>↻ {t('refresh')}</Button></div></header>
    {state?.exists && <nav className="sc-wb-git-tabs">{['changes', 'history', 'branches', 'remotes'].map(key => <Button key={key} title={t(`git_${key}`)} aria-pressed={tab === key} onClick={() => changeTab(key)}>{t(`git_${key}`)}{key === 'changes' && <small>{state.changes.length}</small>}</Button>)}</nav>}
    {(error || notice || busy) && <div className={`sc-wb-git-notice ${error ? 'sc-wb-error' : ''}`} role={error ? 'alert' : 'status'}>{error || (busy ? t('working') : notice)}</div>}
    {state?.merging && <div className="sc-wb-git-merge"><span>{t('gitMerging')}</span><Button title={t('gitAbortMerge')} disabled={!canWrite} onClick={() => confirm({ action: 'abortMerge' })}>{t('gitAbortMerge')}</Button></div>}
    {state && !state.exists && <div className="sc-wb-git-empty"><strong>{t('gitNoRepository')}</strong><p>{t('gitInitHint')}</p><Button title={t('gitInit')} disabled={!canWrite} onClick={() => confirm({ action: 'init', branch: 'main' })}>{t('gitInit')}</Button></div>}
    {state?.exists && tab === 'changes' && <div className="sc-wb-git-split"><aside className="sc-wb-git-files">
      <div className="sc-wb-git-source"><Select label={t('gitSource')} value={source} choices={[["all", t('gitAll')], ['unknown', t('gitUnknown')], ...sources.map(item => [item.id, `${item.parent ? 'Agent' : t('gitSession')} · ${item.name}`])]} onChange={setSource} /></div>
      <div className="sc-wb-git-file-list">{['worktree', 'staged'].map(side => {
        const files = state.changes.filter(file => visible(file) && (side === 'staged' ? !file.conflict && file.head !== file.stage : file.conflict || file.worktree !== file.stage));
        const action = side === 'staged' ? 'unstage' : 'stage';
        return <section key={side}><h3><span>{t(`git_${side}`)} <small>{files.length}</small></span><Button title={t(side === 'staged' ? 'gitUnstageAll' : 'gitStageAll')} disabled={!canWrite || !files.length} onClick={command({ action, paths: files.map(file => file.path) })}>{side === 'staged' ? '−' : '+'}</Button></h3>
          {files.map(file => <div className="sc-wb-git-file" key={file.path}>
            <Button title={file.path} aria-pressed={selected === `${side}:${file.path}`} disabled={busy} onClick={command({ action: 'diff', path: file.path, side })}>
              <i data-status={file.conflict ? 'U' : (side === 'staged' ? file.stage : file.worktree) === 0 ? 'D' : file.head === 0 ? 'A' : 'M'}>{file.conflict ? '!' : (side === 'staged' ? file.stage : file.worktree) === 0 ? 'D' : file.head === 0 ? 'A' : 'M'}</i>
              <span>{file.path}<small>{file.conflict ? t('gitConflict') : associated(file).map(item => item.name).join(' · ') || t('gitUnknown')}</small></span></Button>
            <Button title={t(side === 'staged' ? 'gitUnstage' : 'gitStage')} disabled={!canWrite} onClick={command({ action, paths: [file.path] })}>{side === 'staged' ? '−' : '+'}</Button>
          </div>)}</section>;
      })}{!state.changes.length && <p className="sc-wb-git-muted">{t('gitClean')}</p>}</div>
      <small className="sc-wb-git-source-hint">{t('gitSourceHint')}{sources.some(item => item.partial) && ` ${t('gitSourcePartial')}`}</small>
      <form className="sc-wb-git-commit" onSubmit={event => { event.preventDefault(); confirm({ action: 'commit', message: summary, author }); }}>
        <textarea aria-label={t('gitCommitMessage')} placeholder={t('gitCommitMessage')} value={summary} onChange={event => setSummary(event.target.value)} disabled={busy} />
        <div className="sc-wb-git-author"><input aria-label={t('gitAuthor')} placeholder={t('gitAuthor')} value={name} onChange={event => setName(event.target.value)} autoComplete="off" disabled={busy} />
          <input type="email" aria-label={t('gitEmail')} placeholder={t('gitEmail')} value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" disabled={busy} /></div>
        <Button title={t(state.merging ? 'gitContinueMerge' : 'gitCommit')} type="submit" className="sc-wb-primary" disabled={!canWrite || !summary.trim() || !authorValid || state.changes.some(file => file.conflict) || !state.merging && !staged.length}>{t(state.merging ? 'gitContinueMerge' : 'gitCommit')} <small>{staged.length}</small></Button>
      </form>
    </aside>{comparison()}</div>}
    {state?.exists && tab === 'history' && <div className="sc-wb-git-history-body"><div className="sc-wb-git-history">{state.history.map(item => <Button key={item.oid} title={item.message} aria-pressed={commit?.oid === item.oid} disabled={busy} onClick={command({ action: 'commitFiles', oid: item.oid })}>
      <code>{item.oid.slice(0, 8)}</code><span><strong>{item.message.split('\n')[0]}</strong><small>{item.author} · {new Date(item.timestamp * 1000).toLocaleString()}</small></span></Button>)}{!state.history.length && <p>{t('gitNoHistory')}</p>}</div>
      {commit && <div className="sc-wb-git-split sc-wb-git-history-diff"><aside className="sc-wb-git-files"><div className="sc-wb-git-file-list">{commit.files.map(path => <Button className="sc-wb-git-history-file" key={path} title={path} disabled={busy} aria-pressed={selected === `${commit.oid}:${path}`} onClick={command({ action: 'historyDiff', oid: commit.oid, path })}>{path}</Button>)}</div></aside>{comparison(true)}</div>}</div>}
    {state?.exists && tab === 'branches' && <GitBranches state={state} canWrite={canWrite} author={author} authorValid={authorValid} setName={setName} setEmail={setEmail} run={run} confirm={confirm} t={t} Button={Button} />}
    {state?.exists && tab === 'remotes' && <GitRemotes state={state} canWrite={canWrite} run={run} confirm={confirm} t={t} Button={Button} Select={Select} />}
    {confirmation && <GitConfirmation input={confirmation} state={state} staged={staged} cancel={() => setConfirmation(null)} accept={() => { const input = confirmation; setConfirmation(null); void run(input); }} t={t} Button={Button} />}
  </div>;
}
