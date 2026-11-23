import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { errorText, message } from '../locales.js';
import { FileList } from '../git/FileList.jsx';
import { Settings } from './Settings.jsx';
import { GitPanel } from '../git/Panel.jsx';
import { CodeHistory } from '../git/History.jsx';
import { Replace } from './Replace.jsx';
import { FileAction } from './FileActions.jsx';
import { Comparison } from '../git/Changes.jsx';
import { Icon } from './Icon.jsx';
import { SearchOptions } from './SearchOptions.jsx';
import { searchQueryKey } from '../../../src/workbench/search-query.ts';
import { FileCompare } from './FileCompare.jsx';
import { LibrarySource } from './LibrarySource.jsx';
import { SaveConflict } from './SaveConflict.jsx';
import { Drafts } from './Drafts.jsx';
import { MatchText, ResultFiles, SearchContext, useResultGroups } from './SearchResults.jsx';
import { Navigator } from './Navigator.jsx';

const emptyResults = { matches: [] };

export function Locations({ data, search, workbench, Button, t }) {
  const { searchQuery } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const text = searchQuery.search, queryKey = searchQueryKey(searchQuery), setText = search => workbench.setSearchQuery({ search });
  const [found, setFound] = useState({ matches: [] }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(0);
  const id = useId(), input = useRef(null), list = useRef(null);
  const [selection, setSelection] = useState(null), [visible, setVisible] = useState([]);
  
  useEffect(() => { if (!search) list.current.focus(); }, [search, data?.id]);
  useEffect(() => {
    if (!search) return;
    const abort = new AbortController(); setError(''); setBusy(!!text); setCount(0); setSelection(null);
    if (!text) { setFound({ query: queryKey, matches: [] }); return; }
    const timer = setTimeout(() => {
      const matches = []; let completion, published = 0, yielding = performance.now();
      const publishMatches = () => { published = performance.now(); setCount(matches.length); setFound({ query: queryKey, matches: matches.slice() }); };
      void (async () => {
        for await (const event of workbench.searchProject({ ...searchQuery, locations: true }, abort.signal)) {
          if (abort.signal.aborted) return;
          if (event.kind === 'matches') { for (const item of event.matches) matches.push({ ...item, file: event.path, key: `location:${matches.length}` }); if (!published || performance.now() - published >= 100) publishMatches(); }
          else if (event.kind === 'done') completion = event;
          if (performance.now() - yielding >= 12) {
            await new Promise(resolve => setTimeout(resolve, 0)); yielding = performance.now();
            if (abort.signal.aborted) return;
          }
        }
        if (!abort.signal.aborted) {
          if (!completion) throw new Error('WORKBENCH_REMOTE');
          setFound({ query: queryKey, matches, ...completion });
        }
      })().catch(failure => { if (!abort.signal.aborted) { setFound({ query: queryKey, matches: [] }); setError(errorText(failure, t)); } })
        .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [queryKey, search, workbench, t]);
  const result = search ? found.query === queryKey ? found : emptyResults : data;
  const hits = useMemo(() => search ? result.matches || [] : (result.matches || []).map((item, index) => ({ ...item, key: `location:${index}` })), [result.matches, search]);
  const scope = search ? queryKey : data.id;
  const grouped = useResultGroups(search ? hits : emptyResults.matches, scope), rows = search ? grouped.rows : hits;
  const [context, setContext] = useState(false);
  const index = selection?.scope === scope ? Math.max(0, rows.findIndex(row => row.key === selection.key)) : 0, active = rows[index];
  const activeId = visible.some(item => item.key === active?.key) ? `${id}-${index}` : undefined;
  const choose = next => setSelection({ scope, key: rows[Math.max(0, Math.min(rows.length - 1, next))]?.key });
  const jump = group => {
    if (grouped.closed.has(group.key)) grouped.toggle(group.key);
    setSelection({ scope, key: group.hits[0].key }); list.current?.focus();
  };
  const visit = item => {
    const panel = workbench.snapshot().panel;
    void workbench.visit(item).then(() => {
      if (!search && workbench.snapshot().panel?.id === panel?.id) workbench.panel(null);
    }).catch(workbench.fail);
  };
  function keydown(event) {
    if (event.nativeEvent.isComposing || ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].some(key => event[key]) || !active) return;
    const actions = { ArrowUp: () => choose(index - 1), ArrowDown: () => choose(index + 1), Enter: () => visit(active) };
    if (event.currentTarget === list.current) { actions.Home = () => choose(0); actions.End = () => choose(rows.length - 1); }
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault(); event.stopPropagation(); action();
  }
  return <div className="sc-wb-locations">
    {search && <div className="sc-wb-search-header"><label className="sc-wb-search-field"><Icon name="find" /><input ref={input} autoFocus role="combobox" aria-label={t('search')} placeholder={t('searchPlaceholder')} autoComplete="off" spellCheck={false}
      aria-expanded={true} aria-autocomplete="list" aria-controls={id} aria-activedescendant={activeId} value={text} onChange={event => setText(event.target.value)} onKeyDown={keydown} />
      {text && <Button title={t('clearFileSearch')} aria-label={t('clearFileSearch')} onClick={() => { setText(''); input.current.focus(); }}><Icon name="close" /></Button>}</label>
      <SearchOptions query={searchQuery} change={workbench.setSearchQuery} workbench={workbench} Button={Button} t={t} />
      <span role="status">{busy ? `${t('working')} · ${count} ${t('searchMatches')}` : `${hits.length} ${t('searchMatches')}`}</span><Button aria-pressed={context} onClick={() => setContext(!context)}>{t('searchContext')}</Button></div>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">{t('working')}</p>}
    <div className="sc-wb-result-body">{search && grouped.groups.length > 0 && <ResultFiles {...grouped} active={active?.file} jump={jump} Button={Button} t={t} />}
    <div ref={list} id={id} role="listbox" aria-label={t('locationResults')} aria-busy={busy} aria-activedescendant={activeId} tabIndex={0} className="sc-wb-location-list" onKeyDown={keydown}>
    {!!rows.length && <FileList key={scope} className="sc-wb-results" items={rows} rowHeight={36} focusKey={active?.key} visible={setVisible}>{(item, row) => <Button id={`${id}-${row}`} role="option" aria-selected={row === index} aria-posinset={row + 1} aria-setsize={rows.length} tabIndex={-1}
      onClick={() => { choose(row); visit(item); }} title={`${item.file}:${item.line + 1}`}>
      <span className="sc-wb-result-path">{item.file}<small>{item.line + 1}</small></span><code>{search ? <MatchText item={item} /> : item.lineText || item.declaration || item.name}</code>
    </Button>}</FileList>}{!rows.length && !busy && !error && <div className="sc-wb-location-empty" role="status"><span>{t(hits.length ? 'searchFilesFolded' : 'noResults')}</span>{!search && <small>{t('definitionEnvironmentHint')}</small>}</div>}</div>
    </div>{search && context && <SearchContext item={active} workbench={workbench} t={t} />}
    <footer>{hits.length} · {search ? result.scanned === undefined ? '' : message(t, 'replaceScope', { count: result.scanned, skipped: result.skipped }) : t('usageNote')}{result.truncated && <span>{t('searchLimit')}</span>}
      {!!rows.length && <span className="sc-wb-location-keys">{t('locationKeys')}</span>}</footer>
  </div>;
}


const panelComponents = new Map([['drafts', Drafts], ['git', GitPanel], ['projectReplace', Replace], ['lineHistory', CodeHistory], ['fileCompare', FileCompare], ['saveConflict', SaveConflict], ['navigate', Navigator]]);

export function PanelContent({ panel, workbench, Button, Select, t, toggleFocus }) {
  const { preferences } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const props = { workbench, Button, Select, t, palette: preferences.palette };
  const Component = panelComponents.get(panel.kind);
  if (Component) return <Component {...props} panel={panel} toggleFocus={toggleFocus} />;
  switch (panel.kind) {
    case 'settings': return <Settings {...props} preferences={preferences} />;
    case 'library': return <LibrarySource target={panel.target} preferences={preferences} t={t} />;
    case 'fileAction': return <FileAction {...props} dialog={panel} />;
    case 'diff': return <Comparison {...props} comparison={panel} />;
    default: return <Locations {...props} data={panel} search={panel.kind === 'search'} />;
  }
}
