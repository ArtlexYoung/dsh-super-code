import { openSearchPanel } from '@codemirror/search';
import { startCompletion } from '@codemirror/autocomplete';
import { editingCommands } from './editor/input.js';
import { openCodeHistory } from './git/history.js';

/** 工具栏和命令搜索共用可用条件与执行逻辑。 */
export function workbenchCommands(workbench, snapshot, t, toggleFocus, current = snapshot.tabs?.find(item => item.path === snapshot.file && item.kind === 'file')) {
  const withEditor = run => () => { const view = workbench.view(); if (view) { view.focus(); run(view); } };
  return {
    navigateFiles: { run: () => workbench.panel({ kind: 'navigate', query: '' }) },
    navigateSymbols: { run: () => workbench.panel({ kind: 'navigate', query: '@' }), disabled: !current },
    commandPalette: { run: () => workbench.panel({ kind: 'navigate', query: '>' }) },
    readingFocus: { run: toggleFocus, disabled: !current || !toggleFocus },
    saveConflict: { run: () => workbench.panel({ kind: 'saveConflict', path: snapshot.saveConflict || snapshot.file }), disabled: !current },
    reopenTab: { run: () => workbench.reopenTab(), disabled: !snapshot.canReopenTab },
    back: { run: () => workbench.move(-1), disabled: !snapshot.back },
    forward: { run: () => workbench.move(1), disabled: !snapshot.forward },
    find: { run: withEditor(openSearchPanel), disabled: !current },
    replace: { run: withEditor(editingCommands.replace), disabled: !current },
    project: { run: () => workbench.panel({ kind: 'search' }) },
    projectReplace: { run: () => workbench.panel({ kind: 'projectReplace' }) },
    definition: { run: workbench.definition, disabled: !current },
    complete: { run: withEditor(startCompletion), disabled: !current },
    parameters: { run: withEditor(editingCommands.parameters), disabled: !current },
    codeHistory: { run: () => openCodeHistory(workbench, t), disabled: !current },
    refresh: { run: workbench.refresh, disabled: snapshot.indexing },
    window: { run: workbench.external ? workbench.returnToHost : workbench.openWindow },
    drafts: { run: () => workbench.panel({ kind: 'drafts' }) },
    saveAll: { run: () => { workbench.panel({ kind: 'drafts' }); return workbench.saveAll(); }, disabled: !snapshot.unsaved?.length || snapshot.saveBatch?.busy },
    save: { run: () => { workbench.view()?.focus(); return workbench.save(); }, disabled: !current?.dirty },
    git: { run: () => workbench.panel({ kind: 'git' }) },
    settings: { run: () => workbench.panel({ kind: 'settings' }) },
    undo: { run: () => workbench.undo() }, redo: { run: () => workbench.undo('redo') },
  };
}
