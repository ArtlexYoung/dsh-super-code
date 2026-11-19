import React from 'react';
import { localized } from './recipes.js';
import { Landmark, Landscape, mapPoints } from './MapArt.jsx';

export function Route({ recipe, completed, selected, choose, t, notice, chooseTool }) {
  const language = t('language'), next = recipe.steps.findIndex(step => !completed.includes(step.id));
  const completedIndices = recipe.steps.flatMap((step, index) => completed.includes(step.id) ? [index] : []);
  const points = mapPoints(recipe.steps.length), mobilePoints = mapPoints(recipe.steps.length, true);
  const mobileHeight = 75 + (recipe.steps.length - 1) * 142 + 120;
  return <section className="sc-flow-route" aria-label={localized(recipe.title, language)}>
    <header className="sc-flow-route-heading"><div><span className="sc-flow-eyebrow">{t('world.' + recipe.pack)}</span><h2>{localized(recipe.title, language)}</h2><p>{localized(recipe.summary, language)}</p></div>
      <div className="sc-flow-route-progress"><strong>{completed.length}<span> / {recipe.steps.length}</span></strong><small>{t('confirmed')}</small><div className="sc-flow-progress-track" aria-hidden="true"><span style={{ width: `${completed.length / recipe.steps.length * 100}%` }} /></div></div></header>
    {recipe.source && <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')} ↗</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>}
    <div className="sc-flow-map" style={{ '--mobile-map-height': `${mobileHeight}px` }}>
      <div className="sc-flow-map-board"><Landscape count={recipe.steps.length} completed={completedIndices} /><Landscape count={recipe.steps.length} completed={completedIndices} mobile />
        <div className="sc-map-coordinate" aria-hidden="true">{t('mapLabel')}<span>01 — 0{recipe.steps.length}</span></div><div className="sc-map-compass" aria-hidden="true"><span>N</span><Landmark name="compass" /></div>
        <ol className="sc-flow-steps">{recipe.steps.map((step, index) => {
          const done = completed.includes(step.id), current = index === next;
          return <li key={step.skill + index} data-complete={done} data-current={current} style={{ '--node-x': `${points[index][0] / 10}%`, '--node-y': `${points[index][1] / 440 * 100}%`, '--node-mobile-x': `${mobilePoints[index][0] / 360 * 100}%`, '--node-mobile-y': `${mobilePoints[index][1] / mobileHeight * 100}%` }}>
            <button type="button" className="sc-flow-step" aria-label={`${index + 1}. ${localized(step.title, language)}`} aria-pressed={selected === index} aria-current={current ? 'step' : undefined} onClick={() => choose(index)}>
              <span className="sc-flow-node-platform"><span className="sc-flow-node-art"><Landmark name={step.icon} /></span><span className="sc-flow-node-number">{done ? '✓' : String(index + 1).padStart(2, '0')}</span></span>
              <span className="sc-flow-node-label"><strong>{localized(step.title, language)}</strong><small>{done ? t('completed') : current ? t('nextQuest') : t('exploreQuest')}</small></span>
            </button></li>;
        })}</ol>
      </div>
    </div>
    <footer className="sc-flow-map-footer"><div className="sc-flow-map-legend"><span><i data-state="current" />{t('nextQuest')}</span><span><i data-state="done" />{t('completed')}</span><span><i />{t('exploreQuest')}</span></div>
      <button type="button" className="sc-flow-locate" onClick={() => choose(next === -1 ? recipe.steps.length - 1 : next)}>{next === -1 ? t('reviewRoute') : t('locate')} <span aria-hidden="true">↗</span></button></footer>
    <div className="sc-flow-route-result" role="status" aria-live="polite" data-finished={next === -1}>{notice || (next === -1 ? t('finish') : t('progress'))}</div>
    {recipe.tools?.length > 0 && <section className="sc-flow-tools" aria-label={t('tools')}><h3>{t('tools')}</h3>{recipe.tools.map(tool => <button type="button" key={tool.skill} onClick={() => chooseTool(tool.skill)}><span><strong>{localized(tool.label, language)}</strong><small>{localized(tool.when, language)}</small></span><code>/{tool.skill} ↗</code></button>)}</section>}
  </section>;
}

function Mission({ mission, t }) {
  const language = t('language');
  return <><div className="sc-flow-mission-emblem" data-complete={mission.completed}><Landmark name={mission.step.icon} />{mission.completed && <span className="sc-flow-stamp">✓</span>}</div>
    <h2>{localized(mission.step.title, language)}</h2><p className="sc-flow-mission-goal">{localized(mission.step.goal, language)}</p>
    <div className="sc-flow-mission-output"><span>{t('questOutput')}</span><strong>{localized(mission.step.output, language)}</strong></div></>;
}

export function SkillDetail({ skill, pack, availability, favorite, toggleFavorite, compose, close, backLabel, t, mission, toggleComplete, nextQuest }) {
  return <aside className="sc-flow-detail" aria-label={t('details')} data-mission={Boolean(mission)}>
    <div className="sc-flow-detail-header"><span>{mission ? `${t('quest')} ${String(mission.index + 1).padStart(2, '0')}` : pack.title}</span><button type="button" aria-label={t(favorite ? 'unfavorite' : 'favorite')} aria-pressed={favorite} onClick={toggleFavorite}>{favorite ? '★' : '☆'}</button></div>
    {mission ? <Mission mission={mission} t={t} /> : <><h2>{skill.name}</h2><p className="sc-flow-description">{skill.description}</p></>}
    <span className="sc-flow-availability" data-ready={availability === 'ready'}><i />{t(availability)}</span>
    <code className="sc-flow-command">/{skill.name}</code>{compose}
    {mission && <button type="button" className="sc-flow-step-check" aria-pressed={mission.completed} onClick={toggleComplete}>{mission.completed ? t('reopen') : t('complete')} <span aria-hidden="true">{mission.completed ? '↶' : '✓'}</span></button>}
    {nextQuest && <button type="button" className="sc-flow-next-quest" onClick={nextQuest}>{t('goNext')} →</button>}
    {availability === 'unavailable' && <p className="sc-flow-note">{t('disabledHint')}</p>}
    {availability === 'overridden' && <p className="sc-flow-note">{t('overrideHint')}</p>}
    <details className="sc-flow-skill-notes"><summary>{mission ? t('skillNotes') : t('sections')}</summary>{mission && <p>{skill.description}</p>}{skill.sections.length > 0 && <ul>{skill.sections.map(section => <li key={section}>{section}</li>)}</ul>}</details>
    <footer><span>{pack.title} · {pack.version}</span><a href={pack.source} target="_blank" rel="noreferrer">{t('source')} ↗</a></footer>
    <button type="button" className="sc-flow-back" onClick={close}>{backLabel} ↑</button>
  </aside>;
}
