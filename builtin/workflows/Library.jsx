import React, { useEffect, useRef, useState } from 'react';
import catalog from './catalog.json';
import { recipes, localized } from './recipes.js';
import { commandDraft, initialPreferences, recordProgress, savePreferences, skillAvailability, emptyRoute, emptyStage, changeStage, nextStageIndex } from './model.js';
import { Route, SkillDetail } from './Route.jsx';
import { Catalog } from './Catalog.jsx';
import { Execution } from './Execution.jsx';
import { executionFacts } from './execution.js';
import { fileTarget, WORKBENCH_VIEW } from '../workbench/file-links.js';
import stylesheet from './style.css';

const allSkills = catalog.flatMap(pack => pack.skills.map(skill => ({ ...skill, pack: pack.id })));
const packTitles = Object.fromEntries(catalog.map(pack => [pack.id, pack.title]));
const selectionFor = (recipe, index) => ({ id: `${recipe.pack}/${recipe.steps[index].skill}`, index });
const savedRoute = (preferences, sessionId, recipeId) => preferences.runs[sessionId]?.routes[recipeId] || emptyRoute();

function Compose({ skill, availability, api, sessionId, useInput, inputActions, openView, context, onUsed, t }) {
  const input = useInput(state => state), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef(input), lifetime = useRef(null);
  latest.current = input;
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => abort.abort(); }, []);
  const locked = input.phase !== 'plain' || input.attachmentIds?.length > 0 || input.occurrences?.length > 0;
  const insert = async () => {
    setBusy(true); setError('');
    try {
      const response = await api.list({ sessionId }, lifetime.current.signal);
      if (lifetime.current.signal.aborted) return;
      if (!response.ok || skillAvailability(skill, response.value.skills) !== 'ready') throw new Error('Unavailable');
      const current = latest.current;
      if (current.phase !== 'plain' || current.attachmentIds?.length || current.occurrences?.length) throw new Error('Draft is busy');
      inputActions.setDraft(commandDraft(skill, current.draft, context));
      onUsed(); openView('chat', '');
    } catch { if (!lifetime.current.signal.aborted) setError(t('draftFailed')); }
    finally { if (!lifetime.current.signal.aborted) setBusy(false); }
  };
  return <><button type="button" className="sc-flow-primary" disabled={availability !== 'ready' || locked || busy} onClick={insert}>{t('use')}</button>
    {locked && <p className="sc-flow-note">{t('richDraft')}</p>}{error && <p role="alert">{error}</p>}</>;
}

export function WorkflowLibrary({ api, subscribe, sessionId, useSessions, useInput, inputActions, openView, inspectCall, hasWorkbench, t, storage = localStorage }) {
  const [initial] = useState(() => initialPreferences(storage)), [preferences, setPreferences] = useState(initial.value);
  const [error, setError] = useState(initial.error ? t('storageFailed') : ''), [native, setNative] = useState({ status: 'loading', skills: [] });
  const [revision, refresh] = useState(0), [view, setView] = useState('map');
  const [route, setRoute] = useState(() => recipes.find(item => item.id === initial.value.runs[sessionId]?.recipe) || recipes[0]);
  const [pack, setPack] = useState(route.pack), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false), [drafts, setDrafts] = useState({});
  const [selection, setSelection] = useState(() => {
    const next = nextStageIndex(route, savedRoute(initial.value, sessionId, route.id));
    return selectionFor(route, next === -1 ? route.steps.length - 1 : next);
  });
  const sessions = useSessions(state => state), facts = executionFacts(sessions, sessionId);
  const container = useRef(null), latestPreferences = useRef(preferences);
  const language = t('language'), persisted = savedRoute(preferences, sessionId, route.id), draft = drafts[route.id];
  const run = { ...persisted, goal: draft?.goal ?? persisted.goal };
  useEffect(() => subscribe(() => refresh(value => value + 1)), [subscribe]);
  useEffect(() => {
    const abort = new AbortController(); setNative({ status: 'loading', skills: [] });
    void api.list({ sessionId }, abort.signal).then(response => {
      if (abort.signal.aborted) return;
      if (!response.ok) throw new Error('Unavailable');
      setNative({ status: 'ready', skills: response.value.skills });
    }).catch(() => { if (!abort.signal.aborted) setNative({ status: 'failed', skills: [] }); });
    return () => abort.abort();
  }, [api, sessionId, revision]);
  const save = update => {
    try {
      const next = savePreferences(storage, update(latestPreferences.current));
      latestPreferences.current = next; setPreferences(next); setError(''); return true;
    } catch { setError(t('storageFailed')); return false; }
  };
  const commitRun = (next, field) => {
    if (!save(previous => recordProgress(previous, sessionId, route.id, next))) return false;
    setDrafts(previous => {
      const remaining = { ...previous[route.id] };
      delete remaining[field];
      return { ...previous, [route.id]: remaining };
    });
    return true;
  };
  const choose = (next, focus = true) => {
    setSelection(next); setCopied(false);
    if (focus && container.current.clientWidth <= 860) requestAnimationFrame(() => container.current?.querySelector('.sc-flow-detail')?.scrollIntoView({ block: 'start' }));
  };
  const selectRoute = recipe => {
    const current = savedRoute(latestPreferences.current, sessionId, recipe.id), next = nextStageIndex(recipe, current);
    setRoute(recipe); setPack(recipe.pack); setNotice('');
    choose(selectionFor(recipe, next === -1 ? recipe.steps.length - 1 : next), false);
    save(previous => recordProgress(previous, sessionId, recipe.id, current));
  };
  const changeView = next => {
    setView(next); setNotice(''); setCopied(false);
    if (next === 'map') { selectRoute(route); return; }
    setPack(''); choose(null, false);
  };
  const skill = allSkills.find(item => item.id === selection?.id), skillPack = catalog.find(item => item.id === skill?.pack);
  const mission = view === 'map' && selection?.index != null ? { index: selection.index, step: route.steps[selection.index],
    unsaved: Boolean(draft?.[route.steps[selection.index].id]),
    record: { ...(run.stages[route.steps[selection.index].id] || emptyStage()), ...draft?.[route.steps[selection.index].id] }, previous: route.steps[selection.index - 1],
    previousCompleted: run.stages[route.steps[selection.index - 1]?.id]?.status === 'completed' } : null;
  const updateRecord = ({ result, blocker, files }) => setDrafts(previous => ({ ...previous, [route.id]: { ...previous[route.id], [mission.step.id]: { result, blocker, files } } }));
  const saveRecord = status => {
    const next = changeStage(persisted, mission.step.id, { ...mission.record, status });
    if (commitRun(next, mission.step.id)) setNotice(t(status === 'completed' ? 'stageAccepted' : 'recordSaved'));
  };
  const openFile = path => {
    if (!hasWorkbench()) { setError(t('enableWorkbench')); return; }
    openView(WORKBENCH_VIEW, JSON.stringify(fileTarget(path, {}, { cwd: facts.cwd })));
  };
  const context = mission ? `${route.playbook ? `${t('playbookContext')}${route.playbook}\n` : ''}${t('draftContext')}${localized(route.title, language)} / ${localized(mission.step.title, language)}\n${t('questGoal')}：${localized(mission.step.goal, language)}\n${t('questOutput')}：${localized(mission.step.output, language)}${run.goal ? `\n${t('goal')}：${run.goal}` : ''}${mission.previous && run.stages[mission.previous.id]?.result ? `\n${t('inputFrom')}：${run.stages[mission.previous.id].result}` : ''}` : '';
  const nextIndex = nextStageIndex(route, run);
  const detail = skill && <SkillDetail key={`${skill.id}-${selection.index}`} skill={skill} pack={skillPack} availability={skillAvailability(skill, native.skills)} favorite={preferences.favorites.includes(skill.id)} t={t} mission={mission} backLabel={t(view === 'map' ? 'back' : 'backToCatalog')}
    close={() => { if (view === 'catalog') choose(null, false); container.current.querySelector(view === 'map' ? '.sc-flow-route' : '.sc-flow-catalog').scrollIntoView({ block: 'start' }); }}
    toggleFavorite={() => save(previous => ({ ...previous, favorites: previous.favorites.includes(skill.id) ? previous.favorites.filter(id => id !== skill.id) : [...previous.favorites, skill.id] }))}
    updateRecord={updateRecord} saveRecord={saveRecord} openFile={openFile} choosePrevious={() => choose(selectionFor(route, mission.index - 1))}
    nextQuest={mission?.record.status === 'completed' && nextIndex !== -1 ? () => choose(selectionFor(route, nextIndex)) : null}
    compose={<>
      {useInput && inputActions && <Compose key={`${skill.id}-${selection.index}`} skill={skill} availability={skillAvailability(skill, native.skills)} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context}
        onUsed={() => save(previous => ({ ...previous, recent: [skill.id, ...previous.recent.filter(id => id !== skill.id)].slice(0, 12) }))} t={t} />}
      <button type="button" className="sc-flow-copy" onClick={() => { void navigator.clipboard.writeText(commandDraft(skill, '', context)).then(() => setCopied(true)).catch(() => setError(t('copyFailed'))); }}>{t(copied ? 'copied' : 'copy')}</button>
      {mission && mission.record.status !== 'active' && mission.record.status !== 'completed' && <button type="button" className="sc-flow-focus" onClick={() => saveRecord('active')}>{t('focusStage')}</button>}
    </>} />;
  return <section ref={container} className="sc-flows" data-conversation-composer-overlay="" data-world={view === 'map' ? route.pack : pack} lang={language} aria-label={t('title')}>
    <style>{stylesheet}</style>
    <header className="sc-flow-header"><div className="sc-flow-brand"><span className="sc-flow-logomark" aria-hidden="true">S</span><h1>{t('title')}</h1><span>SUPER CODE</span></div>
      <nav className="sc-flow-views" aria-label={t('view')}><button type="button" aria-pressed={view === 'map'} onClick={() => changeView('map')}>{t('map')}</button><button type="button" aria-pressed={view === 'catalog'} onClick={() => changeView('catalog')}>{t('skills')} <span>{allSkills.length}</span></button></nav>
      <button type="button" className="sc-flow-refresh" onClick={() => refresh(value => value + 1)} disabled={native.status === 'loading'} aria-label={t('refresh')} title={t('refresh')}>↻</button></header>
    <nav className="sc-flow-packages" aria-label={t('worlds')}>
      {view === 'catalog' && <button type="button" aria-pressed={!pack} onClick={() => setPack('')}>{t('all')} <span>{allSkills.length}</span></button>}
      {catalog.map(item => <button type="button" key={item.id} data-world={item.id} aria-pressed={pack === item.id} onClick={() => {
        if (view === 'map') { selectRoute(recipes.find(recipe => recipe.pack === item.id)); return; }
        setPack(item.id); choose(null, false);
      }}><strong>{item.title}</strong><span className="sc-flow-package-count">{item.skills.length}</span></button>)}
    </nav>
    {error && <p className="sc-flow-alert" role="alert">{error}</p>}{native.status !== 'ready' && <p className="sc-flow-alert" role={native.status === 'failed' ? 'alert' : 'status'}>{t(native.status)}</p>}
    <div className="sc-flow-body" data-view={view}>
      {view === 'map' && <nav className="sc-flow-routes" aria-label={t('routes')}><h2>{t('routes')}</h2>{recipes.filter(item => item.pack === pack).map((item, index) => {
        const stages = savedRoute(preferences, sessionId, item.id).stages;
        const done = item.steps.filter(step => stages[step.id]?.status === 'completed').length;
        return <button type="button" key={item.id} aria-current={route.id === item.id ? 'step' : undefined} onClick={() => selectRoute(item)}><span className="sc-flow-route-number">0{index + 1}</span><strong>{localized(item.title, language)}</strong><span>{done} / {item.steps.length} {t('confirmed')}</span></button>;
      })}<div className="sc-flow-route-supplies"><span>{t('input')}</span><p>{localized(route.input, language)}</p><span>{t('routeOutput')}</span><p>{localized(route.output, language)}</p></div></nav>}
      <main className="sc-flow-main">{view === 'map' ? <>
        <section className="sc-flow-goal"><div><span className="sc-flow-eyebrow">{t('goal')}</span><h2>{run.goal || facts.goal || t('noGoal')}</h2></div><details><summary>{t('editGoal')}</summary><form onSubmit={event => { event.preventDefault(); if (commitRun(run, 'goal')) setNotice(t('recordSaved')); }}><label>{t('goal')}<textarea aria-label={t('goal')} rows={2} maxLength={4000} value={run.goal} placeholder={facts.goal || t('goalHint')} onChange={event => setDrafts(previous => ({ ...previous, [route.id]: { ...previous[route.id], goal: event.target.value } }))} /></label><button type="submit">{t('saveRecord')}</button></form></details></section>
        <Route recipe={route} run={persisted} selected={selection?.index} choose={index => choose(selectionFor(route, index))} t={t} notice={notice} chooseTool={name => choose({ id: `${route.pack}/${name}`, index: null })} />
        <div className="sc-flow-workspace">{detail}<Execution facts={facts} openFile={openFile} inspectCall={inspectCall} openChat={() => openView('chat', '')} t={t} attachFile={mission ? path => {
          if (mission.record.files.includes(path)) return;
          if (mission.record.files.length === 16) { setError(t('fileLimit')); return; }
          updateRecord({ ...mission.record, files: [...mission.record.files, path] }); setNotice(t('fileAttached'));
        } : null} /></div>
      </> : <div className="sc-flow-workspace"><Catalog skills={allSkills} native={native.skills} preferences={preferences} selected={selection?.id} choose={skill => choose({ id: skill.id, index: null })} pack={pack} titles={packTitles} t={t} />{detail}</div>}</main>
    </div>
  </section>;
}
