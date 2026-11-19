import { StateEffect } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { displayScope, observeScope, scopeContext } from './scope.js';

const SAMPLE_LINES = 128;

function indentation(state, line) {
  let columns = 0;
  for (const chunk of state.doc.iterRange(line.from, line.to)) for (const character of chunk) {
    if (character === ' ') columns++;
    else if (character === '\t') columns += state.tabSize - columns % state.tabSize;
    else return columns;
  }
  return null;
}

function indentStep(state) {
  let step = state.tabSize;
  for (let number = 1; number <= Math.min(state.doc.lines, SAMPLE_LINES); number++) {
    const line = state.doc.line(number), columns = indentation(state, line);
    if (columns > 1 && !/^\s*\*/.test(state.doc.sliceString(line.from, Math.min(line.to, line.from + columns + 1)))) step = Math.min(step, columns);
  }
  return step;
}

function insideBlock(line, columns, block) {
  if (!block || line.from <= block.from || line.from > block.to) return false;
  const closing = line.to >= block.to && columns === block.column;
  return columns === null || columns > block.column || closing;
}

function guides(view, step, block) {
  const marks = [];
  const activeBlock = block && { ...block, column: indentation(view.state, view.state.doc.lineAt(block.header)) };
  for (const { from, to } of view.visibleRanges) {
    for (let start = from; start <= to;) {
      const line = view.state.doc.lineAt(start), columns = indentation(view.state, line);
      const active = insideBlock(line, columns, activeBlock);
      if (columns >= step || active) {
        const attributes = { style: `--indent-columns:${columns || 0};--indent-unit:${step}` };
        if (columns >= step) { attributes['data-indent-columns'] = String(columns); attributes['data-indent-unit'] = String(step); }
        if (active) { attributes['data-active-indent'] = String(activeBlock.column); attributes.style += `;--active-indent:${activeBlock.column}`; }
        marks.push(Decoration.line({ attributes }).range(line.from));
      }
      start = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

const refreshReadingGuides = StateEffect.define();
const guidePlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.step = indentStep(view.state);
    this.block = displayScope(view).block;
    this.decorations = guides(view, this.step, this.block);
    this.stop = observeScope(view, () => {
      if (this.pending || displayScope(view).block === this.block) return;
      this.pending = true;
      // 阅读位置在测量阶段更新，等编辑器可以接收事务后再刷新引导线。
      queueMicrotask(() => {
        this.pending = false;
        if (view.plugin(guidePlugin) === this && displayScope(view).block !== this.block) {
          view.dispatch({ effects: refreshReadingGuides.of(null) });
        }
      });
    });
  }
  update(update) {
    const changed = update.docChanged || update.startState.tabSize !== update.state.tabSize;
    const block = displayScope(update.view).block;
    if (changed) this.step = indentStep(update.state);
    if (changed || update.viewportChanged || block !== this.block) {
      this.block = block;
      this.decorations = guides(update.view, this.step, block);
    }
  }
  destroy() { this.stop(); }
}, { decorations: plugin => plugin.decorations });

/** 只为视口内的行绘制缩进引导。 */
export const indentGuides = [scopeContext, guidePlugin];
