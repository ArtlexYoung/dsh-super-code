import React, { useState } from 'react';
import { localized } from './recipes.js';
import { cardState } from './deck.js';

// Each method arranges its work around its own objects, while cards share acceptance semantics.
const layouts = {
  'matt-feature': { mark: 'M / 01', title: ['任务布告板', 'The task board'], caption: ['选一张卡，把想法变成成果。', 'Pick a card. Turn an idea into an outcome.'], sections: [['desk', '待办与成果', 'Work and outcomes']] },
  'matt-small': { group: card => card.skill === 'implement' ? 'focus' : 'support', mark: 'M / 02', title: ['专注这一件事', 'One change, one sitting'], caption: ['需求清楚，就直接动手。', 'A clear request is enough to start.'], sections: [['focus', '现在动手', 'Make the change'], ['support', '需要时再展开', 'Open when needed']] },
  'matt-fix': { group: card => card.skill === 'diagnosing-bugs' ? 'investigate' : 'review', mark: 'M / 03', title: ['故障调查室', 'The investigation desk'], caption: ['从可复现的失败，走到可验证的修复。', 'From a reproducible failure to a verified fix.'], sections: [['investigate', '调查与修复', 'Investigate and repair'], ['review', '复核与经验', 'Review and learn']] },
  'matt-wayfinder': { group: (card, run) => run.stages[card.id]?.status === 'completed' ? 'decisions' : 'questions', mark: 'M / 04', title: ['把未知逐个变清楚', 'Make the unknown clear'], caption: ['沿着问题探索，带着决策回来。', 'Explore a question. Bring back a decision.'], sections: [['questions', '待探明', 'Open questions'], ['decisions', '已确定', 'Decisions made']] },
  'pstack-feature': { group: card => ['understand', 'shape', 'checkpoint'].includes(card.id) ? 'shape' : 'build', mark: 'P / FEATURE', title: ['先定形，再构建', 'Shape it. Build it. Prove it.'], caption: ['数据与接口，是实现的起点。', 'Start with the data and the interface.'], sections: [['shape', '01 / 理解与定形', '01 / Understand & shape'], ['build', '02 / 实现与证据', '02 / Build & prove']] },
  'pstack-refactor': { group: card => card.id === 'contract' ? 'before' : 'after', mark: 'P / REFACTOR', title: ['结构变清楚，行为保持住', 'Less structure. Same behavior.'], caption: ['把基线放在手边，每次迁移都能对照。', 'Keep the baseline beside every change.'], sections: [['before', '行为基线', 'Behavior to preserve'], ['after', '目标结构与等价证据', 'New shape & equivalence']] },
  'openspec-change': { group: card => ['openspec-explore', 'openspec-propose'].includes(card.skill) ? 'proposal' : card.skill === 'openspec-apply-change' ? 'implementation' : 'archive', mark: 'O / CHANGE', title: ['一份变更，完整交付', 'A change, fully accounted for'], caption: ['让提案、代码与验证有据可查。', 'Keep the proposal, implementation and evidence together.'], sections: [['proposal', '提案卷', 'Proposal'], ['implementation', '实施卷', 'Implementation'], ['archive', '验收卷', 'Verification & archive']] },
};

function TaskCard({ card, index, state, record, selected, choose, start, edit, t }) {
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
    <footer><button type="button" className="sc-flow-card-action" onClick={state === 'pending' ? start : choose}>{t(state === 'pending' ? 'startTask' : state === 'completed' ? 'reviewOutcome' : 'openTask')} ↗</button><button type="button" aria-label={`${t('editTask')} ${localized(card.title, language)}`} onClick={edit}>···</button></footer>
  </li>;
}

export function Board({ recipe, cards, run, selected, choose, start, edit, add, chooseTool, t, notice }) {
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
  const language = t('language'), layout = layouts[recipe.id];
  const items = cards.map((card, index) => ({ card, index, state: cardState(card, run) }));
  const completed = items.filter(item => item.state === 'completed').length;
  const visible = items.filter(item => (filter === 'all' || item.state === filter) && `${localized(item.card.title, language)} ${item.card.skill}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="sc-flow-route" data-layout={recipe.id} aria-label={localized(recipe.title, language)}>
    <header className="sc-flow-board-heading"><div><span className="sc-flow-eyebrow">{layout.mark}</span><h2>{localized(layout.title, language)}</h2><p>{localized(layout.caption, language)}</p></div><div className="sc-flow-route-progress"><strong>{completed}<span> / {cards.length}</span></strong><small>{t('confirmed')}</small><progress aria-label={t('stageProgress')} value={completed} max={cards.length} /></div></header>
    <div className="sc-flow-board-toolbar"><nav aria-label={t('filterTasks')}>{['all', 'pending', 'active', 'waiting', 'blocked', 'completed'].map(state => <button key={state} type="button" aria-pressed={filter === state} onClick={() => setFilter(state)}>{t(state === 'all' ? 'allTasks' : 'stage.' + state)} <span>{state === 'all' ? items.length : items.filter(item => item.state === state).length}</span></button>)}</nav><button type="button" className="sc-flow-add-task" disabled={cards.length >= 64} onClick={() => add()}>＋ {t('addTask')}</button></div>
    <label className="sc-flow-task-search"><input type="search" aria-label={t('searchTasks')} placeholder={t('searchTasks')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="sc-flow-board-sections">{layout.sections.map(([id, chinese, english]) => {
      const group = visible.filter(({ card, index }) => (layout.group ? layout.group(card, run) : layout.sections[0][0]) === id);
      return <section key={id} className="sc-flow-board-section" data-section={id}><h3>{language === 'zh' ? chinese : english}<span>{group.length}</span></h3><ol className="sc-flow-steps">{group.map(({ card, index, state }) => <TaskCard key={card.id} card={card} index={index} state={state} record={run.stages[card.id]} selected={selected === index} choose={() => choose(index)} start={() => start(index)} edit={() => edit(card)} t={t} />)}</ol>{!group.length && <p className="sc-flow-empty-board">{t('emptyTasks')}</p>}</section>;
    })}</div>
    <p className="sc-flow-route-result" role="status" aria-live="polite">{completed === cards.length ? t('finish') : notice || t('progress')}</p>
    {recipe.tools?.length > 0 && <div className="sc-flow-tools" aria-label={t('tools')}><span>{t('tools')}</span>{recipe.tools.map(tool => <div key={tool.skill}><button type="button" title={localized(tool.when, language)} onClick={() => chooseTool(tool.skill)}>{localized(tool.label, language)} ↗</button><button type="button" aria-label={`${t('addBranch')} ${tool.skill}`} disabled={cards.length >= 64} onClick={() => add(tool)}>＋</button></div>)}</div>}
    {recipe.source && <details className="sc-flow-method"><summary>{recipe.source.label}<span>{t('authorMethod')}</span></summary><p>{localized(recipe.guidance, language)}</p><a href={recipe.source.url} target="_blank" rel="noreferrer">{t('readMethod')} ↗</a></details>}
  </section>;
}
