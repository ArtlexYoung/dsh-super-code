import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState, RangeSet, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, GutterMarker, gutter, WidgetType, lineNumbers, keymap, drawSelection } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { editorTheme } from '../editor/theme.js';
import { loadLanguage } from '../editor/languages.js';
import { Icon } from '../components/Icon.jsx';
import { diffBlocks } from '../../../src/workbench/git/text-diff.ts';
export { diffBlocks } from '../../../src/workbench/git/text-diff.ts';

const LINE_HEIGHT = 23;
class Gap extends WidgetType {
  constructor(lines) { super(); this.lines = lines; }
  eq(other) { return this.lines === other.lines; }
  toDOM() { const node = document.createElement('div'); node.className = 'sc-wb-git-gap'; node.style.height = `${this.lines * LINE_HEIGHT}px`; return node; }
  get estimatedHeight() { return this.lines * LINE_HEIGHT; }
}

class RestoreMarker extends GutterMarker {
  constructor(index, mount) { super(); this.index = index; this.mount = mount; }
  toDOM() { const node = document.createElement('span'); node.className = 'sc-wb-hunk-action'; this.mount(node, this.index); return node; }
  destroy(node) { this.mount(node, this.index, true); }
}

export function GitDiff({ diff, palette, t, Button, labels, open, loading, restore, restoring = false }) {
  const left = useRef(null), right = useRef(null), views = useRef([]), [at, setAt] = useState(-1);
  const [arrows, setArrows] = useState([]);
  const { path, binary, before, after, beforeStart, afterStart } = diff || {};
  const beforeLabel = t('gitBefore'), afterLabel = t('gitAfter');
  // 外窗快照会复制对象；原文、路径和行号不变时保留搜索、选区与滚动位置。
  const blocks = useMemo(() => diff ? diffBlocks(diff.lines) : [], [path, binary, before, after, beforeStart, afterStart]);
  useEffect(() => {
    setAt(-1);
    if (!diff || diff.binary || !left.current) return;
    let disposed = false;
    views.current = [left, right].map((parent, side) => {
      const state = EditorState.create({ doc: side ? diff.after : diff.before, extensions: [
        EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme(palette), lineNumbers({ formatNumber: number => String(number + (side ? diff.afterStart || 1 : diff.beforeStart || 1) - 1) }), drawSelection(), search(), keymap.of(searchKeymap),
        EditorView.theme({ '.cm-scroller': { lineHeight: `${LINE_HEIGHT}px` }, '.cm-line': { padding: '0 8px' } }),
        EditorView.contentAttributes.of({ 'aria-label': `${side ? afterLabel : beforeLabel} ${diff.path}` }),
      ] });
      const marks = [];
      for (const block of blocks) {
        const line = side ? block.after : block.before, count = side ? block.added : block.removed, other = side ? block.removed : block.added;
        for (let i = 0; i < count && line + i <= state.doc.lines; i++) marks.push(Decoration.line({ class: side ? 'sc-wb-git-added' : 'sc-wb-git-removed' }).range(state.doc.line(line + i).from));
        if (other > count) {
          const next = line + count, end = next > state.doc.lines;
          marks.push(Decoration.widget({ widget: new Gap(other - count), block: true, side: end ? 1 : -1 }).range(end ? state.doc.length : state.doc.line(next).from));
        }
      }
      const extensions = [EditorView.decorations.of(Decoration.set(marks, true))];
      if (!side && restore) {
        const mount = (node, index, removed) => setArrows(previous => removed ? previous.filter(item => item.node !== node) : [...previous, { node, index }]);
        const markers = RangeSet.of(blocks.map((block, index) => new RestoreMarker(index, mount).range(state.doc.line(Math.min(state.doc.lines, block.before)).from)), true);
        extensions.push(gutter({ class: 'sc-wb-hunk-gutter', side: 'after', markers: () => markers }));
      }
      const view = new EditorView({ parent: parent.current, state: state.update({ effects: StateEffect.appendConfig.of(extensions) }).state });
      // CodeMirror 默认隐藏整条边栏；右侧边栏包含可操作按钮，需要可访问。
      if (!side && restore) view.dom.querySelector('.cm-gutters-after')?.removeAttribute('aria-hidden');
      return view;
    });
    const pair = views.current;
    const handlers = pair.map((view, index) => () => {
      const other = pair[1 - index].scrollDOM;
      if (Math.abs(other.scrollTop - view.scrollDOM.scrollTop) > 1) other.scrollTop = view.scrollDOM.scrollTop;
      if (Math.abs(other.scrollLeft - view.scrollDOM.scrollLeft) > 1) other.scrollLeft = view.scrollDOM.scrollLeft;
    });
    pair.forEach((view, index) => view.scrollDOM.addEventListener('scroll', handlers[index]));
    void loadLanguage(diff.path).then(language => { if (!disposed) pair.forEach(view => view.dispatch({ effects: StateEffect.appendConfig.of(language) })); });
    return () => { disposed = true; pair.forEach((view, index) => { view.scrollDOM.removeEventListener('scroll', handlers[index]); view.destroy(); }); views.current = []; };
  }, [blocks, palette, t, beforeLabel, afterLabel, !!restore]);
  const move = direction => {
    const next = at < 0 ? (direction > 0 ? 0 : blocks.length - 1) : (at + direction + blocks.length) % blocks.length; setAt(next);
    views.current.forEach((view, side) => { const block = blocks[next], line = Math.min(view.state.doc.lines, side ? block.after : block.before); view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) }); });
  };
  if (!diff) return <div className="sc-wb-git-empty" role={loading ? 'status' : undefined}><span className="sc-wb-git-empty-icon"><Icon name="diff" /></span><strong>{t(loading ? 'loading' : 'gitChooseFile')}</strong></div>;
  return <div className="sc-wb-git-diff"><header><strong title={diff.path}>{diff.path}</strong><span className="sc-wb-git-diff-tools"><small>{blocks.length} {t('gitHunks')}</small>
    <Button title={t('gitPrevious')} aria-label={t('gitPrevious')} disabled={!blocks.length} onClick={() => move(-1)}><Icon name="up" /></Button><Button title={t('gitNext')} aria-label={t('gitNext')} disabled={!blocks.length} onClick={() => move(1)}><Icon name="down" /></Button>
    {open && <Button title={t('gitOpenFile')} onClick={open}>{t('gitOpenFile')}</Button>}</span></header>
    {diff.binary ? <p className="sc-wb-git-muted">{t('gitBinary')}</p> : <div className="sc-wb-git-compare"><section><label>{labels?.[0] || t('gitBefore')}</label><div ref={left} /></section><section><label>{labels?.[1] || t('gitAfter')}</label><div ref={right} /></section></div>}
    {arrows.map(({ node, index }) => createPortal(<Button className="sc-wb-hunk-restore" title={t('gitRestoreHunk')} aria-label={`${t('gitRestoreHunk')} ${index + 1}`} disabled={restoring} onClick={() => restore?.(index)}><Icon name="arrowRight" /></Button>, node, index))}
  </div>;
}
