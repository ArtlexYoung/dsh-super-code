import React, { useEffect, useMemo, useState } from 'react';
import { FileList } from '../git/FileList.jsx';
import { errorText, message } from '../locales.js';
import { Icon } from './Icon.jsx';

const empty = new Set();

export function useResultGroups(matches, scope) {
  const [folds, setFolds] = useState({});
  const closed = folds.scope === scope ? folds.closed : empty;
  const groups = useMemo(() => {
    const files = new Map();
    for (const item of matches) {
      if (!files.has(item.file)) files.set(item.file, { key: item.file, hits: [] });
      files.get(item.file).hits.push(item);
    }
    return [...files.values()];
  }, [matches]);
  const rows = useMemo(() => groups.flatMap(group => closed.has(group.key) ? [] : group.hits), [groups, closed]);
  function toggle(file) {
    const next = new Set(closed);
    if (!next.delete(file)) next.add(file);
    setFolds({ scope, closed: next });
  }
  return { groups, rows, closed, toggle };
}

export function MatchText({ item }) {
  const start = item.character - (item.sampleStart || 0), end = start + item.length;
  return <><span className="sc-wb-before-match">{item.lineText.slice(0, start)}</span><mark>{item.lineText.slice(start, end)}</mark><span className="sc-wb-after-match">{item.lineText.slice(end)}</span></>;
}

export function ResultFiles({ groups, closed, toggle, active, jump, Button, t }) {
  const [focused, setFocused] = useState(null);
  const index = Math.max(0, groups.findIndex(group => group.key === focused));
  const group = groups[index];
  function keydown(event) {
    if (!group || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const actions = {
      ArrowDown: () => setFocused(groups[Math.min(groups.length - 1, index + 1)].key), ArrowUp: () => setFocused(groups[Math.max(0, index - 1)].key),
      Home: () => setFocused(groups[0].key), End: () => setFocused(groups.at(-1).key),
      ArrowLeft: () => { if (!closed.has(group.key)) toggle(group.key); }, ArrowRight: () => { if (closed.has(group.key)) toggle(group.key); },
      Enter: () => jump(group),
    };
    if (actions[event.key]) { event.preventDefault(); event.stopPropagation(); actions[event.key](); }
  }
  const label = file => message(t, closed.has(file) ? 'expandSearchFile' : 'collapseSearchFile', { file });
  return <nav className="sc-wb-result-files" aria-label={t('searchFiles')} tabIndex={0} onKeyDown={keydown} onFocus={() => setFocused(value => value || active || groups[0]?.key)}>
    <FileList items={groups} rowHeight={32} focusKey={focused || active}>{item => <div className="sc-wb-result-group" data-active={active === item.key} data-focused={group === item}>
      <Button tabIndex={-1} aria-expanded={!closed.has(item.key)} title={label(item.key)} aria-label={label(item.key)} onClick={() => { setFocused(item.key); toggle(item.key); }}><Icon name="chevron" /></Button>
      <Button tabIndex={-1} title={item.key} aria-label={`${item.key} (${item.hits.length})`} onClick={() => { setFocused(item.key); jump(item); }}><span>{item.key}</span><small>{item.hits.length}</small></Button>
    </div>}</FileList>
  </nav>;
}

export function SearchContext({ item, workbench, t }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!item) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void workbench.searchContext(item, abort.signal).then(lines => {
        if (!abort.signal.aborted) setPreview({ item, lines });
      }).catch(error => { if (!abort.signal.aborted) setPreview({ item, error: errorText(error, t) }); });
    }, 90);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [item, workbench, t]);
  if (!item) return null;
  const current = preview?.item === item ? preview : null;
  return <section className="sc-wb-search-context" aria-label={t('searchContext')}><strong>{item.file}:{item.line + 1}</strong>
    {!current ? <small role="status">{t('loading')}</small> : current.error ? <small role="alert">{current.error}</small> : !current.lines ? <small role="status">{t('searchContextChanged')}</small> :
      <pre>{current.lines.map(line => <div key={line.number}><small>{line.number}</small><code>{line.number === item.line + 1 ? <MatchText item={item} /> : line.text}</code></div>)}</pre>}
  </section>;
}
