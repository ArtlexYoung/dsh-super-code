import React, { useMemo, useState } from 'react';
import { filterSkills, skillAvailability } from './model.js';

export function Catalog({ skills, native, preferences, selected, choose, pack, t, titles }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const matches = filterSkills(skills, { query, pack, favorites: preferences.favorites, onlyFavorites: filter === 'favorites' });
    return filter === 'recent' ? preferences.recent.flatMap(id => matches.filter(skill => skill.id === id)) : matches;
  }, [query, pack, filter, preferences.favorites, preferences.recent, skills]);
  const pageSize = 24, currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  return <section className="sc-flow-catalog" aria-label={t('skills')}><header><div><span className="sc-flow-eyebrow">{t('collection')}</span><h2>{t('skills')} <span>{rows.length}</span></h2></div></header>
    <input type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
    <div className="sc-flow-filters">{['all', 'favorites', 'recent'].map(id => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{t(id)}</button>)}</div>
    <ul className="sc-flow-skills">{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => <li key={item.id}><button type="button" aria-pressed={selected === item.id} onClick={() => choose(item)}>
      <span><strong>{item.name}</strong><small>{titles[item.pack]}</small></span><span className="sc-flow-status-dot" data-ready={skillAvailability(item, native) === 'ready'} aria-label={t(skillAvailability(item, native))} /></button></li>)}</ul>
    {!rows.length && <p role="status">{t('noResults')} <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>{t('clear')}</button></p>}
    {rows.length > pageSize && <nav className="sc-flow-pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('previous')}</button><span>{currentPage + 1} / {Math.ceil(rows.length / pageSize)}</span><button type="button" disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>{t('next')}</button></nav>}
  </section>;
}
