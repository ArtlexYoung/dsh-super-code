import { EditorState } from '@codemirror/state';
import { keymap, runScopeHandlers, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { indentMore, indentLess, deleteLine, undo, redo, toggleComment, defaultKeymap, history, historyKeymap, cursorSyntaxLeft, cursorSyntaxRight } from '@codemirror/commands';
import { acceptCompletion, startCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { openSearchPanel, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';

const CLICK_DISTANCE = 4;
export const editingCommands = {
  indent: view => acceptCompletion(view) || indentMore(view),
  outdent: indentLess, deleteLine, undo, redo, comment: toggleComment,
  complete: startCompletion, find: openSearchPanel,
};

// 可配置动作只保留设置中的绑定，其余编辑行为沿用 CodeMirror。
const configurable = new Set([indentMore, indentLess, deleteLine, undo, redo, toggleComment, startCompletion, openSearchPanel, cursorSyntaxLeft, cursorSyntaxRight]);
export const editorSetup = [
  lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
  EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(), closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap].filter(binding => !configurable.has(binding.run))),
];

export function workbenchKeydown(event, view) {
  if (event.defaultPrevented || event.isComposing || !view || event.target.closest('[data-workbench-dialog]')) return;
  if (runScopeHandlers(view, event, 'workbench')) event.preventDefault();
}

export function navigationPointer(event, move) {
  if (event.button !== 3 && event.button !== 4) return false;
  event.preventDefault(); move?.(event.button === 3 ? -1 : 1); return true;
}

function finishSelection(editor,pressed,pos) {
  const range=editor.state.selection.main;
  // 输入链路丢失按住移动事件时，用松开位置补齐选区，已有选择仍交给 CodeMirror。
  if(!pressed.navigate && !pressed.inside && range.empty && range.head===pressed.pos && pos!==pressed.pos) {
    editor.dispatch({selection:{anchor:pressed.pos,head:pos},userEvent:'select.pointer'});
  }
}

export function editorPointerEvents(navigate) {
  let start;
  return {
    pointerdown(event,editor) {
      start=null;
      if(event.button!==0 || event.shiftKey || event.altKey || event.detail>1)return false;
      const pos=editor.posAtCoords({x:event.clientX,y:event.clientY}),range=editor.state.selection.main;
      if(pos===null)return false;
      start={x:event.clientX,y:event.clientY,pos,doc:editor.state.doc,moved:false,navigate:event.ctrlKey||event.metaKey,inside:!range.empty && pos>=range.from && pos<=range.to};
      return false;
    },
    pointermove(event) {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DISTANCE) start.moved=true;
      return false;
    },
    pointerup(event, editor) {
      const pressed = start; start = null;
      if (!pressed || event.button !== 0 || editor.state.doc!==pressed.doc) return false;
      const moved=pressed.moved || Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>CLICK_DISTANCE;
      const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      if(!moved && pressed.navigate){editor.dispatch({selection:{anchor:pos}});navigate();return true;}
      if(moved)finishSelection(editor,pressed,pos);
      return false;
    },
    pointercancel() { start = null; return false; },
    contextmenu(event) { if (!event.ctrlKey) return false; event.preventDefault(); return true; },
  };
}
