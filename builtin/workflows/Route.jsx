import React from 'react';
import { localized } from './recipes.js';
import { nextStageIndex } from './model.js';

export function Route({ recipe, run, selected, choose, t, notice, chooseTool }) {
  const language = t('language'), next = nextStageIndex(recipe, run);
  const completed = recipe.steps.filter(step => run.stages[step.id]?.status === 'completed').length;
  return <section className="sc-flow-route" aria-label={localized(recipe.title, language)}>
    <header className="sc-flow-route-heading"><div><span className="sc-flow-eyebrow">{t('workflow')}</span><h2>{localized(recipe.title, language)}</h2><p>{localized(recipe.summary, language)}</p></div>
      <div className="sc-flow-route-progress"><strong>{completed}<span> / {recipe.steps.length}</span></strong><small>{t('confirmed')}</small><progress aria-label={t('stageProgress')} value={completed} max={recipe.steps.length} /></div></header>
    <ol className="sc-flow-steps">{recipe.steps.map((step, index) => {
      const state = run.stages[step.id]?.status || 'pending', current = index === next;
      return <li key={step.id} data-state={state} data-complete={state === 'completed'} data-current={current}>
        <button type="button" className="sc-flow-step" aria-label={`${index + 1}. ${localized(step.title, language)}`} aria-pressed={selected === index} aria-current={current ? 'step' : undefined} onClick={() => choose(index)}>
          <span className="sc-flow-step-top"><span className="sc-flow-step-number">{state === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><small>{t(current && state === 'pending' ? 'stage.next' : 'stage.' + state)}</small></span>
          <strong>{localized(step.title, language)}</strong><span className="sc-flow-step-output">{localized(step.output, language)}</span>
        </button></li>;
    })}</ol>
    <div className="sc-flow-route-result" role="status" aria-live="polite" data-finished={next === -1}><span>{next === -1 ? t('finish') : notice || t('progress')}</span><button type="button" className="sc-flow-locate" onClick={() => choose(next === -1 ? recipe.steps.length - 1 : next)}>{t(next === -1 ? 'reviewRoute' : 'locate')} →</button></div>
    {recipe.source && <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')}</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>}
    {recipe.tools?.length > 0 && <div className="sc-flow-tools" aria-label={t('tools')}><span>{t('tools')}</span>{recipe.tools.map(tool => <button type="button" key={tool.skill} title={localized(tool.when, language)} onClick={() => chooseTool(tool.skill)}>{localized(tool.label, language)} <span>↗</span></button>)}</div>}
  </section>;
}

function StageRecord({ mission, update, save, openFile, t }) {
  const record = mission.record;
  const canComplete = Boolean(record.result.trim() || record.files.length);
  const canSave = record.status === 'blocked' ? Boolean(record.blocker.trim()) : record.status !== 'completed' || canComplete;
  return <section className="sc-flow-record" aria-label={t('record')}>
    <div className="sc-flow-record-heading"><h3>{t('record')}</h3><span>{t(mission.unsaved ? 'unsaved' : record.legacy ? 'legacyRecord' : 'manualRecord')}</span></div>
    <label>{t('result')}<textarea aria-label={t('result')} value={record.result} maxLength={4000} rows={3} placeholder={t('resultHint')} onChange={event => update({ ...record, result: event.target.value })} /></label>
    {record.files.length > 0 && <ul className="sc-flow-attachments">{record.files.map(path => <li key={path}><button type="button" onClick={() => openFile(path)} title={path}>{path.replaceAll('\\', '/').split('/').at(-1)}</button><button type="button" aria-label={`${t('detach')} ${path}`} onClick={() => update({ ...record, files: record.files.filter(file => file !== path) })}>×</button></li>)}</ul>}
    <details open={record.status === 'blocked' || undefined}><summary>{t('blocker')}</summary><label>{t('blockerReason')}<textarea aria-label={t('blockerReason')} value={record.blocker} maxLength={4000} rows={2} onChange={event => update({ ...record, blocker: event.target.value })} /></label><button type="button" disabled={!record.blocker.trim()} onClick={() => save('blocked')}>{t('markBlocked')}</button></details>
    <div className="sc-flow-record-actions"><button type="button" disabled={!canSave} onClick={() => save(record.status)}>{t('saveRecord')}</button>{record.status === 'completed' ? <button type="button" onClick={() => save('pending')}>{t('reopen')}</button> : <button type="button" className="sc-flow-complete" disabled={!canComplete} onClick={() => save('completed')}>{t('complete')} ✓</button>}</div>
    {!canComplete && record.status !== 'completed' && <p className="sc-flow-note">{t('completionHint')}</p>}
  </section>;
}

export function SkillDetail({ skill, pack, availability, favorite, toggleFavorite, compose, close, backLabel, t, mission, updateRecord, saveRecord, nextQuest, openFile, choosePrevious }) {
  const language = t('language');
  return <aside className="sc-flow-detail" aria-label={t('details')} data-mission={Boolean(mission)}>
    <div className="sc-flow-detail-header"><span>{mission ? `${t('stage')} ${String(mission.index + 1).padStart(2, '0')}` : pack.title}</span><button type="button" aria-label={t(favorite ? 'unfavorite' : 'favorite')} aria-pressed={favorite} onClick={toggleFavorite}>{favorite ? '★' : '☆'}</button></div>
    <h2>{mission ? localized(mission.step.title, language) : skill.name}</h2>
    <p className="sc-flow-description">{mission ? localized(mission.step.goal, language) : skill.description}</p>
    <div className="sc-flow-invoke"><div><code className="sc-flow-command">/{skill.name}</code><span className="sc-flow-availability" data-ready={availability === 'ready'}>{t(availability)}</span></div>{compose}</div>
    {mission && <><div className="sc-flow-mission-output"><span>{t('questOutput')}</span><strong>{localized(mission.step.output, language)}</strong></div>
      {mission.previous && <button type="button" className="sc-flow-dependency" onClick={choosePrevious}><span>{t('inputFrom')}</span><strong>{localized(mission.previous.output, language)}</strong><small>{t(mission.previousCompleted ? 'previousConfirmed' : 'previousUnconfirmed')} →</small></button>}
      {mission.record.status === 'blocked' && <p className="sc-flow-blocked" role="status">{t('stage.blocked')} · {mission.record.blocker}</p>}</>}
    {mission && <StageRecord mission={mission} update={updateRecord} save={saveRecord} openFile={openFile} t={t} />}
    {nextQuest && <button type="button" className="sc-flow-next-quest" onClick={nextQuest}>{t('goNext')} →</button>}
    {availability === 'unavailable' && <p className="sc-flow-note">{t('disabledHint')}</p>}
    {availability === 'overridden' && <p className="sc-flow-note">{t('overrideHint')}</p>}
    <details className="sc-flow-skill-notes"><summary>{t('skillNotes')}</summary><p>{skill.description}</p>{skill.sections.length > 0 && <ul>{skill.sections.map(section => <li key={section}>{section}</li>)}</ul>}<span>{pack.title} · {pack.version}</span> · <a href={pack.source} target="_blank" rel="noreferrer">{t('source')} ↗</a></details>
    <button type="button" className="sc-flow-back" onClick={close}>{backLabel} ↑</button>
  </aside>;
}
