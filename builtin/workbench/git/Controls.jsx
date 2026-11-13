import React, { useEffect, useState } from 'react';
import { message } from '../locales.js';

export function GitBranches({ state, canWrite, author, authorValid, setName, setEmail, run, confirm, t, Button }) {
  const [branch, setBranch] = useState('');
  return <div className="sc-wb-git-form"><form className="sc-wb-git-create-branch" onSubmit={event => { event.preventDefault(); void run({ action: 'branch', branch }); }}>
    <label>{t('gitBranchName')}<input value={branch} onChange={event => setBranch(event.target.value)} /></label>
    <Button type="submit" title={t('gitCreateBranch')} disabled={!canWrite || !branch.trim() || !state.head}>{t('gitCreateBranch')}</Button></form>
    {[['local', state.branches], ['remote', state.remoteBranches]].map(([kind, branches]) => <section key={kind}>{kind === 'remote' && !!branches.length && <h3>{t('gitRemoteBranches')}</h3>}{branches.map(value => <div className="sc-wb-git-branch" key={value}>
      <span><i aria-hidden>⑂</i>{value}{value === state.branch && <small>{t('gitCurrent')}</small>}</span><div>
        {kind === 'local' && <Button title={t('gitCheckout')} disabled={!canWrite || state.merging || value === state.branch} onClick={() => confirm({ action: 'checkout', branch: value })}>{t('gitCheckout')}</Button>}
        <Button title={t('gitMerge')} disabled={!canWrite || !state.branch || state.merging || !authorValid || value === state.branch} onClick={() => confirm({ action: 'merge', branch: value, author })}>{t('gitMerge')}</Button>
        {kind === 'local' && <Button title={t('gitDeleteBranch')} disabled={!canWrite || state.merging || value === state.branch} onClick={() => confirm({ action: 'deleteBranch', branch: value })}>{t('remove')}</Button>}
      </div></div>)}</section>)}
    <div className="sc-wb-git-author"><input aria-label={t('gitAuthor')} placeholder={t('gitAuthor')} value={author.name} onChange={event => setName(event.target.value)} /><input type="email" aria-label={t('gitEmail')} placeholder={t('gitEmail')} value={author.email} onChange={event => setEmail(event.target.value)} /></div>
  </div>;
}

export function GitRemotes({ state, canWrite, run, confirm, t, Button, Select }) {
  const [remote, setRemote] = useState('origin'), [url, setUrl] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const selected = state.remotes.find(item => item.remote === remote);
  useEffect(() => { setUrl(selected?.url || ''); }, [remote, state.remotes]);
  const auth = password || username ? { username, password } : undefined;
  return <div className="sc-wb-git-form">
    {!!state.remotes.length && <Select label={t('gitRemote')} value={remote} choices={state.remotes.map(item => [item.remote, item.remote])} onChange={setRemote} />}
    <label>{t('gitRemoteName')}<input value={remote} onChange={event => setRemote(event.target.value)} disabled={!canWrite} /></label>
    <label>{t('gitRemoteUrl')}<input value={url} onChange={event => setUrl(event.target.value)} placeholder={state.backend === 'native' ? 'HTTPS / SSH' : 'HTTPS'} autoComplete="off" disabled={!canWrite} /></label>
    <Button title={t('gitSaveRemote')} disabled={!canWrite || !url} onClick={() => confirm({ action: 'remote', remote, url })}>{t('gitSaveRemote')}</Button>
    <div className="sc-wb-git-divider" />
    <label>{t('gitUsername')}<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" disabled={!canWrite} /></label>
    <label>{t('gitToken')}<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" disabled={!canWrite} /></label>
    <small className="sc-wb-git-muted">{t('gitCredentialHint')}</small>
    <div className="sc-wb-git-actions">{['fetch', 'pull', 'push'].map(action => <Button key={action} title={t(`git_${action}`)} disabled={!canWrite || !selected?.url || action !== 'fetch' && !state.branch} onClick={() => action === 'fetch' ? void run({ action, remote, auth }) : confirm({ action, remote, auth })}>{t(`git_${action}`)}</Button>)}</div>
  </div>;
}

export function GitConfirmation({ input, state, staged, cancel, accept, t, Button }) {
  const remote = state?.remotes.find(item => item.remote === input.remote);
  return <div className="sc-wb-git-confirm-backdrop"><div className="sc-wb-git-confirm" role="alertdialog" aria-modal="true" aria-label={t('gitConfirm')}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      if (event.key === 'Tab') {
        const buttons = event.currentTarget.querySelectorAll('button'), first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <strong>{t('gitConfirm')}</strong><p>{message(t, 'gitConfirmAction', { action: t(`gitAction_${input.action}`), target: input.branch || input.remote || state?.branch || 'main' })}</p>
    {['pull', 'push'].includes(input.action) && <p><code>{state.branch}</code><br /><span>{remote?.url}</span></p>}
    {input.action === 'remote' && <p>{input.url}</p>}
    {input.action === 'merge' && <p><code>{input.branch}</code> → <code>{state.branch}</code></p>}
    {input.action === 'commit' && <><pre>{input.message}</pre><ul>{staged.map(file => <li key={file.path}>{file.path}</li>)}</ul></>}
    <div><Button title={t('gitCancel')} autoFocus onClick={cancel}>{t('gitCancel')}</Button><Button title={t('gitConfirm')} className="sc-wb-primary" onClick={accept}>{t('gitConfirm')}</Button></div>
  </div></div>;
}
