import React, { useState } from 'react';
import { localized } from './recipes.js';

export function TaskEditor({ card, cards, skills, save, close, move, t }) {
  const language = t('language');
  const [draft, setDraft] = useState(card), [error, setError] = useState('');
  const update = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  return <form className="sc-flow-editor" aria-label={t('editTask')} onSubmit={event => {
    event.preventDefault();
    const result = save(draft);
    if (result) { close(); return; }
    setError(t('taskSaveFailed'));
  }}>
    <header><h3>{t('editTask')}</h3><button type="button" aria-label={t('close')} onClick={close}>×</button></header>
    <label>{t('taskTitle')}<input aria-label={t('taskTitle')} required maxLength={200} value={localized(draft.title, language)} onChange={event => update('title', [event.target.value, event.target.value])} /></label>
    <label>{t('taskSkill')}<select aria-label={t('taskSkill')} value={draft.skill} onChange={event => update('skill', event.target.value)}>{skills.map(skill => <option key={skill.id} value={skill.name}>{skill.name}</option>)}</select></label>
    <label>{t('questGoal')}<textarea aria-label={t('questGoal')} required rows={2} maxLength={4000} value={localized(draft.goal, language)} onChange={event => update('goal', [event.target.value, event.target.value])} /></label>
    <label>{t('questOutput')}<input aria-label={t('questOutput')} required maxLength={4000} value={localized(draft.output, language)} onChange={event => update('output', [event.target.value, event.target.value])} /></label>
    <fieldset><legend>{t('dependencies')}</legend><p>{t('dependenciesHint')}</p><div>{cards.filter(item => item.id !== card.id).map(item => <label key={item.id}><input type="checkbox" checked={draft.dependsOn.includes(item.id)} onChange={event => update('dependsOn', event.target.checked ? [...draft.dependsOn, item.id] : draft.dependsOn.filter(id => id !== item.id))} />{localized(item.title, language)}</label>)}</div></fieldset>
    {error && <p role="alert">{error}</p>}
    <footer>{move && <span><button type="button" disabled={cards[0].id === card.id} onClick={() => move(-1)}>{t('moveEarlier')} ↑</button><button type="button" disabled={cards.at(-1).id === card.id} onClick={() => move(1)}>{t('moveLater')} ↓</button></span>}<button type="submit" className="sc-flow-primary">{t('saveTask')}</button></footer>
  </form>;
}
