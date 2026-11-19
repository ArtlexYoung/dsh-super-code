import { message } from '../locales.js';
import { hoverTooltip } from '@codemirror/view';
import { highlightCode } from '@lezer/highlight';
import { loadLanguage } from './languages.js';
import { highlightingFor, syntaxTree } from '@codemirror/language';
import { searchPanelOpen } from '@codemirror/search';
import { documentationContent } from './documentation.js';

export function commentAt(state, pos, side = 1) {
  for (let node = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) if (/comment/i.test(node.name)) return true;
  return false;
}

export function wordAt(source, pos) {
  const slice = (from, to) => typeof source === 'string' ? source.slice(from, to) : source.sliceString(from, to);
  let from = pos, to = pos;
  while (from > 0) {
    let start = Math.max(0, from - 128);
    if (start && /[\uDC00-\uDFFF]/.test(slice(start, start + 1))) start--;
    const chunk = slice(start, from), word = /[\p{L}\p{N}_$]+$/u.exec(chunk)?.[0] || '';
    from -= word.length;
    if (word.length < chunk.length) break;
  }
  while (to < source.length) {
    let end = Math.min(source.length, to + 128);
    if (end < source.length && /[\uD800-\uDBFF]/.test(slice(end - 1, end))) end++;
    const chunk = slice(to, end), word = /^[\p{L}\p{N}_$]*/u.exec(chunk)[0];
    to += word.length;
    if (word.length < chunk.length) break;
  }
  return { word: slice(from, to), from, to };
}

function node(tag, text, className) {
  const element = document.createElement(tag); element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function signatureTree(declaration, language) {
  const parser = language.parser;
  return parser ? (language.name === 'php' ? parser.configure({ top: 'Program' }) : parser).parse(declaration) : null;
}

function emphasize(signature, active) {
  if (!active) return;
  const walker = document.createTreeWalker(signature, NodeFilter.SHOW_TEXT), range = document.createRange();
  let position = 0, start = false;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const end = position + text.textContent.length;
    if (!start && active.from < end) { range.setStart(text, active.from - position); start = true; }
    if (start && active.to <= end) {
      range.setEnd(text, active.to - position);
      const mark = document.createElement('strong'); mark.className = 'documentation-active-parameter';
      mark.append(range.extractContents()); range.insertNode(mark); return;
    }
    position = end;
  }
}

export function symbolCard(item, language, t, state, { active = null, compact = false, candidate = false } = {}) {
  const card = node(candidate ? 'details' : 'article', '', 'documentation-card');
  const signature = node('pre', '', 'documentation-signature');
  const declaration = item.declaration;
  const tree = signatureTree(declaration, language);
  if (tree) {
    highlightCode(declaration, tree, { style: tags => highlightingFor(state, tags) },
      (text, classes) => signature.append(node('span', text, classes)), () => signature.append('\n'));
  } else signature.textContent = declaration;
  emphasize(signature, active);
  const header = candidate ? node('summary', '', 'documentation-option') : card;
  header.append(signature); if (candidate) card.append(header);
  const docs = item.documentation;
  card.append(documentationContent(compact ? { description: '', params: docs.params.filter(param => param.name === active?.name), returns: null, extra: [] } : docs, t));
  header.append(node('small', message(t, 'sourceLocation', {file:item.file,line:item.line+1})));
  return card;
}

export function signatureTooltip(request, getFile, t) {
  return hoverTooltip(async (view, pos, side) => {
    if (searchPanelOpen(view.state)) return null;
    const state = view.state, file = getFile();
    if (commentAt(state, pos, side)) return null;
    const word = wordAt(state.doc, pos);
    if (!word.word || pos === word.from && side < 0 || pos === word.to && side > 0) return null;
    if (state.selection.ranges.some(range => !range.empty && range.from < word.to && range.to > word.from)) return null;
    const symbols = await request('definition', { file, text: state.doc.toString(), word: word.word, offset: word.from });
    const languages = await Promise.all(symbols.map(async item => {
      const support = await loadLanguage(item.file); return support.language || support;
    }));
    if (!symbols.length || state.doc !== view.state.doc || file !== getFile()) return null;
    return {
      pos: word.from, end: word.to, above: true,
      create() {
        const dom = document.createElement('div'); dom.className = symbols.length > 1 ? 'signature-tooltip documentation-options' : 'signature-tooltip'; dom.setAttribute('role', 'tooltip');
        if (symbols.length > 1) dom.append(node('p', `${t('candidates')} · ${symbols.length}`, 'documentation-candidates'));
        symbols.forEach((item, index) => dom.append(symbolCard(item, languages[index], t, view.state, { candidate: symbols.length > 1 })));
        return { dom };
      },
    };
  }, { hoverTime: 250, hideOnChange: true, hideOn: transaction => searchPanelOpen(transaction.state) });
}
