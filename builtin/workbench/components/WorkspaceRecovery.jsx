import React from 'react';
import { Icon } from './Icon.jsx';
import { message } from '../locales.js';

export function EmptyWorkspace({ workbench, snapshot, Button, t }) {
  const candidate = workbench.recovery && snapshot.recovery?.candidate;
  const count = candidate?.panes.reduce((total, pane) => total + pane.tabs.length, 0);
  return <div className="sc-wb-empty sc-wb-start">
    <Icon name="files" /><strong>{t('title')}</strong>
    <span>{t(candidate ? 'resumeHint' : 'empty')}</span>
    {candidate && <Button className="sc-wb-primary" disabled={snapshot.recovery.busy} onClick={() => { void workbench.recovery.restore().catch(workbench.fail); }}>
      <Icon name="back" />{message(t, 'resumeWorkspace', { count })}</Button>}
    <Button onClick={() => workbench.panel({ kind: 'navigate', query: '' })}><Icon name="search" />{t('navigateFiles')}</Button>
    {candidate && <small>{t('resumeMetadata')}</small>}
  </div>;
}

export function RecoveryNotice({ workbench, state, Button, t }) {
  if (!workbench.recovery || !state || !state.busy && !state.error && !state.failures.length) return null;
  return <aside className="sc-wb-recovery-notice" aria-busy={state.busy}>
    {state.busy ? <><span role="status">{t('resumeWorking')}</span><Button onClick={() => workbench.recovery.stop()}>{t('stop')}</Button></> : <>
      {state.error && <p role="alert">{state.error} <Button onClick={() => workbench.recovery.retry()}>{t('resumeRetry')}</Button></p>}
      {!!state.failures.length && <details open><summary>{message(t, 'resumeFailures', { count: state.failures.length })}</summary><ul>{state.failures.map((item, index) => <li key={index}><code>{item.path}</code>：{item.error}</li>)}</ul></details>}
      <Button onClick={() => workbench.recovery.dismiss()}>{t('close')}</Button>
    </>}
  </aside>;
}
