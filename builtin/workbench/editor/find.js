import { runScopeHandlers } from '@codemirror/view';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search';
import { message } from '../locales.js';

const MAX_COUNTED_LENGTH = 256 * 1024;
const MAX_COUNTED_MATCHES = 1000;
const panels = new WeakMap();

function matchesIn(state, query) {
  // 正则与大文件仍可查找，面板不为统计而额外扫描全文。
  if (!query.valid || query.regexp || state.doc.length > MAX_COUNTED_LENGTH) return null;
  const ranges = [];
  for (const match of query.getCursor(state)) {
    if (ranges.length === MAX_COUNTED_MATCHES) return { ranges, more: true };
    ranges.push(match);
  }
  return { ranges, more: false };
}

function matchStatus(matches, range, t) {
  if (!matches) return '';
  if (!matches.ranges.length) return t('findNoMatch');
  const count = `${matches.ranges.length}${matches.more ? '+' : ''}`;
  const index = matches.ranges.findIndex(match => match.from === range.from && match.to === range.to) + 1;
  return index ? `${index} / ${count}` : message(t, 'findCount', { count });
}

function findPanel(view, t) {
  const node = (tag, className, attributes = {}) => {
    const element = view.dom.ownerDocument.createElement(tag);
    if (className) element.className = className;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  };
  const button = (name, text, glyph, click) => {
    const control = node('button', '', { name, type: 'button', title: text, 'aria-label': text });
    control.textContent = glyph; control.onclick = click;
    return control;
  };
  const field = (name, text) => node('input', 'cm-textfield', { name, type: 'text', form: '', placeholder: text,
    'aria-label': text, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const dom = node('div', 'cm-search sc-wb-find', { role: 'search', 'aria-label': t('find') });
  const row = node('div', 'sc-wb-find-row'), replaceRow = node('div', 'sc-wb-find-row sc-wb-find-replace');
  const queryBox = node('div', 'sc-wb-find-field'), actions = node('div', 'sc-wb-find-actions');
  const input = field('search', t('find')), replacement = field('replace', t('replaceWith'));
  input.setAttribute('main-field', 'true');
  const status = node('span', 'sc-wb-find-status', { role: 'status' });
  const filters = [
    ['caseSensitive', t('caseSensitive'), 'Aa'], ['wholeWord', t('searchWord'), 'Ab'], ['regexp', t('searchRegexp'), '.*'],
  ].map(([name, text, glyph]) => [name, button(name, text, glyph, () => {
    setQuery({ [name]: !query[name] });
  })]);
  const previous = button('prev', t('searchPrevious'), '↑', () => findPrevious(view));
  const next = button('next', t('searchNext'), '↓', () => findNext(view));
  const all = button('select', t('searchAll'), t('searchAll'), () => selectMatches(view));
  const close = button('closeFind', t('close'), '×', () => { closeSearchPanel(view); view.focus(); });
  const disclosure = button('replaceMode', t('findToggleReplace'), '›', () => showReplace(replaceRow.hidden));
  const replace = button('replace', t('replace'), t('replace'), () => replaceNext(view));
  const replaceEvery = button('replaceAll', t('replaceAll'), t('replaceAll'), () => replaceAll(view));
  let query = getSearchQuery(view.state), matches = matchesIn(view.state, query);

  function showReplace(open) {
    replaceRow.hidden = !open;
    disclosure.setAttribute('aria-expanded', String(open));
  }
  function setQuery(change) {
    const updated = new SearchQuery({ ...query, ...change });
    if (!updated.eq(query)) view.dispatch({ effects: setSearchQuery.of(updated) });
  }
  function sync() {
    if (input.value !== query.search) input.value = query.search;
    if (replacement.value !== query.replace) replacement.value = query.replace;
    for (const [name, control] of filters) control.setAttribute('aria-pressed', String(query[name]));
    const invalid = Boolean(query.search) && !query.valid;
    input.setAttribute('aria-invalid', String(invalid));
    const text = invalid ? t('findInvalidPattern') : matchStatus(matches, view.state.selection.main, t);
    if (status.textContent !== text) status.textContent = text;
    status.hidden = !text;
    status.toggleAttribute('data-invalid', invalid);
    previous.disabled = next.disabled = replace.disabled = replaceEvery.disabled = !query.valid || matches?.ranges.length === 0;
    all.disabled = next.disabled || Boolean(matches?.more);
    disclosure.hidden = view.state.readOnly;
    if (view.state.readOnly) showReplace(false);
  }

  for (const [field, key] of [[input, 'search'], [replacement, 'replace']]) {
    field.addEventListener('input', event => { if (!event.isComposing) setQuery({ [key]: field.value }); });
    field.addEventListener('compositionend', () => setQuery({ [key]: field.value }));
  }
  dom.onkeydown = event => {
    if (event.isComposing) return;
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    else if (event.key === 'Enter' && (event.target === input || event.target === replacement)) {
      event.preventDefault();
      if (!next.disabled) {
        const run = event.target === replacement ? replaceNext : event.shiftKey ? findPrevious : findNext;
        run(view);
      }
    }
  };
  queryBox.append(input, ...filters.map(([, control]) => control));
  actions.append(status, previous, next, all, close);
  row.append(disclosure, queryBox, actions);
  replaceRow.append(replacement, replace, replaceEvery);
  dom.append(row, replaceRow); showReplace(false); sync();

  const panel = {
    dom, top: true,
    mount() { panels.set(view, panel); input.select(); },
    update(update) {
      const updated = getSearchQuery(update.state);
      if (update.docChanged || updated.search !== query.search || updated.regexp !== query.regexp
        || updated.wholeWord !== query.wholeWord || updated.caseSensitive !== query.caseSensitive) matches = matchesIn(update.state, updated);
      if (query !== updated || update.docChanged || update.selectionSet || update.state.readOnly !== update.startState.readOnly) {
        query = updated; sync();
      }
    },
    replace() { showReplace(true); replacement.focus(); replacement.select(); },
    destroy() { panels.delete(view); },
  };
  return panel;
}

export const fileSearch = t => search({ top: true, createPanel: view => findPanel(view, t) });

export function openReplacePanel(view) {
  const { readOnly } = view.state;
  if (readOnly || !panels.has(view)) openSearchPanel(view);
  if (!readOnly) panels.get(view)?.replace();
  return true;
}
