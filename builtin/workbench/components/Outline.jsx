import React, { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileList } from '../git/FileList.jsx';
import { syntaxTree } from '@codemirror/language';
import { displayScope, observeScope, outlineScopes, symbolAtOffset } from '../editor/scope.js';
import { message } from '../locales.js';
import { Icon } from './Icon.jsx';

function currentSymbol(symbols, context) {
  if (!context?.ready) return null;
  let result = null;
  for (const scope of context.path) {
    const symbol = symbolAtOffset(symbols, scope.head);
    if (symbol?.name === scope.name) result = symbol;
  }
  return result;
}

const MAX_OUTLINE_INDENT = 5;

export function Outline({ symbols, readerMode, workbench, Button, t }) {
  const input = useRef(null), id = useId();
  const view = workbench.view();
  const subscribe = useCallback(listener => {
    if (!view) return () => {};
    return observeScope(view, listener);
  }, [view]);
  const context = useSyncExternalStore(subscribe, () => view && displayScope(view));
  const tree = useSyncExternalStore(subscribe, () => view && syntaxTree(view.state));
  const scopes = useMemo(() => outlineScopes(view?.state, symbols), [view, tree, symbols]);
  const [text, setText] = useState(''), [functionsOnly, setFunctionsOnly] = useState(false);
  const [selection, setSelection] = useState(null), [visible, setVisible] = useState([]);
  const query = text.trim().toLowerCase();
  const searching = !!query || functionsOnly;
  const items = useMemo(() => {
    const qualified = query.includes('.');
    const rows = [];
    for (const symbol of symbols) {
      const scope = scopes.get(symbol.offset);
      if (functionsOnly && symbol.kind !== 'function' || !searching && readerMode && scope?.local) continue;
      const name = qualified && scope?.parent ? `${scope.parent}.${symbol.name}` : symbol.name;
      if (query && !name.toLowerCase().includes(query)) continue;
      rows.push({ key: `symbol:${symbol.offset}`, symbol, scope });
    }
    return rows;
  }, [symbols, scopes, query, functionsOnly, searching, readerMode]);
  const at = view?.state.selection;
  const { sourceKey, index, followKey } = useMemo(() => {
    const source = currentSymbol(symbols, context), sourceKey = source && `symbol:${source.offset}`;
    const chosen = selection && (query || selection.at === at && selection.context === context) && selection.key;
    const wanted = chosen || (!query && sourceKey), index = Math.max(0, items.findIndex(item => item.key === wanted));
    // 索引未追上源码时，首项仅作为键盘起点，不据此改变滚动位置。
    return { sourceKey, index, followKey: query ? items[index]?.key : wanted };
  }, [symbols, context, selection, query, items, at]);
  const active = items[index];
  const visibleActive = visible.find(item => item.key === active?.key);
  const choose = key => setSelection({ key, at, context });
  const visit = symbol => { void workbench.visit(symbol).catch(workbench.fail); };
  const clear = () => { setText(''); setSelection(null); input.current.focus(); };
  function keydown(event) {
    if (event.nativeEvent.isComposing || !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { if (text) clear(); else workbench.view()?.focus(); return; }
    if (!active) return;
    if (event.key === 'Enter') visit(active.symbol);
    else choose(items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].key);
  }
  return <div id="sc-wb-outline" className="sc-wb-explorer-content">
    <div className="sc-wb-outline-tools">
      <div className="sc-wb-file-search">
        <input ref={input} role="combobox" aria-label={t('outlineSearch')} placeholder={t('outlineSearch')} autoComplete="off" spellCheck={false}
          aria-expanded={true} aria-autocomplete="list" aria-controls={id} aria-activedescendant={visibleActive && `${id}-${visibleActive.symbol.offset}`}
          value={text} onChange={event => { setText(event.target.value); setSelection(null); }} onKeyDown={keydown} />
        {text && <Button title={t('outlineClear')} aria-label={t('outlineClear')} onClick={clear}><Icon name="close" /></Button>}
      </div>
      <Button className="sc-wb-outline-filter" title={t('outlineFunctions')} aria-label={t('outlineFunctions')} aria-pressed={functionsOnly}
        onClick={() => { setFunctionsOnly(!functionsOnly); setSelection(null); }}><Icon name="function" /></Button>
      {searching && <small className="sc-wb-outline-count" role="status" aria-label={message(t, 'outlineCount', { count: items.length, total: symbols.length })}>{items.length} / {symbols.length}</small>}
    </div>
    <div id={id} className="sc-wb-outline-results" role="listbox" aria-label={t('symbols')}>
      {!items.length && <p className="sc-wb-file-search-status">{t(searching ? 'noResults' : 'outlineEmpty')}</p>}
      <FileList key={`${query}:${functionsOnly}`} className="sc-wb-outline" items={items} rowHeight={27} focusKey={followKey} visible={setVisible}>
        {({ key, symbol, scope }, row) => {
          const kind = scope?.kind ?? (symbol.kind === 'function' ? 'function' : 'variable');
          const depth = searching ? 0 : scope?.depth ?? 0;
          const parent = scope?.parent;
          return <Button id={`${id}-${symbol.offset}`} role="option" aria-selected={key === active?.key} aria-current={key === sourceKey ? 'location' : undefined} aria-posinset={row + 1} aria-setsize={items.length}
            aria-label={parent ? `${parent}.${symbol.name}, ${symbol.line + 1}` : undefined}
            tabIndex={-1} title={parent ? `${parent}.${symbol.name}` : symbol.declaration || symbol.name} className="sc-wb-file sc-wb-outline-row"
            data-depth={depth} data-symbol-kind={kind} style={{ '--wb-outline-depth': Math.min(depth, MAX_OUTLINE_INDENT) }}
            onClick={() => { choose(key); visit(symbol); }}><Icon name={kind} /><span>{symbol.name}</span>
            {searching && parent && <small className="sc-wb-outline-context">{parent}</small>}<small className="sc-wb-outline-line">{symbol.line + 1}</small></Button>;
        }}
      </FileList>
    </div>
  </div>;
}
