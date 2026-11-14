import { message } from '../locales.js';
import { hoverTooltip } from '@codemirror/view';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import { loadLanguage } from './languages.js';
import { syntaxTree } from '@codemirror/language';

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

export function symbolCard(item, language, t) {
  const card = node('article', '', 'documentation-card');
  const signature = node('pre', '', 'documentation-signature');
  const declaration = item.declaration;
  if (language.parser) {
    highlightCode(declaration, language.parser.parse(declaration), classHighlighter,
      (text, classes) => signature.append(node('span', text, classes)), () => signature.append('\n'));
  } else signature.textContent = declaration;
  card.append(signature);
  const docs = item.documentation;
  if (docs.description) card.append(node('p', docs.description, 'documentation-description'));
  if (docs.params.length) {
    card.append(node('h3', t('params')));
    const list = document.createElement('dl');
    for (const param of docs.params) {
      const term = document.createElement('dt');
      term.append(node('code', param.name));
      if (param.type) term.append(node('span', param.type, 'documentation-type'));
      list.append(term, node('dd', param.description));
    }
    card.append(list);
  }
  if (docs.returns) {
    card.append(node('h3', t('returns')));
    const value = node('p', '', 'documentation-return');
    if (docs.returns.type) value.append(node('code', docs.returns.type), ' ');
    value.append(document.createTextNode(docs.returns.description)); card.append(value);
  }
  if (docs.extra.length) card.append(node('pre', docs.extra.join('\n'), 'documentation-extra'));
  card.append(node('small', message(t, 'sourceLocation', {file:item.file,line:item.line+1})));
  return card;
}

export function signatureTooltip(request, getFile, t) {
  return hoverTooltip(async (view, pos, side) => {
    const state = view.state, file = getFile();
    if (commentAt(state, pos, side)) return null;
    const word = wordAt(state.doc, pos);
    if (!word.word || pos === word.from && side < 0 || pos === word.to && side > 0) return null;
    if (state.selection.ranges.some(range => !range.empty && range.from < word.to && range.to > word.from)) return null;
    const symbols = await request('definition', { file, text: state.doc.toString(), word: word.word });
    const languages = await Promise.all(symbols.map(async item => {
      const support = await loadLanguage(item.file); return support.language || support;
    }));
    if (!symbols.length || state.doc !== view.state.doc || file !== getFile()) return null;
    return {
      pos: word.from, end: word.to, above: true,
      create() {
        const dom = document.createElement('div'); dom.className = 'signature-tooltip'; dom.setAttribute('role', 'tooltip');
        if (symbols.length > 1) dom.append(node('p', `${t('candidates')} · ${symbols.length}`, 'documentation-candidates'));
        symbols.forEach((item, index) => dom.append(symbolCard(item, languages[index], t)));
        return { dom };
      },
    };
  }, { hoverTime: 250, hideOnChange: true });
}
