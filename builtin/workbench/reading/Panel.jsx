import React, { useMemo, useSyncExternalStore } from 'react';
import { message } from '../locales.js';
import stylesheet from './style.css';

function Sources({ refs, reading, Button }) {
  return <div className="sc-reading-sources">{refs.map((ref, i) => <Button key={`${ref.file}:${ref.fromLine}:${i}`}
    title={`${ref.file}:${ref.fromLine}–${ref.toLine}`} onClick={() => { void reading.open(ref); }}>
    <span>{ref.file.split('/').at(-1)}</span><small>{ref.fromLine === ref.toLine ? ref.fromLine : `${ref.fromLine}–${ref.toLine}`}</small>
  </Button>)}</div>;
}

function ReadingPath({ state, reading, Button, t, busy }) {
  if (!state.plan) return null;
  return <><div className="sc-reading-plan"><h2>{state.plan.title}</h2><p>{state.plan.summary}</p>
    <ol>{state.plan.steps.map((step, i) => <li key={i}><Button title={step.reason} aria-current={state.active === i ? 'step' : undefined} disabled={busy}
      onClick={() => { void reading.step(i); }}><span className="sc-reading-number">{i + 1}</span><span>{step.title}</span></Button></li>)}</ol>
  </div>{state.active >= 0 && <div className="sc-reading-step"><div><span>{message(t, 'readingStep', { current: state.active + 1, total: state.plan.steps.length })}</span>
    <nav><Button title={t('readingPrevious')} disabled={busy || state.active === 0} onClick={() => { void reading.step(state.active - 1); }}>‹</Button>
      <Button title={t('readingNext')} disabled={busy || state.active + 1 >= state.plan.steps.length} onClick={() => { void reading.step(state.active + 1); }}>›</Button></nav></div>
    <p>{state.plan.steps[state.active].reason}</p></div>}</>;
}

function ReadingNotice({ state, reading, Button, t, busy }) {
  if (!state.stale && !state.error && state.status !== 'stopped') return null;
  const text = state.stale ? t('readingStale') : state.error || t('readingStopped');
  return <div className="sc-reading-notice" role="status"><span>{text}</span>
    {!busy && state.target && <Button title={t('readingRegenerate')} onClick={() => { void reading.retry(); }}>{t('readingRegenerate')}</Button>}
  </div>;
}

export function ReadingPanel({ workbench, file, Button, MarkdownText, t }) {
  const reading = workbench.reading, state = useSyncExternalStore(reading.subscribe, reading.snapshot), busy = state.status === 'running';
  const labels = useMemo(() => ({ code: { copyLabel: t('readingCopy'), copiedLabel: t('readingCopied') }, footnotes: t('readingFootnotes') }), [t]);
  return <aside className="sc-reading-panel" aria-label={t('readingTitle')}><style>{stylesheet}</style>
    <form className="sc-reading-goal" onSubmit={event => { event.preventDefault(); void reading.plan(); }}>
      <label htmlFor="sc-reading-goal">{t('readingGoal')}</label>
      <textarea id="sc-reading-goal" value={state.goal} placeholder={t('readingGoalPlaceholder')} maxLength={4000}
        onChange={event => reading.goal(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void reading.plan(); } }} />
      <div><Button type="button" title={t('readingFile')} disabled={!file || busy} onClick={() => { void reading.file(); }}>{t('readingFile')}</Button>
        {busy ? <Button type="button" onClick={event => { event.preventDefault(); reading.stop(); }} title={t('stop')}>{t('stop')}</Button>
          : <Button type="submit" className="sc-wb-primary" disabled={!state.goal.trim()} title={t('readingStart')}>{t('readingStart')}</Button>}</div>
    </form>
    <div className="sc-reading-content" aria-busy={busy}>
      <ReadingPath state={state} reading={reading} Button={Button} t={t} busy={busy} />
      <ReadingNotice state={state} reading={reading} Button={Button} t={t} busy={busy} />
      {state.sections.map((section, i) => <article key={`${state.target?.file}:${i}`} className="sc-reading-section" data-stale={state.stale || undefined}>
        <header><span>{String(i + 1).padStart(2, '0')}</span><h3>{section.title}</h3></header>
        <MarkdownText text={section.text} labels={labels} />
        <Sources refs={section.refs} reading={reading} Button={Button} />
      </article>)}
      {!state.plan && !state.sections.length && !busy && !state.error && <div className="sc-reading-empty"><span aria-hidden>⌘</span><h2>{t('readingEmpty')}</h2><p>{t('readingEmptyHint')}</p>
        <Button onClick={() => reading.goal(t('readingOverviewGoal'))}>{t('readingOverviewGoal')}</Button>
      </div>}
      {busy && <div className="sc-reading-progress" role="status"><i /><span>{t(`readingStage_${state.stage || 'catalog'}`)}</span></div>}
      {state.partial && <p className="sc-reading-partial">{t('readingPartial')}</p>}
      {state.finished && state.sections.length > 0 && !state.stale && <p className="sc-reading-end">{t('readingEnd')}</p>}
    </div>
  </aside>;
}
