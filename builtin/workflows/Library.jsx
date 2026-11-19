import React, { useEffect, useMemo, useRef, useState } from 'react';
import catalog from './catalog.json';
import { recipes, localized } from './recipes.js';
import { commandDraft, filterSkills, initialPreferences, savePreferences, skillAvailability } from './model.js';
import { Route, SkillDetail } from './Route.jsx';
import stylesheet from './style.css';

const allSkills = catalog.flatMap(pack => pack.skills.map(skill => ({ ...skill, pack: pack.id })));
const pageSize = 24;

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
  const [revision, refresh] = useState(0), [pack, setPack] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0);
  const [route, setRoute] = useState(() => recipes.find(item => item.id === initial.value.runs[sessionId]?.recipe) || recipes[0]);
  const [selected, setSelected] = useState(null), [step, setStep] = useState(null), [copied, setCopied] = useState(false);
  const container = useRef(null);
  const [selectionRevision, focusSelection] = useState(0);
  const language = t('language'), run = preferences.runs[sessionId];
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
  const save = patch => {
    try { const next = savePreferences(storage, { ...preferences, ...patch }); setPreferences(next); setError(''); }
    catch { setError(t('storageFailed')); }
  };
  const rows = useMemo(() => {
    const matches = filterSkills(allSkills, { query, pack, favorites: preferences.favorites, onlyFavorites: filter === 'favorites' });
    return filter === 'recent' ? preferences.recent.flatMap(id => matches.filter(skill => skill.id === id)) : matches;
  }, [query, pack, filter, preferences.favorites, preferences.recent]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const skill = allSkills.find(item => item.id === selected), skillPack = catalog.find(item => item.id === skill?.pack);
  const availability = skill ? skillAvailability(skill, native.skills) : 'unavailable';
  useEffect(() => {
    const detail = container.current?.querySelector('.sc-flow-detail');
    if (detail && container.current.clientWidth < 1020) detail.scrollIntoView({ block: 'start' });
  }, [selectionRevision]);
  const choose = (skill, index = null) => { setSelected(skill?.id || null); setStep(index); setCopied(false); focusSelection(value => value + 1); };
  const saveRun = completed => save({ runs: { ...Object.fromEntries(Object.entries(preferences.runs).filter(([id]) => id !== sessionId).slice(-31)), [sessionId]: { recipe: route.id, completed } } });
  const selectRoute = recipe => { setRoute(recipe); choose(null); };
  const context = step === null ? '' : `${t('draftContext')}${localized(route.title, language)} / ${route.steps[step][language === 'zh' ? 1 : 2]}`;
  return <section ref={container} className="sc-flows" lang={language} aria-label={t('title')}>
    <style>{stylesheet}</style>
    <header className="sc-flow-header"><div><span className="sc-flow-eyebrow">SUPER CODE</span><h1>{t('title')}</h1><p>{t('intro')}</p></div>
      <button type="button" onClick={() => refresh(value => value + 1)} disabled={native.status === 'loading'}>{t('refresh')}</button></header>
    <nav className="sc-flow-packages" aria-label={t('skills')}>
      <button type="button" aria-pressed={!pack} onClick={() => { setPack(''); setPage(0); }}>{t('all')} <span>{allSkills.length}</span></button>
      {catalog.map(item => <button type="button" key={item.id} aria-pressed={pack === item.id} onClick={() => { setPack(item.id); setPage(0); const recipe = recipes.find(recipe => recipe.pack === item.id); selectRoute(recipe); }}>
        {item.title}<span>{item.skills.length}</span></button>)}
    </nav>
    {error && <p className="sc-flow-alert" role="alert">{error}</p>}
    {native.status !== 'ready' && <p className="sc-flow-alert" role={native.status === 'failed' ? 'alert' : 'status'}>{t(native.status)}</p>}
    <div className="sc-flow-body">
      <nav className="sc-flow-routes" aria-label={t('routes')}><h2>{t('routes')}</h2>{recipes.filter(item => !pack || item.pack === pack).map(item =>
        <button type="button" key={item.id} aria-current={route.id === item.id ? 'step' : undefined} onClick={() => selectRoute(item)}><small>{catalog.find(pack => pack.id === item.pack).title}</small><strong>{localized(item.title, language)}</strong><span>{item.steps.length} {language === 'zh' ? '步' : 'steps'}</span></button>)}</nav>
      <main className="sc-flow-main">
        <Route recipe={route} run={run} t={t} choose={(name, index) => choose(allSkills.find(skill => skill.pack === route.pack && skill.name === name), index)}
          start={() => saveRun([])} toggle={index => saveRun(run.completed.includes(index) ? run.completed.filter(step => step !== index) : [...run.completed, index].sort((a, b) => a - b))} />
        <section className="sc-flow-catalog" aria-label={t('skills')}><div className="sc-flow-catalog-heading"><h2>{t('skills')}</h2><span>{rows.length}</span></div>
          <input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
          <div className="sc-flow-filters">{['all', 'favorites', 'recent'].map(id => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{t(id)}</button>)}</div>
          <ul className="sc-flow-skills">{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => <li key={item.id}><button type="button" aria-pressed={selected === item.id} onClick={() => choose(item)}>
            <span><strong>{item.name}</strong><small>{catalog.find(pack => pack.id === item.pack).title}</small></span><span className="sc-flow-status-dot" data-ready={skillAvailability(item, native.skills) === 'ready'} aria-label={t(skillAvailability(item, native.skills))} /></button></li>)}</ul>
          {!rows.length && <p role="status">{t('noResults')} <button type="button" onClick={() => { setQuery(''); setFilter('all'); setPack(''); }}>{t('clear')}</button></p>}
          {rows.length > pageSize && <nav className="sc-flow-pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('previous')}</button><span>{currentPage + 1} / {Math.ceil(rows.length / pageSize)}</span><button type="button" disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>{t('next')}</button></nav>}
        </section>
      </main>
      {skill && <SkillDetail skill={skill} pack={skillPack} availability={availability} favorite={preferences.favorites.includes(skill.id)} t={t}
        close={() => { choose(null); container.current.querySelector('.sc-flow-route').scrollIntoView({ block: 'start' }); }}
        toggleFavorite={() => save({ favorites: preferences.favorites.includes(skill.id) ? preferences.favorites.filter(id => id !== skill.id) : [...preferences.favorites, skill.id] })}
        compose={<>
          {useInput && inputActions && <Compose key={`${skill.id}-${step}`} skill={skill} availability={availability} api={api} sessionId={sessionId} useInput={useInput} inputActions={inputActions} openView={openView} context={context}
            onUsed={() => save({ recent: [skill.id, ...preferences.recent.filter(id => id !== skill.id)].slice(0, 12) })} t={t} />}
          <button type="button" onClick={() => { void navigator.clipboard.writeText(commandDraft(skill, '', context)).then(() => setCopied(true)).catch(() => setError(t('copyFailed'))); }}>{t(copied ? 'copied' : 'copy')}</button>
        </>} />}
    </div>
  </section>;
}
