import React from 'react';
import { localized } from './recipes.js';

export function Route({ recipe, run, choose, start, toggle, t }) {
  const language = t('language'), active = run?.recipe === recipe.id, completed = active ? run.completed : [];
  return <section className="sc-flow-route" aria-label={localized(recipe.title, language)}>
    <div className="sc-flow-route-heading"><div><small>{t('routes')}</small><h2>{localized(recipe.title, language)}</h2></div>
      {!active && <button type="button" className="sc-flow-primary" onClick={start}>{t('start')}</button>}
      {active && <span className="sc-flow-count">{completed.length} / {recipe.steps.length}</span>}</div>
    <p>{localized(recipe.summary, language)}</p>
    <dl className="sc-flow-outcomes"><div><dt>{t('input')}</dt><dd>{localized(recipe.input, language)}</dd></div><div><dt>{t('output')}</dt><dd>{localized(recipe.output, language)}</dd></div></dl>
    <ol className="sc-flow-steps">{recipe.steps.map(([name, zh, en], index) => <li key={`${name}-${index}`} data-complete={completed.includes(index)}>
      <button type="button" className="sc-flow-step" onClick={() => choose(name, index)} aria-label={`${index + 1}. ${language === 'zh' ? zh : en}`}>
        <span className="sc-flow-number">{completed.includes(index) ? '✓' : index + 1}</span><span><strong>{language === 'zh' ? zh : en}</strong><code>/{name}</code></span>
      </button>
      {active && <button type="button" className="sc-flow-step-check" aria-pressed={completed.includes(index)} title={t(completed.includes(index) ? 'reopen' : 'complete')} onClick={() => toggle(index)}>{t(completed.includes(index) ? 'completed' : 'complete')}</button>}
    </li>)}</ol>
    <p className="sc-flow-note">{active ? completed.length === recipe.steps.length ? t('finish') : t('progress') : t('choose')}</p>
  </section>;
}

export function SkillDetail({ skill, pack, availability, favorite, toggleFavorite, compose, close, t }) {
  return <aside className="sc-flow-detail" aria-label={t('details')}>
    <div className="sc-flow-detail-header"><span>{pack.title}</span><button type="button" aria-label={t(favorite ? 'unfavorite' : 'favorite')} aria-pressed={favorite} onClick={toggleFavorite}>{favorite ? '★' : '☆'}</button></div>
    <h2>{skill.name}</h2><span className="sc-flow-availability" data-ready={availability === 'ready'}>{t(availability)}</span>
    <p className="sc-flow-description">{skill.description}</p>
    <code className="sc-flow-command">/{skill.name}</code>
    {compose}
    <button type="button" onClick={close}>{t('back')}</button>
    {availability === 'unavailable' && <p className="sc-flow-note">{t('disabledHint')}</p>}
    {availability === 'overridden' && <p className="sc-flow-note">{t('overrideHint')}</p>}
    {skill.sections.length > 0 && <details><summary>{t('sections')}</summary><ul>{skill.sections.map(section => <li key={section}>{section}</li>)}</ul></details>}
    <footer><span>{t('version')} {pack.version}</span><a href={pack.source} target="_blank" rel="noreferrer">{t('source')} ↗</a></footer>
  </aside>;
}
