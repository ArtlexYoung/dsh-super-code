import { countColumn, MapMode, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, lineNumberWidgetMarker } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { parseDocumentation } from '../analysis/documentation.js';
import { uniqueId } from '../id.js';
import { documentationContent } from './documentation.js';
import { foldMarker } from './folding.js';
import { extension } from './languages.js';

// 超长注释继续用编辑器的虚拟行显示，不构造整段 Markdown DOM。
const MAX_DOCUMENT_LENGTH = 16 * 1024;
const COMPACT_DOCUMENT_WIDTH = 360;
const LONG_SUMMARY_LENGTH = 80;
const MAX_INDENT_SHARE = .2;

function docstringText(raw) {
  const quote = /^[ru]?("""|''')/i.exec(raw);
  if (!quote || !raw.endsWith(quote[1])) return null;
  const lines = raw.slice(quote[0].length, -3).split('\n');
  const indents = lines.slice(1).filter(line => line.trim()).map(line => /^\s*/.exec(line)[0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return [lines[0].trim(), ...lines.slice(1).map(line => line.slice(indent))].join('\n').trim();
}

function pythonDocument(node, raw) {
  const statement = node.parent, parent = statement?.parent;
  if (statement?.name !== 'ExpressionStatement' || statement.firstChild?.from !== node.from || statement.lastChild?.to !== node.to) return null;
  if (parent?.name !== 'Script' && !(parent?.name === 'Body' && /^(?:Function|Class)Definition$/.test(parent.parent?.name))) return null;
  for (let previous = statement.prevSibling; previous; previous = previous.prevSibling) if (![':', 'Comment'].includes(previous.name)) return null;
  return docstringText(raw);
}

export function readerDocuments(state, file, ranges) {
  const documents = new Map(), ext = extension(file);
  const language = ext === 'py' ? 'Python' : ext === 'php' ? 'PHP' : '';
  for (const range of ranges) syntaxTree(state).iterate({ ...range, enter(cursor) {
    const isComment = /comment/i.test(cursor.name), isString = ext === 'py' && cursor.name === 'String';
    if (!isComment && !isString) return;
    const { from, to } = cursor;
    if (to - from > MAX_DOCUMENT_LENGTH || state.doc.lineAt(from).number === state.doc.lineAt(to).number) return false;
    const raw = state.doc.sliceString(from, to);
    const text = isString ? pythonDocument(cursor.node, raw) : /^\/\*\*[\s\S]*\*\/$/.test(raw) ? raw : null;
    const first = state.doc.lineAt(from), last = state.doc.lineAt(to);
    const prefix = state.doc.sliceString(first.from, from);
    if (!text || /\S/.test(prefix + state.doc.sliceString(to, last.to))) return false;
    documents.set(from, { from: first.from, to: last.to, sourceFrom: from, indent: countColumn(prefix, state.tabSize), raw: text, language });
    return false;
  } });
  return [...documents.values()].sort((a, b) => a.from - b.from);
}

function selected(selection, from, to) {
  return selection.ranges.some(range => range.empty ? range.from > from && range.from < to : range.from < to && range.to > from);
}

const replace = StateEffect.define(), disclose = StateEffect.define();

class ReaderDocument extends WidgetType {
  constructor(value, t, { width, characterWidth }, expanded) {
    super(); this.value = value; this.t = t;
    this.indent = Math.min(width * MAX_INDENT_SHARE, value.indent * characterWidth);
    this.width = width - this.indent;
    this.compact = this.width < COMPACT_DOCUMENT_WIDTH;
    this.expanded = expanded ?? !this.compact;
  }
  sameDocument(other) { return this.t === other.t && Object.keys(this.value).every(key => this.value[key] === other.value[key]); }
  eq(other) { return this.width === other.width && this.indent === other.indent && this.expanded === other.expanded && this.sameDocument(other); }
  coordsAt(dom, pos) {
    const rect = dom.getBoundingClientRect(), height = parseFloat(getComputedStyle(dom).lineHeight);
    const top = pos === 0 ? rect.top : rect.bottom - height;
    return { left: rect.left, right: rect.left, top, bottom: top + height };
  }
  layout(dom) {
    dom.style.setProperty('--wb-reader-width', `${this.width}px`);
    dom.style.setProperty('--wb-reader-indent', `${this.indent}px`);
    dom.toggleAttribute('data-compact', this.compact);
    const toggle = dom.querySelector('.cm-reader-toggle');
    if (!toggle) return;
    const label = this.t(this.expanded ? 'readerCollapse' : 'readerExpand');
    toggle.setAttribute('aria-expanded', String(this.expanded));
    toggle.setAttribute('aria-label', label); toggle.title = label;
    toggle.firstElementChild.dataset.open = String(this.expanded);
    dom.toggleAttribute('data-collapsed', !this.expanded);
    dom.querySelector('.cm-reader-details').hidden = !this.expanded;
    const excerpt = dom.querySelector('.cm-reader-excerpt');
    if (excerpt) excerpt.hidden = this.expanded;
  }
  updateDOM(dom, _view, previous) {
    if (!this.sameDocument(previous)) return false;
    this.layout(dom);
    return true;
  }
  toDOM(view) {
    const { sourceFrom, raw, language } = this.value;
    const owner = view.dom.ownerDocument;
    const dom = owner.createElement('article'); dom.className = 'cm-reader-document documentation-card'; dom.setAttribute('aria-label', this.t('readerDocumentation'));
    const actions = owner.createElement('div'); actions.className = 'cm-reader-actions';
    const source = owner.createElement('button'); source.type = 'button'; source.className = 'cm-reader-source';
    source.textContent = source.title = this.t('readerSource'); source.setAttribute('aria-label', source.title);
    source.onclick = () => { view.dispatch({ selection: { anchor: sourceFrom + 1 }, effects: EditorView.scrollIntoView(sourceFrom, { y: 'nearest' }) }); view.focus(); };

    const content = documentationContent(parseDocumentation(raw, language), this.t);
    const description = content.querySelector('.documentation-description');
    const first = description?.firstElementChild;
    const keepsLead = first?.matches('p,h1,h2,h3,h4,h5,h6');
    const lead = keepsLead ? first : owner.createElement('p');
    if (!keepsLead) {
      // 保留表格、列表和示例的完整结构。收起时只读一小段纯文本。
      const preview = description?.querySelector('p,li,td,pre') ?? content.querySelector('dd p,.documentation-return p') ?? content.querySelector('pre,dt');
      lead.textContent = preview?.textContent.trim().replace(/\s+/g, ' ') || '';
      lead.className = 'cm-reader-excerpt';
    }
    const details = owner.createElement('div'); details.className = 'cm-reader-details';
    if (lead.textContent) {
      lead.classList.add('cm-reader-lead'); dom.append(lead);
      if (description && !description.childElementCount) description.remove();
      if (content.childElementCount || lead.textContent.length >= LONG_SUMMARY_LENGTH) {
        const toggle = owner.createElement('button'); toggle.type = 'button'; toggle.className = 'cm-reader-toggle';
        const controlled = content.childElementCount ? details : lead;
        controlled.id = `reader-${uniqueId()}`;
        toggle.setAttribute('aria-controls', controlled.id); toggle.append(foldMarker(this.expanded));
        toggle.onclick = () => view.dispatch({ effects: disclose.of({ sourceFrom, expanded: toggle.getAttribute('aria-expanded') !== 'true' }) });
        actions.append(toggle);
      }
    }
    actions.append(source); details.append(content); dom.append(actions, details);
    this.layout(dom);
    return dom;
  }
}

class ReaderLineNumber extends GutterMarker {
  constructor(number) { super(); this.number = number; }
  get elementClass() { return 'cm-reader-line-number'; }
  eq(other) { return this.number === other.number; }
  toDOM(view) { return view.dom.ownerDocument.createTextNode(String(this.number)); }
}

const readerLineNumbers = lineNumberWidgetMarker.of((view, widget, block) => widget instanceof ReaderDocument
  ? new ReaderLineNumber(view.state.doc.lineAt(block.from).number) : null);

// 已读文档的展开选择属于文件的编辑状态，换页及虚拟滚动后可恢复。
const field = StateField.define({
  create: () => ({ decorations: Decoration.none, choices: new Map() }),
  update(value, transaction) {
    let { decorations, choices } = value;
    if (transaction.docChanged) {
      decorations = Decoration.none;
      if (choices.size) {
        choices = new Map();
        for (const [sourceFrom, expanded] of value.choices) {
          const mapped = transaction.changes.mapPos(sourceFrom, 1, MapMode.TrackAfter);
          if (mapped !== null) choices.set(mapped, expanded);
        }
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(replace)) decorations = effect.value;
      else if (effect.is(disclose)) choices = new Map(choices).set(effect.value.sourceFrom, effect.value.expanded);
    }
    if (transaction.selection || decorations !== value.decorations) {
      decorations = decorations.update({ filter: (from, to) => !selected(transaction.state.selection, from, to) });
    }
    return decorations === value.decorations && choices === value.choices ? value : { decorations, choices };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

export function readerDocumentsExtension(file, t) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.pending = false; this.destroyed = false; this.geometry = null; this.measure(); }
    update(update) {
      const choiceChanged = update.startState.field(field).choices !== update.state.field(field).choices;
      if (choiceChanged || update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.schedule();
      if (update.geometryChanged) this.measure();
    }
    measure() {
      this.view.requestMeasure({ key: this,
        read: view => {
          const inset = Number.parseFloat(getComputedStyle(view.dom).getPropertyValue('--wb-code-inset')) || 6;
          const width = Math.max(0, view.scrollDOM.clientWidth - (view.dom.querySelector('.cm-gutters')?.offsetWidth || 0) - 2 * inset);
          return { width, characterWidth: view.defaultCharacterWidth / view.scaleX };
        },
        write: geometry => {
          if (this.destroyed || (this.geometry?.width === geometry.width && this.geometry.characterWidth === geometry.characterWidth)) return;
          // 宽度进入装饰状态；直接改 DOM 样式会绕过编辑器的行高更新。
          this.geometry = geometry; this.schedule();
        },
      });
    }
    schedule() {
      if (this.pending || !this.geometry) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        if (this.destroyed) return;
        const view = this.view, { decorations: current, choices } = view.state.field(field);
        const ranges = view.visibleRanges.map(range => ({ ...range }));
        // 替换装饰会从 visibleRanges 排除原文，合并自身范围以免反复展开、收起。
        current.between(view.viewport.from, view.viewport.to, (from, to) => ranges.push({ from, to }));
        ranges.sort((a, b) => a.from - b.from);
        const merged = [];
        for (const range of ranges) {
          const previous = merged.at(-1);
          if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
          else merged.push({ ...range });
        }
        const next = Decoration.set(readerDocuments(view.state, file, merged).filter(({ from, to }) => !selected(view.state.selection, from, to))
          .map(value => Decoration.replace({ widget: new ReaderDocument(value, t, this.geometry, choices.get(value.sourceFrom)), block: true }).range(value.from, value.to)), true);
        if (!RangeSet.eq([current], [next])) view.dispatch({ effects: replace.of(next) });
      });
    }
    destroy() { this.destroyed = true; }
  });
  return [field, readerLineNumbers, plugin];
}
