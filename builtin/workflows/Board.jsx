import React from 'react';
import { localized } from './recipes.js';
import { cardState } from './deck.js';
import { usePageState } from './page-state.js';

// Matt workflows organize independently verifiable work as cards.
const layouts = {
  'matt-feature': { caption: ['点卡面看说明，点“处理这张任务”准备指令。检查并发送后，继续记录结果。', 'Inspect a card or choose “Work on this task” to prepare its instruction. Review and send it, then record the result.'], sections: [['desk', '任务', 'Tasks']] },
  'matt-small': { group: card => card.skill === 'implement' ? 'focus' : 'support', caption: ['需求已经清楚时，选择“实现与检查”。有不确定的地方，可以先澄清需求。', 'Choose “Implement and review” when requirements are clear, or clarify them first.'], sections: [['focus', '实现任务', 'Implementation'], ['support', '需要时使用', 'Use when needed']] },
  'matt-fix': { group: card => card.skill === 'diagnosing-bugs' ? 'investigate' : 'review', caption: ['先打开“复现、定位与修复”，说明报错和触发步骤；修好后再检查影响。', 'Open “Reproduce, diagnose and fix” with the error and steps to trigger it. Review the impact after the fix.'], sections: [['investigate', '调查与修复', 'Investigate and repair'], ['review', '检查与总结', 'Review and reflect']] },
  'matt-wayfinder': { group: (card, run) => run.stages[card.id]?.status === 'completed' ? 'decisions' : 'questions', caption: ['先写清要解决的问题，逐项记录决定。方案确定后，再编写需求说明。', 'Define the problem and record each decision. Write the specification once the approach is clear.'], sections: [['questions', '待解决的问题', 'Open questions'], ['decisions', '已确认的决定', 'Confirmed decisions']] },
};

function TaskCard({ card, index, state, record, selected, choose, invoke, edit, t }) {
  const language = t('language');
  return <li data-state={state} data-complete={state === 'completed'} className="sc-flow-task-card">
    <div className="sc-flow-card-meta"><span>#{String(index + 1).padStart(2, '0')}</span><small>{card.skill}</small><span className="sc-flow-stamp">{t('stage.' + state)}</span></div>
    <button type="button" className="sc-flow-step" aria-label={`${index + 1}. ${localized(card.title, language)}`} aria-pressed={selected} aria-current={state === 'active' ? 'step' : undefined} onClick={choose}>
      <strong>{localized(card.title, language)}</strong><span className="sc-flow-step-output">{localized(card.output, language)}</span>
      {record?.result && <span className="sc-flow-card-result">{state === 'completed' ? '✓' : '↳'} {record.result}</span>}
      {record?.files.length > 0 && <span className="sc-flow-card-files">↗ {record.files.length} {t('linkedFiles')}</span>}
      {state === 'blocked' && <span className="sc-flow-card-blocker">{record.blocker}</span>}
      {card.dependsOn.length > 0 && <small className="sc-flow-card-dependencies">↳ {t('dependencies')} · {card.dependsOn.length}</small>}
    </button>
    <footer>{['completed', 'waiting'].includes(state) ? <button type="button" className="sc-flow-card-action" onClick={choose}>{t(state === 'completed' ? 'reviewOutcome' : 'openTask')} ↗</button> : invoke}<button type="button" aria-label={`${t('editTask')} ${localized(card.title, language)}`} onClick={edit}>···</button></footer>
  </li>;
}

export function Board({ memory, recipe, cards, run, selected, choose, invoke, edit, add, chooseTool, t, notice }) {
  const [filter, setFilter] = usePageState(memory, `${recipe.id}/filter`, 'all'), [query, setQuery] = usePageState(memory, `${recipe.id}/query`, '');
  const language = t('language'), layout = layouts[recipe.id];
  const items = cards.map((card, index) => ({ card, index, state: cardState(card, run) }));
  const completed = items.filter(item => item.state === 'completed').length;
  const visible = items.filter(item => (filter === 'all' || item.state === filter) && `${localized(item.card.title, language)} ${item.card.skill}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="sc-flow-route" data-layout={recipe.id} aria-label={localized(recipe.title, language)}>
    <header className="sc-flow-board-heading"><p>{localized(layout.caption, language)}</p><div className="sc-flow-route-progress"><strong>{completed}<span> / {cards.length}</span></strong><small>{t('confirmed')}</small><progress aria-label={t('stageProgress')} value={completed} max={cards.length} /></div></header>
    <div className="sc-flow-board-toolbar"><nav aria-label={t('filterTasks')}>{['all', 'pending', 'active', 'waiting', 'blocked', 'completed'].map(state => <button key={state} type="button" aria-pressed={filter === state} onClick={() => setFilter(state)}>{t(state === 'all' ? 'allTasks' : 'stage.' + state)} <span>{state === 'all' ? items.length : items.filter(item => item.state === state).length}</span></button>)}</nav><button type="button" className="sc-flow-add-task" disabled={cards.length >= 64} onClick={() => add()}>＋ {t('addTask')}</button></div>
    <label className="sc-flow-task-search"><input type="search" aria-label={t('searchTasks')} placeholder={t('searchTasks')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="sc-flow-board-sections">{layout.sections.map(([id, chinese, english]) => {
      const group = visible.filter(({ card, index }) => (layout.group ? layout.group(card, run) : layout.sections[0][0]) === id);
      return <section key={id} className="sc-flow-board-section" data-section={id}>{layout.sections.length > 1 && <h3>{language === 'zh' ? chinese : english}<span>{group.length}</span></h3>}<ol className="sc-flow-steps">{group.map(({ card, index, state }) => <TaskCard key={card.id} card={card} index={index} state={state} record={run.stages[card.id]} selected={selected === index} choose={() => choose(index)} invoke={invoke(index)} edit={() => edit(card)} t={t} />)}</ol>{!group.length && <p className="sc-flow-empty-board">{t('emptyTasks')}</p>}</section>;
    })}</div>
    <p className="sc-flow-route-result" role="status" aria-live="polite">{completed === cards.length ? t('finish') : notice || t('progress')}</p>
    {recipe.tools?.length > 0 && <div className="sc-flow-tools" aria-label={t('tools')}><span>{t('tools')}</span>{recipe.tools.map(tool => <div key={tool.skill}><button type="button" title={localized(tool.when, language)} onClick={() => chooseTool(tool.skill)}>{localized(tool.label, language)} ↗</button><button type="button" aria-label={`${t('addBranch')} ${tool.skill}`} disabled={cards.length >= 64} onClick={() => add(tool)}>＋</button></div>)}</div>}
    {recipe.source && <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')}</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>}
  </section>;
}
