import React, { useEffect, useRef, useState } from 'react';
import catalog from './catalog.json';
import { recipes, localized } from './recipes.js';
import { commandDraft, initialPreferences, recordProgress, savePreferences, skillAvailability } from './model.js';
import { Route, SkillDetail } from './Route.jsx';
import { Catalog } from './Catalog.jsx';
import { Landmark } from './MapArt.jsx';
import stylesheet from './style.css';

const allSkills = catalog.flatMap(pack => pack.skills.map(skill => ({ ...skill, pack: pack.id })));
const packTitles = Object.fromEntries(catalog.map(pack => [pack.id, pack.title]));
const selectionFor = (recipe, index) => ({ id: `${recipe.pack}/${recipe.steps[index].skill}`, index });

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

export function WorkflowLibrary({ api, subscribe, sessionId, useInput, inputActions, openView, t, storage = localStorage }) {
  const [initial] = useState(() => initialPreferences(storage)), [preferences, setPreferences] = useState(initial.value);
  const [error, setError] = useState(initial.error ? t('storageFailed') : ''), [native, setNative] = useState({ status: 'loading', skills: [] });
  const [revision, refresh] = useState(0), [view, setView] = useState('map');
  const [route, setRoute] = useState(() => recipes.find(item => item.id === initial.value.runs[sessionId]?.recipe) || recipes[0]);
  const [pack, setPack] = useState(route.pack), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  const [selection, setSelection] = useState(() => {
    const done = initial.value.runs[sessionId]?.routes[route.id] || [];
    const next = route.steps.findIndex(step => !done.includes(step.id));
    return selectionFor(route, next === -1 ? route.steps.length - 1 : next);
  });
  const container = useRef(null), latestPreferences = useRef(preferences);
  const language = t('language'), completed = preferences.runs[sessionId]?.routes[route.id] || [];
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
  const choose = (next, focus = true) => {
    setSelection(next); setCopied(false);
    if (focus && container.current.clientWidth <= 860) requestAnimationFrame(() => container.current?.querySelector('.sc-flow-detail')?.scrollIntoView({ block: 'start' }));
  };
  const selectRoute = recipe => {
    const done = latestPreferences.current.runs[sessionId]?.routes[recipe.id] || [];
    const next = recipe.steps.findIndex(step => !done.includes(step.id));
    setRoute(recipe); setPack(recipe.pack); setNotice('');
    choose(selectionFor(recipe, next === -1 ? recipe.steps.length - 1 : next), false);
    save(previous => recordProgress(previous, sessionId, recipe.id, done));
  };
  const changeView = next => {
    setView(next); setNotice(''); setCopied(false);
    if (next === 'map') { selectRoute(route); return; }
    setPack(''); choose(null, false);
  };
  const toggleComplete = () => {
    const previous = latestPreferences.current.runs[sessionId]?.routes[route.id] || [];
    const stepId = route.steps[selection.index].id, reopening = previous.includes(stepId);
    const done = reopening ? previous.filter(id => id !== stepId) : [...previous, stepId];
    if (!save(value => recordProgress(value, sessionId, route.id, done))) return;
    const next = route.steps.findIndex(step => !done.includes(step.id));
    setNotice(next === -1 ? t('finish') : `${t(reopening ? 'questReopened' : 'questCompleted')} · ${t('nextQuest')}：${localized(route.steps[next].title, language)}`);
  };
  const skill = allSkills.find(item => item.id === selection?.id), skillPack = catalog.find(item => item.id === skill?.pack);
  const mission = view === 'map' && selection?.index != null ? { index: selection.index, step: route.steps[selection.index], completed: completed.includes(route.steps[selection.index].id) } : null;
  const context = mission ? `${route.playbook ? `${t('playbookContext')}${route.playbook}\n` : ''}${t('draftContext')}${localized(route.title, language)} / ${localized(mission.step.title, language)}\n${t('questGoal')}：${localized(mission.step.goal, language)}\n${t('questOutput')}：${localized(mission.step.output, language)}` : '';
  const nextIndex = route.steps.findIndex(step => !completed.includes(step.id));
  return <section ref={container} className="sc-flows" data-conversation-composer-overlay="" data-world={view === 'map' ? route.pack : pack} lang={language} aria-label={t('title')}>
    <style>{stylesheet}</style>
    <header className="sc-flow-header"><div className="sc-flow-brand"><Landmark name="compass" /><div><span className="sc-flow-eyebrow">SUPER CODE</span><h1>{t('title')}</h1></div></div>
      <nav className="sc-flow-views" aria-label={t('view')}><button type="button" aria-pressed={view === 'map'} onClick={() => changeView('map')}>{t('map')}</button><button type="button" aria-pressed={view === 'catalog'} onClick={() => changeView('catalog')}>{t('skills')} <span>{allSkills.length}</span></button></nav>
      <button type="button" className="sc-flow-refresh" onClick={() => refresh(value => value + 1)} disabled={native.status === 'loading'} aria-label={t('refresh')} title={t('refresh')}>↻</button></header>
    <nav className="sc-flow-packages" aria-label={t('worlds')}>
      {view === 'catalog' && <button type="button" aria-pressed={!pack} onClick={() => setPack('')}>{t('all')} <span>{allSkills.length}</span></button>}
      {catalog.map(item => <button type="button" key={item.id} data-world={item.id} aria-pressed={pack === item.id} onClick={() => {
        if (view === 'map') { selectRoute(recipes.find(recipe => recipe.pack === item.id)); return; }
        setPack(item.id); choose(null, false);
      }}><Landmark name={{ mattpocock: 'compass', pstack: 'camp', openspec: 'tower', 'oil-ui': 'flask' }[item.id]} /><span><strong>{item.title}</strong><small>{t('world.' + item.id)}</small></span><span className="sc-flow-package-count">{item.skills.length}</span></button>)}
    </nav>
    {error && <p className="sc-flow-alert" role="alert">{error}</p>}{native.status !== 'ready' && <p className="sc-flow-alert" role={native.status === 'failed' ? 'alert' : 'status'}>{t(native.status)}</p>}
    <div className="sc-flow-body" data-view={view}>
      {view === 'map' && <nav className="sc-flow-routes" aria-label={t('routes')}><h2>{t('routes')}</h2>{recipes.filter(item => item.pack === pack).map((item, index) => {
        const done = preferences.runs[sessionId]?.routes[item.id] || [];
        return <button type="button" key={item.id} aria-current={route.id === item.id ? 'step' : undefined} onClick={() => selectRoute(item)}><span className="sc-flow-route-number">0{index + 1}</span><strong>{localized(item.title, language)}</strong><span>{done.length} / {item.steps.length} {t('confirmed')}</span><span className="sc-flow-route-ticks" aria-hidden="true">{item.steps.map((_, index) => <i key={index} data-complete={done.includes(item.steps[index].id)} />)}</span></button>;
      })}<div className="sc-flow-route-supplies"><span>{t('input')}</span><p>{localized(route.input, language)}</p><span>{t('routeOutput')}</span><p>{localized(route.output, language)}</p></div></nav>}
      <main className="sc-flow-main">{view === 'map' ? <Route recipe={route} completed={completed} selected={selection?.index} choose={index => choose(selectionFor(route, index))} t={t} notice={notice} chooseTool={name => choose({ id: `${route.pack}/${name}`, index: null })} />
        : <Catalog skills={allSkills} native={native.skills} preferences={preferences} selected={selection?.id} choose={skill => choose({ id: skill.id, index: null })} pack={pack} titles={packTitles} t={t} />}</main>
      {skill && <SkillDetail key={`${skill.id}-${selection.index}`} skill={skill} pack={skillPack} availability={skillAvailability(skill, native.skills)} favorite={preferences.favorites.includes(skill.id)} t={t} mission={mission} toggleComplete={toggleComplete} backLabel={t(view === 'map' ? 'back' : 'backToCatalog')}
        close={() => { if (view === 'catalog') choose(null, false); container.current.querySelector(view === 'map' ? '.sc-flow-route' : '.sc-flow-catalog').scrollIntoView({ block: 'start' }); }}
        toggleFavorite={() => save(previous => ({ ...previous, favorites: previous.favorites.includes(skill.id) ? previous.favorites.filter(id => id !== skill.id) : [...previous.favorites, skill.id] }))}
        nextQuest={mission?.completed && nextIndex !== -1 ? () => choose(selectionFor(route, nextIndex)) : null}
        compose={<>
          {useInput && inputActions && <Compose key={`${skill.id}-${selection.index}`} skill={skill} availability={skillAvailability(skill, native.skills)} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context}
            onUsed={() => save(previous => ({ ...previous, recent: [skill.id, ...previous.recent.filter(id => id !== skill.id)].slice(0, 12) }))} t={t} />}
          <button type="button" className="sc-flow-copy" onClick={() => { void navigator.clipboard.writeText(commandDraft(skill, '', context)).then(() => setCopied(true)).catch(() => setError(t('copyFailed'))); }}>{t(copied ? 'copied' : 'copy')}</button>
        </>} />}
    </div>
  </section>;
}
