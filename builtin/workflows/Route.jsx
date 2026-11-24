import React from 'react';
import { localized } from './recipes.js';
import { useReplyDestination } from './ReplyDestination.jsx';

function StageRecord({ mission, update, save, openFile, t }) {
  const record = mission.record;
  const { field, notice } = useReplyDestination({ id: mission.step.id, title: localized(mission.step.title, t('language')), value: record.result, update: result => update({ ...record, result }), t });
  const canComplete = Boolean(record.result.trim() || record.files.length);
  const canSave = record.status === 'blocked' ? Boolean(record.blocker.trim()) : record.status !== 'completed' || canComplete;
  return <section className="sc-flow-record" aria-label={t('record')}>
    <div className="sc-flow-record-heading"><h3>{t('record')}</h3><span>{t(mission.unsaved ? 'unsaved' : record.legacy ? 'legacyRecord' : 'manualRecord')}</span></div>
    <label>{t('result')}<textarea ref={field} aria-label={t('result')} value={record.result} maxLength={4000} rows={5} placeholder={t('resultHint')} onChange={event => update({ ...record, result: event.target.value })} /></label>
    {mission.unsaved && notice && <p className="sc-flow-note" role="status">{notice}</p>}
    {record.files.length > 0 && <ul className="sc-flow-attachments">{record.files.map(path => <li key={path}><button type="button" onClick={() => openFile(path)} title={path}>{path.replaceAll('\\', '/').split('/').at(-1)}</button><button type="button" aria-label={`${t('detach')} ${path}`} onClick={() => update({ ...record, files: record.files.filter(file => file !== path) })}>×</button></li>)}</ul>}
    <details open={record.status === 'blocked' || undefined}><summary>{t('blocker')}</summary><label>{t('blockerReason')}<textarea aria-label={t('blockerReason')} value={record.blocker} maxLength={4000} rows={2} onChange={event => update({ ...record, blocker: event.target.value })} /></label><button type="button" disabled={!record.blocker.trim()} onClick={() => save('blocked')}>{t('markBlocked')}</button></details>
    <div className="sc-flow-record-actions"><button type="button" disabled={!canSave} onClick={() => save(record.status)}>{t('saveRecord')}</button>{record.status === 'completed' ? <button type="button" onClick={() => save('pending')}>{t('reopen')}</button> : <button type="button" className="sc-flow-complete" disabled={!canComplete} onClick={() => save('completed')}>{t('complete')} ✓</button>}</div>
    {!canComplete && record.status !== 'completed' && <p className="sc-flow-note">{t('completionHint')}</p>}
  </section>;
}

export function SkillDetail({ skill, pack, availability, favorite, toggleFavorite, compose, close, backLabel, t, mission, updateRecord, saveRecord, nextQuest, openFile, chooseDependency, editTask }) {
  const language = t('language');
  return <aside className="sc-flow-detail" aria-label={t('details')} data-mission={Boolean(mission)}>
    <div className="sc-flow-detail-header"><span>{mission ? `#${String(mission.index + 1).padStart(2, '0')} · ${t('stage')}` : pack.title}</span><button type="button" aria-label={t(favorite ? 'unfavorite' : 'favorite')} aria-pressed={favorite} onClick={toggleFavorite}>{favorite ? '★' : '☆'}</button></div>
    <h2>{mission ? localized(mission.step.title, language) : skill.name}</h2>
    {mission && <button type="button" className="sc-flow-edit-task" onClick={editTask}>{t('editTask')} ↗</button>}
    <p className="sc-flow-description">{mission ? localized(mission.step.goal, language) : skill.description}</p>
    <div className="sc-flow-invoke"><div><code className="sc-flow-command">/{skill.name}</code><span className="sc-flow-availability" data-ready={availability === 'ready'}>{t(availability)}</span></div>{compose}</div>
    {mission && <><div className="sc-flow-mission-output"><span>{t('questOutput')}</span><strong>{localized(mission.step.output, language)}</strong></div>
      {mission.dependencies.map(dependency => <button key={dependency.id} type="button" className="sc-flow-dependency" onClick={() => chooseDependency(dependency.id)}><span>{t('inputFrom')}</span><strong>{localized(dependency.title, language)}</strong><small>{t(dependency.completed ? 'previousConfirmed' : 'previousUnconfirmed')} →</small></button>)}
      {mission.record.status === 'blocked' && <p className="sc-flow-blocked" role="status">{t('stage.blocked')} · {mission.record.blocker}</p>}</>}
    {mission && <StageRecord mission={mission} update={updateRecord} save={saveRecord} openFile={openFile} t={t} />}
    {nextQuest && <button type="button" className="sc-flow-next-quest" onClick={nextQuest}>{t('goNext')} →</button>}
    {availability === 'unavailable' && <p className="sc-flow-note">{t('disabledHint')}</p>}
    {availability === 'overridden' && <p className="sc-flow-note">{t('overrideHint')}</p>}
    <details className="sc-flow-skill-notes"><summary>{t('skillNotes')}</summary><p>{skill.description}</p>{skill.sections.length > 0 && <ul>{skill.sections.map(section => <li key={section}>{section}</li>)}</ul>}<span>{pack.title} · {pack.version}</span> · <a href={pack.source} target="_blank" rel="noreferrer">{t('source')} ↗</a></details>
    <button type="button" className="sc-flow-back" onClick={close}>{backLabel} ↑</button>
  </aside>;
}
