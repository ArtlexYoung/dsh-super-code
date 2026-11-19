import { Facet } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { foldable, foldedRanges, foldEffect, foldNodeProp, highlightingFor, syntaxTree, unfoldEffect } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { declarationKind, readingScopeHead, updateReadingScope } from './scope.js';
import { foldMarker } from './folding.js';

const MAX_STICKY_LINES = 3;
const MAX_HEADER_LENGTH = 1024;
const BODY = /^(?:Block|Body|ClassBody|CompoundStatement|ConstructorBody|FieldDeclarationList|DeclarationList)$/;
const LINE_EDGE_TOLERANCE = 0.5;
// CodeMirror 的固定行号栏在第 200 层，标题和折叠按钮需要覆盖它。
const STICKY_LAYER = 201;

export const viewportOptions = Facet.define({ combine: ([options]) => options ?? { stickyScroll: true, readerMode: false } });

function firstSourceCharacter(line) { return line.from + Math.max(0, line.text.search(/\S/)); }

export function scopeLines(state, position, includeHeading = false) {
  const line = state.doc.lineAt(position), result = [];
  const point = firstSourceCharacter(line);
  for (let node = syntaxTree(state).resolveInner(point, 1); node; node = node.parent) {
    if (/comment|string/i.test(node.name)) continue;
    // 多行签名的参数与正文是兄弟节点。签名被遮挡时也用正文的折叠边界取标题。
    const body = includeHeading && declarationKind(node) && node.lastChild;
    const owner = body && body.from >= position && BODY.test(body.name) ? body : node;
    const fold = owner.type.prop(foldNodeProp)?.(owner, state);
    if (!fold || (!includeHeading && fold.from >= position) || fold.to < position) continue;
    const start = BODY.test(owner.name) && owner.parent ? owner.parent.from : owner.from;
    const header = state.doc.lineAt(start);
    if (header.number <= line.number && (includeHeading || header.number < line.number) && result.at(-1)?.from !== header.from) {
      const to = Math.min(fold.from, header.from + MAX_HEADER_LENGTH);
      result.push({ from: header.from, to, end: node.to, number: header.number, truncated: to < fold.from, fold });
    }
  }
  return result.reverse().slice(0, MAX_STICKY_LINES);
}

function visibleHeadings(view, top, limit, rowHeight) {
  const rows = [];
  // 外层标题本身会盖住一行。下一层按尚可见的首行计算，避免漏掉其方法签名。
  for (let index = 0; index < limit; index++) {
    const edge = top + index * rowHeight;
    const block = view.lineBlockAtHeight(edge + LINE_EDGE_TOLERANCE);
    const candidates = scopeLines(view.state, block.from, true), row = candidates[index];
    if (!row || rows.some((parent, depth) => parent.from !== candidates[depth].from)
      || view.lineBlockAt(row.from).top >= edge || view.lineBlockAt(row.end).bottom <= edge + rowHeight) break;
    rows.push(row);
  }
  return rows;
}

function firstReadableBlock(view, edge, rowHeight) {
  const block = view.lineBlockAtHeight(edge + LINE_EDGE_TOLERANCE);
  // 只露出一小截的行仍需要在粘性签名里显示。
  return block.bottom - edge < rowHeight / 2 ? view.lineBlockAtHeight(block.bottom + LINE_EDGE_TOLERANCE) : block;
}

function readingPosition(view, box, reserved, body) {
  const { main, ranges } = view.state.selection;
  if (ranges.length !== 1 || !main.empty || box.height <= reserved) return null;
  const caret = view.coordsAtPos(main.head);
  if (caret && caret.bottom > box.top + reserved + LINE_EDGE_TOLERANCE && caret.top < box.bottom) return null;
  return firstSourceCharacter(view.state.doc.lineAt(body.from));
}

function signaturePart(text, from = 0, to = text.length) {
  return text.slice(from, to).replace(/[ \t]*\n[ \t]*/g, (gap, offset) => {
    const index = from + offset;
    return /[([{]/.test(text[index - 1]) || /[)\]},]/.test(text[index + gap.length]) ? '' : ' ';
  });
}

function highlightedLine(view, { from, to, drawnTo, truncated }, text) {
  const code = document.createElement('span'); code.className = 'cm-sticky-text';
  code.style.tabSize = String(view.state.tabSize);
  const part = (start, end) => signaturePart(text, start - from, end - from);
  let offset = from;
  highlightTree(syntaxTree(view.state), { style: tags => highlightingFor(view.state, tags) }, (start, end, classes) => {
    if (start > offset) code.append(part(offset, start));
    const span = document.createElement('span'); span.className = classes; span.textContent = part(start, end); code.append(span); offset = end;
  }, from, drawnTo);
  if (offset < drawnTo) code.append(part(offset, drawnTo));
  if (truncated || drawnTo < to) code.append('…');
  return code;
}

function foldAction(state, range, folded) {
  const { from, to } = range;
  let closed = false;
  folded.between(from, from, (start, end) => { if (start === from && end === to) closed = true; });
  if (closed) return 'unfoldCode';
  // 多行声明的折叠点在签名末尾。沿用正文折叠栏对该位置的判断。
  const line = state.doc.lineAt(from), available = foldable(state, line.from, line.to);
  return available?.from === from && available.to === to ? 'foldCode' : null;
}

class StickyLines {
  constructor(view, t, visit) {
    this.t = t; this.visit = visit;
    this.view = view; this.height = 0; this.rows = []; this.doc = null; this.theme = null; this.followViewport = true;
    this.anchor = document.createElement('div'); this.anchor.className = 'cm-sticky-anchor';
    this.dom = document.createElement('nav'); this.dom.className = 'cm-sticky'; this.dom.setAttribute('aria-label', t('stickyScroll')); this.dom.hidden = true;
    this.anchor.append(this.dom);
    this.configure(view.state.facet(viewportOptions).stickyScroll); this.measure();
  }
  configure(enabled) {
    // 标题属于滚动区，鼠标停在标题上也由浏览器原生滚动正文。
    if (enabled) this.view.scrollDOM.prepend(this.anchor);
    else { this.dom.hidden = true; this.anchor.remove(); this.height = 0; }
  }
  update(update) {
    const enabled = update.state.facet(viewportOptions).stickyScroll;
    if (enabled !== update.startState.facet(viewportOptions).stickyScroll) this.configure(enabled);
    // CodeMirror 先应用选区，再滚到目标行。先显示新光标处的作用域。
    if (update.selectionSet) this.followViewport = false;
    if (update.docChanged || update.viewportChanged || update.geometryChanged || update.transactions.length) this.measure();
  }
  scroll() { this.followViewport = true; this.measure(); }
  jump(line) {
    const view = this.view, { main } = view.state.selection;
    if (main.empty && view.state.selection.ranges.length === 1 && readingScopeHead(view) === null) {
      const box = view.scrollDOM.getBoundingClientRect(), caret = view.coordsAtPos(main.head);
      const top = box.top + this.height;
      // 光标还留在屏外时，后退应回到正在看的段落。
      if (!caret || caret.top < top || caret.bottom > box.bottom) {
        const anchor = view.posAtCoords({ x: box.left + this.gutter * view.scaleX, y: (top + box.bottom) / 2 }, false);
        if (anchor !== main.head) view.dispatch({ selection: { anchor } });
      }
    }
    view.focus();
    this.visit(line);
  }
  toggleFold(row) {
    const view = this.view;
    if (view.state.doc !== this.doc) return;
    const { from } = row.fold;
    const effect = row.action === 'foldCode' ? foldEffect : unfoldEffect;
    // 折叠后保留占位符在正文中，避免收起时变化的粘性条盖住它。
    view.dispatch({ effects: [effect.of(row.fold), EditorView.scrollIntoView(from, { y: 'center' })] });
    view.focus();
  }
  measure() {
    this.view.requestMeasure({ key: this, read: view => {
      const box = view.scrollDOM.getBoundingClientRect(), { stickyScroll, readerMode } = view.state.facet(viewportOptions);
      const top = box.top - view.documentTop;
      // CodeMirror 的行高及标题遮挡量都用屏幕坐标。
      const rowHeight = view.defaultLineHeight;
      const limit = stickyScroll ? Math.min(MAX_STICKY_LINES, Math.max(0, Math.floor(box.height / rowHeight) - 2)) : 0;
      const rows = visibleHeadings(view, top, limit, rowHeight);
      const height = rowHeight * rows.length;
      const follow = readerMode && this.followViewport;
      const body = rows.length || follow ? firstReadableBlock(view, top + height, rowHeight) : null;
      const reading = follow ? readingPosition(view, box, height, body) : null;
      if (!rows.length) return { rows, height, reading };
      const folding = view.scrollDOM.querySelector('.cm-foldGutter')?.getBoundingClientRect();
      const folded = folding && foldedRanges(view.state);
      for (const row of rows) {
        // 视口里已经露出的参数接在标题下面；第一行仍作为定位入口保留。
        row.drawnTo = Math.min(row.to, Math.max(view.state.doc.lineAt(row.from).to, body.from - 1));
        row.action = folded ? foldAction(view.state, row.fold, folded) : null;
      }
      const gutter = (view.scrollDOM.querySelector('.cm-gutters')?.getBoundingClientRect().width || 0) / view.scaleX;
      const numbers = view.scrollDOM.querySelector('.cm-lineNumbers');
      const numberPadding = numbers ? gutter - numbers.getBoundingClientRect().width / view.scaleX + parseFloat(getComputedStyle(numbers.firstElementChild).paddingRight) : 0;
      return { rows, height, reading, width: view.scrollDOM.clientWidth, gutter, numberPadding,
        foldLeft: folding ? (folding.left - box.left) / view.scaleX : 0, foldWidth: folding ? folding.width / view.scaleX : 0,
        doc: view.state.doc, tree: syntaxTree(view.state), theme: view.themeClasses };
    }, write: value => this.render(value) });
  }
  render(value) {
    const { rows } = value;
    this.height = value.height;
    updateReadingScope(this.view, value.reading);
    this.dom.hidden = !rows.length;
    if (!rows.length) return;
    this.gutter = value.gutter;
    this.dom.style.width = `${value.width}px`;
    this.dom.style.setProperty('--sticky-gutter', `${value.gutter}px`);
    this.dom.style.setProperty('--sticky-number-padding', `${value.numberPadding}px`);
    this.dom.style.setProperty('--sticky-fold-left', `${value.foldLeft}px`);
    this.dom.style.setProperty('--sticky-fold-width', `${value.foldWidth}px`);
    if (this.doc === value.doc && this.tree === value.tree && this.theme === value.theme && rows.length === this.rows.length && rows.every((row, i) => {
      const previous = this.rows[i];
      return row.from === previous.from && row.to === previous.to && row.drawnTo === previous.drawnTo && row.truncated === previous.truncated
        && row.action === previous.action && row.fold.from === previous.fold.from && row.fold.to === previous.fold.to;
    })) return;
    this.doc = value.doc; this.tree = value.tree; this.theme = value.theme; this.rows = rows;
    this.dom.replaceChildren(...rows.map(row => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cm-sticky-line';
      const text = this.view.state.doc.sliceString(row.from, row.to);
      button.title = signaturePart(text).trim() + (row.truncated ? '…' : '');
      const number = document.createElement('span'); number.className = 'cm-sticky-number'; number.textContent = String(row.number); number.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span'); content.className = 'cm-sticky-code'; content.append(highlightedLine(this.view, row, text));
      button.setAttribute('aria-label', `${row.number}: ${button.title}`);
      button.append(number, content);
      button.onclick = () => this.jump(row.number - 1);
      const heading = document.createElement('div'); heading.className = 'cm-sticky-row';
      if (row.action) {
        const fold = document.createElement('button'); fold.type = 'button'; fold.className = 'cm-sticky-fold';
        const open = row.action === 'foldCode';
        fold.title = this.t(row.action);
        fold.setAttribute('aria-label', fold.title + ' ' + row.number);
        fold.setAttribute('aria-expanded', String(open));
        fold.append(foldMarker(open));
        fold.onclick = () => this.toggleFold(row);
        heading.append(fold);
      }
      heading.append(button);
      return heading;
    }));
  }
  destroy() { updateReadingScope(this.view, null); this.anchor.remove(); }
}

export function stickyLines(t, visit) {
  const plugin = ViewPlugin.define(view => new StickyLines(view, t, visit), { eventHandlers: { scroll(_event, view) { view.plugin(plugin)?.scroll(); } } });
  return [plugin, EditorView.scrollMargins.of(view => ({ top: view.plugin(plugin)?.height || 0 })), EditorView.baseTheme({
    '.cm-sticky-anchor': { position: 'sticky', top: '0', left: '0', width: '0', height: '0', flex: 'none', zIndex: STICKY_LAYER },
    '.cm-sticky': { position: 'absolute', top: '0', left: '0', overflow: 'hidden', backgroundColor: 'var(--wb-sticky-bg,var(--wb-bg))', boxShadow: '0 1px var(--wb-line),var(--wb-sticky-shadow,0 3px 6px #0000000a)' },
    '.cm-sticky[hidden]': { display: 'none' },
    '.cm-sticky-line': { display: 'grid', gridTemplateColumns: 'var(--sticky-gutter) minmax(0,1fr)', width: '100%', minHeight: '0', height: 'auto', border: 'none', borderRadius: '0', padding: '0', gap: '0', color: 'inherit', background: 'transparent', font: 'inherit', lineHeight: 'inherit', textAlign: 'left', cursor: 'pointer' },
    '.cm-sticky-line:hover': { backgroundColor: 'var(--wb-hover)' },
    '.cm-sticky-row': { position: 'relative' },
    '.cm-sticky-fold': { position: 'absolute', zIndex: '1', top: '0', bottom: '0', left: 'var(--sticky-fold-left)', width: 'var(--sticky-fold-width)',
      display: 'grid', placeItems: 'center', minHeight: '0', padding: '0', border: '0', background: 'transparent', cursor: 'pointer' },
    '.cm-sticky-line:focus-visible,.cm-sticky-fold:focus-visible': { outline: '1px solid var(--wb-accent)', outlineOffset: '-1px' },
    '.cm-sticky-number': { color: 'var(--wb-muted)', textAlign: 'right', padding: '0 var(--sticky-number-padding) 0 0', backgroundColor: 'var(--wb-sticky-gutter,var(--wb-gutter))', fontVariantNumeric: 'tabular-nums' },
    '.cm-sticky-code': { display: 'block', overflow: 'hidden', minWidth: '0' },
    '.cm-sticky-text': { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
      whiteSpace: 'pre', padding: '0 var(--wb-code-inset,6px)' },
  })];
}
