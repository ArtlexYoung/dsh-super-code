import React, { useEffect, useRef, useState } from 'react';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, lineNumbers, keymap, drawSelection } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { editorTheme } from '../editor/theme.js';
import { loadLanguage } from '../editor/languages.js';

const LINE_HEIGHT = 23;
class Gap extends WidgetType {
  constructor(lines) { super(); this.lines = lines; }
  eq(other) { return this.lines === other.lines; }
  toDOM() { const node = document.createElement('div'); node.className = 'sc-wb-git-gap'; node.style.height = `${this.lines * LINE_HEIGHT}px`; return node; }
  get estimatedHeight() { return this.lines * LINE_HEIGHT; }
}

export function diffBlocks(lines) {
  const blocks = []; let before = 1, after = 1, current;
  for (const line of lines) {
    if (line.kind === 'context') { current = null; before++; after++; continue; }
    if (!current) { current = { before, after, removed: 0, added: 0 }; blocks.push(current); }
    if (line.kind === 'removed') { current.removed++; before++; } else { current.added++; after++; }
  }
  return blocks;
}

export function GitDiff({ diff, palette, t, Button, labels, open }) {
  const left = useRef(null), right = useRef(null), views = useRef([]), [at, setAt] = useState(-1);
  const blocks = diff ? diffBlocks(diff.lines) : [];
  useEffect(() => {
    setAt(-1);
    if (!diff || diff.binary || !left.current) return;
    let disposed = false;
    const blocks = diffBlocks(diff.lines);
    views.current = [left, right].map((parent, side) => {
      const state = EditorState.create({ doc: side ? diff.after : diff.before, extensions: [
        EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme(palette), lineNumbers(), drawSelection(), search(), keymap.of(searchKeymap),
        EditorView.theme({ '.cm-scroller': { lineHeight: `${LINE_HEIGHT}px` }, '.cm-line': { padding: '0 8px' } }),
        EditorView.contentAttributes.of({ 'aria-label': `${side ? t('gitAfter') : t('gitBefore')} ${diff.path}` }),
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
      return new EditorView({ parent: parent.current, state: state.update({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set(marks, true))) }).state });
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
  }, [diff, palette, t]);
  const move = direction => {
    const next = at < 0 ? (direction > 0 ? 0 : blocks.length - 1) : (at + direction + blocks.length) % blocks.length; setAt(next);
    views.current.forEach((view, side) => { const block = blocks[next], line = Math.min(view.state.doc.lines, side ? block.after : block.before); view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) }); });
  };
  if (!diff) return <div className="sc-wb-git-empty"><span className="sc-wb-git-empty-icon">±</span><strong>{t('gitChooseFile')}</strong></div>;
  return <div className="sc-wb-git-diff"><header><strong title={diff.path}>{diff.path}</strong><span className="sc-wb-git-diff-tools"><small>{blocks.length} {t('gitHunks')}</small>
    <Button title={t('gitPrevious')} disabled={!blocks.length} onClick={() => move(-1)}>↑</Button><Button title={t('gitNext')} disabled={!blocks.length} onClick={() => move(1)}>↓</Button>
    {open && <Button title={t('gitOpenFile')} onClick={open}>{t('gitOpenFile')}</Button>}</span></header>
    {diff.binary ? <p className="sc-wb-git-muted">{t('gitBinary')}</p> : <div className="sc-wb-git-compare"><section><label>{labels?.[0] || t('gitBefore')}</label><div ref={left} /></section><section><label>{labels?.[1] || t('gitAfter')}</label><div ref={right} /></section></div>}
  </div>;
}
