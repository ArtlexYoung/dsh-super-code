import { parseSource, declarationAt } from '../analysis/source-info.js';

export async function openCodeHistory(workbench, t) {
  const view = workbench.view(), file = workbench.snapshot().file;
  if (!view || !file) return;
  const state = view.state, selection = state.selection.main, text = state.doc.toString();
  let from = selection.from, to = selection.to, kind = 'historySelection';
  if (selection.empty) {
    const parsed = await parseSource(file, text), declaration = declarationAt(parsed.tree, selection.head);
    if (declaration) { from = declaration.from; to = declaration.to; kind = 'historyFunction'; }
    else { from = state.doc.lineAt(selection.head).from; to = state.doc.lineAt(selection.head).to; kind = 'historyLine'; }
  }
  if (workbench.snapshot().file !== file || workbench.view()?.state.doc !== state.doc) throw new Error('WORKBENCH_GIT_STALE');
  const start = state.doc.lineAt(from).number, end = state.doc.lineAt(Math.max(from, to - 1)).number;
  workbench.panel({ kind: 'lineHistory', title: t(kind), target: { path: file, start, end }, text });
}
