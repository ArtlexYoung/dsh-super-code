import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import catalog from './catalog.json';
import { recipes, localized } from './recipes.js';
import { commandDraft, initialPreferences, readPreferences, subscribePreferences, recordProgress, savePreferences, skillAvailability, emptyRoute, emptyStage, changeStage, nextStageIndex } from './model.js';
import { cardsFor, replaceCards, moveCard, cardState } from './deck.js';
import { SkillDetail } from './Route.jsx';
import { Board } from './Board.jsx';
import { Compose } from './Compose.jsx';
import { PStack } from './PStack.jsx';
import { OpenSpec } from './OpenSpec.jsx';
import { TaskEditor } from './TaskEditor.jsx';
import { Catalog } from './Catalog.jsx';
import { Execution } from './Execution.jsx';
import { executionFacts } from './execution.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';
import stylesheet from './style.css';

const allSkills = catalog.flatMap(pack => pack.skills.map(skill => ({ ...skill, pack: pack.id })));
const packTitles = Object.fromEntries(catalog.map(pack => [pack.id, pack.title]));
const savedRoute = (preferences, sessionId, recipeId) => preferences.runs[sessionId]?.routes[recipeId] || emptyRoute();
const selectionFor = (recipe, card) => ({ id: `${recipe.pack}/${card.skill}`, cardId: card.id });


export function WorkflowLibrary({ api, subscribe, sessionId, useSessions, useInput, inputActions, openView, inspectCall, hasWorkbench, packageState, page, filesApi, MarkdownText, t, storage = localStorage }) {
  const enabled = useSyncExternalStore(packageState.subscribe, packageState.snapshot);
  const availableSkills = allSkills.filter(skill => enabled.includes(skill.pack) || enabled.includes('grill-me') && ['grill-me', 'grilling'].includes(skill.name) && skill.pack === 'mattpocock');
  const view = page === 'skills' ? 'catalog' : 'map', pageRecipes = recipes.filter(item => item.pack === page);
  const [initial] = useState(() => initialPreferences(storage)), [preferences, setPreferences] = useState(initial.value);
  const [error, setError] = useState(initial.error ? t('storageFailed') : ''), [native, setNative] = useState({ status: 'loading', skills: [] });
  const [revision, refresh] = useState(0);
  const [route, setRoute] = useState(() => {
    const visited = Object.keys(initial.value.runs[sessionId]?.routes || {}).reverse();
    return visited.map(id => recipes.find(item => item.id === id && item.pack === page)).find(Boolean) || recipes.find(item => item.pack === page) || recipes[0];
  });
  const [pack, setPack] = useState(view === 'catalog' ? '' : route.pack), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false), [drafts, setDrafts] = useState({}), [editing, setEditing] = useState(null);
  const [selection, setSelection] = useState(() => {
    if (view === 'catalog') return null;
    const run = savedRoute(initial.value, sessionId, route.id), cards = cardsFor(route, run), next = nextStageIndex(route, run);
    return selectionFor(route, cards[next === -1 ? 0 : next]);
  });
  const sessions = useSessions(state => state), facts = executionFacts(sessions, sessionId);
  const container = useRef(null), latestPreferences = useRef(preferences);
  const language = t('language'), persisted = savedRoute(preferences, sessionId, route.id), draft = drafts[route.id];
  const run = { ...persisted, goal: draft?.goal ?? persisted.goal }, cards = cardsFor(route, persisted);
  useEffect(() => subscribePreferences(storage, () => {
    const next = initialPreferences(storage);
    if (next.error) { setError(t('storageFailed')); return; }
    latestPreferences.current = next.value; setPreferences(next.value);
  }), [storage, t]);
  useEffect(() => subscribe(() => refresh(value => value + 1)), [subscribe]);
  useEffect(() => {
    const abort = new AbortController(); setNative(previous => ({ ...previous, status: 'loading' }));
    void api.list({ sessionId }, abort.signal).then(response => {
      if (abort.signal.aborted) return;
      if (!response.ok) throw new Error('Unavailable');
      setNative({ status: 'ready', skills: response.value.skills });
    }).catch(() => { if (!abort.signal.aborted) setNative({ status: 'failed', skills: [] }); });
    return () => abort.abort();
  }, [api, sessionId, revision, enabled]);
  const save = update => {
    try {
      const next = savePreferences(storage, update(readPreferences(storage)));
      latestPreferences.current = next; setPreferences(next); setError(''); return true;
    } catch { setError(t('storageFailed')); return false; }
  };
  const commitRun = (next, field) => {
    if (!save(previous => recordProgress(previous, sessionId, route.id, next))) return false;
    setDrafts(previous => {
      const remaining = { ...previous[route.id] }; delete remaining[field];
      return { ...previous, [route.id]: remaining };
    });
    return true;
  };
  const choose = (next, focus = true) => {
    setSelection(next); setCopied(false); setEditing(null);
    if (focus) requestAnimationFrame(() => {
      const detail = container.current?.querySelector('.sc-flow-detail');
      if (container.current?.clientWidth <= 860) detail?.scrollIntoView({ block: 'start' });
    });
  };
  const selectRoute = recipe => {
    const current = savedRoute(latestPreferences.current, sessionId, recipe.id), next = nextStageIndex(recipe, current), definitions = cardsFor(recipe, current);
    setRoute(recipe); setNotice(''); choose(selectionFor(recipe, definitions[next === -1 ? 0 : next]), false);
    save(previous => recordProgress(previous, sessionId, recipe.id, current));
  };
  const index = cards.findIndex(card => card.id === selection?.cardId), step = cards[index];
  const skill = availableSkills.find(item => item.id === selection?.id), skillPack = catalog.find(item => item.id === skill?.pack);
  const mission = view === 'map' && step ? { index, step, unsaved: Boolean(draft?.[step.id]),
    record: { ...(persisted.stages[step.id] || emptyStage()), ...draft?.[step.id] },
    dependencies: step.dependsOn.map(id => ({ ...cards.find(card => card.id === id), completed: persisted.stages[id]?.status === 'completed' })) } : null;
  const updateRecord = ({ result, blocker, files }) => setDrafts(previous => ({ ...previous, [route.id]: { ...previous[route.id], [step.id]: { result, blocker, files } } }));
  const saveRecord = (status, cardIndex = index) => {
    const card = cards[cardIndex], record = { ...(persisted.stages[card.id] || emptyStage()), ...draft?.[card.id], status };
    if (['active', 'completed'].includes(status) && card.dependsOn.some(id => persisted.stages[id]?.status !== 'completed')) { setError(t('waitingDependencies')); return false; }
    if (!commitRun(changeStage(persisted, card.id, record), card.id)) return false;
    setNotice(t(status === 'completed' ? 'stageAccepted' : 'recordSaved')); return true;
  };
  const saveCard = card => {
    try {
      const definitions = cards.some(item => item.id === card.id) ? cards.map(item => item.id === card.id ? card : item) : [...cards, card];
      if (!commitRun(replaceCards({ ...persisted, cards }, definitions, route.pack), '__cards')) return false;
      choose(selectionFor(route, card), false); return true;
    } catch { setError(t('invalidDependencies')); return false; }
  };
  const add = tool => {
    const base = step || cards[0];
    setEditing({ ...base, id: `task-${crypto.randomUUID()}`, skill: tool?.skill || base.skill,
      title: tool?.label || ['', ''], goal: tool?.when || base.goal, output: tool ? ['结论、产物与验证记录', 'Findings, artifacts and verification'] : base.output, dependsOn: [] });
    requestAnimationFrame(() => container.current?.querySelector('.sc-flow-editor')?.scrollIntoView({ block: 'nearest' }));
  };
  const openFile = path => {
    if (!hasWorkbench()) { setError(t('enableWorkbench')); return; }
    openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, {}, { cwd: facts.cwd })));
  };
  const context = mission ? `${route.playbook ? `${t('playbookContext')}${route.playbook}\n` : ''}${t('draftContext')}${localized(route.title, language)} / ${localized(step.title, language)}\n${t('questGoal')}：${localized(step.goal, language)}\n${t('questOutput')}：${localized(step.output, language)}${run.goal || facts.goal ? `\n${t('goal')}：${run.goal || facts.goal}` : ''}${mission.dependencies.map(item => {
    const record = persisted.stages[item.id];
    if (!record?.result && !record?.files.length) return '';
    return `\n${t('inputFrom')}：${localized(item.title, language)}\n${[record.result, ...record.files].filter(Boolean).join('\n')}`;
  }).join('')}` : '';
  const recordUse = id => save(previous => ({ ...previous, recent: [id, ...previous.recent.filter(previousId => previousId !== id)].slice(0, 12) }));
  const nextIndex = nextStageIndex(route, persisted);
  const detail = skill && <SkillDetail key={`${skill.id}-${selection.cardId}`} skill={skill} pack={skillPack} availability={skillAvailability(skill, native.skills)} favorite={preferences.favorites.includes(skill.id)} t={t} mission={mission} backLabel={t(view === 'map' ? 'back' : 'backToCatalog')}
    close={() => { if (view === 'catalog') choose(null, false); container.current.querySelector(view === 'map' ? '.sc-flow-route' : '.sc-flow-catalog')?.scrollIntoView({ block: 'start' }); }}
    toggleFavorite={() => save(previous => ({ ...previous, favorites: previous.favorites.includes(skill.id) ? previous.favorites.filter(id => id !== skill.id) : [...previous.favorites, skill.id] }))}
    updateRecord={updateRecord} saveRecord={saveRecord} openFile={openFile} chooseDependency={id => choose(selectionFor(route, cards.find(card => card.id === id)))} editTask={() => setEditing(step)}
    nextQuest={mission?.record.status === 'completed' && nextIndex !== -1 ? () => choose(selectionFor(route, cards[nextIndex])) : null}
    compose={<>
      {useInput && inputActions && <Compose key={`${skill.id}-${selection.cardId}`} skill={skill} availability={skillAvailability(skill, native.skills)} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context}
        onUsed={() => recordUse(skill.id)} t={t} />}
      <button type="button" className="sc-flow-copy" onClick={() => { void navigator.clipboard.writeText(commandDraft(skill, '', context)).then(() => setCopied(true)).catch(() => setError(t('copyFailed'))); }}>{t(copied ? 'copied' : 'copy')}</button>
      {mission && !['active', 'completed'].includes(mission.record.status) && <button type="button" className="sc-flow-focus" disabled={cardState(step, persisted) === 'waiting'} onClick={() => saveRecord('active')}>{t('focusStage')}</button>}
    </>} />;
  return <section ref={container} className="sc-flows" data-conversation-composer-overlay="" data-world={page} data-page={page} lang={language} aria-label={view === 'catalog' ? t('skills') : packTitles[page]}>
    <style>{stylesheet}</style>
    <header className="sc-flow-header"><div className="sc-flow-brand"><span className="sc-flow-logomark" aria-hidden="true">{view === 'catalog' ? 'S' : packTitles[page]?.[0]}</span><div><span>SUPER CODE / {view === 'catalog' ? 'SKILLS' : 'WORKFLOWS'}</span><h1>{view === 'catalog' ? t('skills') : packTitles[page]}</h1></div></div>
      {view === 'map' && <button type="button" className="sc-flow-open-library" onClick={() => openView('super-code-skills', '')}>{t('skills')} ↗</button>}<button type="button" className="sc-flow-refresh" onClick={() => refresh(value => value + 1)} disabled={native.status === 'loading'} aria-label={t('refresh')} title={t('refresh')}>↻</button></header>
    {view === 'map' ? pageRecipes.length > 1 && <nav className="sc-flow-routes" aria-label={t('routes')}>{pageRecipes.map(item => <button type="button" key={item.id} aria-current={route.id === item.id ? 'page' : undefined} onClick={() => selectRoute(item)}>{localized(item.title, language)}</button>)}</nav> : <nav className="sc-flow-packages" aria-label={t('worlds')}><button type="button" aria-pressed={!pack} onClick={() => setPack('')}>{t('all')} {availableSkills.length}</button>{catalog.filter(item => availableSkills.some(skill => skill.pack === item.id)).map(item => <button type="button" key={item.id} aria-pressed={pack === item.id} onClick={() => { setPack(item.id); choose(null, false); }}><strong>{item.title}</strong><span>{availableSkills.filter(skill => skill.pack === item.id).length}</span></button>)}</nav>}
    {error && <p className="sc-flow-alert" role="alert">{error}</p>}{native.status !== 'ready' && <p className="sc-flow-alert" role={native.status === 'failed' ? 'alert' : 'status'}>{t(native.status)}</p>}
    <main className="sc-flow-main">{view === 'map' ? <>
      <section className="sc-flow-goal"><div><span className="sc-flow-eyebrow">{t('goal')}</span><h2>{run.goal || facts.goal || t('noGoal')}</h2></div><details><summary>{t('editGoal')}</summary><form onSubmit={event => { event.preventDefault(); if (commitRun(run, 'goal')) setNotice(t('recordSaved')); }}><label>{t('goal')}<textarea aria-label={t('goal')} rows={2} maxLength={4000} value={run.goal} placeholder={facts.goal || t('goalHint')} onChange={event => setDrafts(previous => ({ ...previous, [route.id]: { ...previous[route.id], goal: event.target.value } }))} /></label><button type="submit">{t('saveRecord')}</button></form></details></section>
      {page === 'pstack' ? <PStack onUsed={recordUse} recipe={route} run={persisted} goal={run.goal || facts.goal} facts={facts} openFile={openFile} inspectCall={inspectCall} openChat={() => openView('chat', '')} t={t}
        saveNote={(id, note) => save(previous => {
          const current = savedRoute(previous, sessionId, route.id);
          return recordProgress(previous, sessionId, route.id, { ...current, stages: { ...current.stages, [id]: { ...(current.stages[id] || emptyStage()), ...note } } });
        })} skills={availableSkills} native={native} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} />
      : page === 'openspec' ? <OpenSpec onUsed={recordUse} MarkdownText={MarkdownText} filesApi={filesApi} sessionId={sessionId} revision={revision} goal={run.goal || facts.goal} facts={facts} run={persisted} openFile={openFile} t={t}
        skills={availableSkills} native={native} api={api} useInput={useInput} inputActions={inputActions} openView={openView} />
      : <div className="sc-flow-workspace"><Board key={route.id} recipe={route} cards={cards} run={persisted} selected={index} choose={index => choose(selectionFor(route, cards[index]))} start={index => { if (saveRecord('active', index)) choose(selectionFor(route, cards[index])); }} edit={setEditing} add={add} t={t} notice={notice} chooseTool={name => choose({ id: `${route.pack}/${name}` })} />
        <div className="sc-flow-inspector">{editing ? <TaskEditor key={editing.id} card={editing} cards={cards} skills={availableSkills.filter(skill => skill.pack === route.pack && skill.userInvocable)} save={saveCard} close={() => setEditing(null)} move={cards.some(card => card.id === editing.id) ? direction => commitRun(moveCard({ ...persisted, cards }, editing.id, direction), '__cards') : null} t={t} /> : detail}
          <Execution facts={facts} openFile={openFile} inspectCall={inspectCall} openChat={() => openView('chat', '')} t={t} attachFile={mission ? path => {
            if (mission.record.files.includes(path)) return;
            if (mission.record.files.length === 16) { setError(t('fileLimit')); return; }
            updateRecord({ ...mission.record, files: [...mission.record.files, path] }); setNotice(t('fileAttached'));
          } : null} /></div></div>}
    </> : <div className="sc-flow-workspace" data-catalog=""><Catalog skills={availableSkills} native={native.skills} preferences={preferences} selected={selection?.id} choose={skill => choose({ id: skill.id })} pack={pack} titles={packTitles} t={t} />{detail}</div>}</main>
  </section>;
}
