import React, { useMemo } from 'react';
import { diffLines } from 'diff';
import { GitDiff } from '../git/Diff.jsx';
import { compareText, MAX_DIFF_LINES } from '../../../src/workbench/git/text-diff.ts';
import { errorText } from '../locales.js';

export function EditReview({ thread, assistant, palette, Button, t }) {
  const proposal = thread.proposal;
  const preview = useMemo(() => {
    const before = proposal.before.replace(/\r\n?/g, '\n'), after = proposal.after.replace(/\r\n?/g, '\n');
    try { return { diff: compareText(thread.file, before, after, diffLines(before, after, { timeout: 500, maxEditLength: MAX_DIFF_LINES })) }; }
    catch (error) { return { error: errorText(error, t) }; }
  }, [thread.file, proposal.before, proposal.after, t]);
  const active = ['pending', 'applied'].includes(proposal.state), outdated = proposal.snapshot.version !== thread.version;
  const notice = !active ? '' : thread.stale ? 'WORKBENCH_SELECTION_CHANGED' : outdated ? 'WORKBENCH_EDIT_RECHECK' : '';
  return <section className="sc-wb-edit-review" aria-label={t('editReview')}>
    <ReviewActions thread={thread} notice={notice} failed={!!preview.error} assistant={assistant} Button={Button} t={t} />
    {notice && <p role="status">{t(notice)}</p>}
    {proposal.state === 'pending' && !notice && thread.note && <p role="status">{thread.note}</p>}
    {preview.error ? <p role="alert">{preview.error}</p> : <div className="sc-wb-edit-diff"><GitDiff diff={preview.diff} palette={palette} Button={Button} t={t} labels={[t('editBefore'), t('editAfter')]} /></div>}
  </section>;
}

function ReviewActions({ thread, notice, failed, assistant, Button, t }) {
  const proposal = thread.proposal, busy = thread.status === 'running', blocked = busy || !!notice || failed;
  const labels = { apply: 'editApply', discard: 'editDiscard', undo: 'editUndo', recheck: 'editRecheck' };
  const actions = { pending: [['apply', blocked, 'sc-wb-primary'], ['discard', busy]], applied: [['undo', blocked]] }[proposal.state] || [];
  if (notice === 'WORKBENCH_EDIT_RECHECK') actions.push(['recheck', busy]);
  return <div className="sc-wb-edit-actions"><strong role="status">{t(`editState_${proposal.state}`)}</strong>
    {actions.map(([action, disabled, className]) => <Button key={action} disabled={disabled} className={className} onClick={() => assistant.review(proposal.id, action)}>{t(labels[action])}</Button>)}
  </div>;
}
