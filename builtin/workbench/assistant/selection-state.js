import { isolateHistory } from '@codemirror/commands';
import { Text } from '@codemirror/state';

export function selectionThread(file, state, id, kind = 'code') {
  const range = state.selection.main;
  if (range.empty) throw new Error('请先选择代码');
  const line = state.doc.lineAt(range.from);
  return { id,file,kind,line:line.number-1,character:range.from-line.from,from:range.from,to:range.to,original:state.sliceDoc(range.from,range.to),revision:0,version:0,stale:false,messages:[],draft:'',status:'idle',pinned:false };
}

export function hasMark(thread) { return thread.pinned || thread.messages.length > 0; }

export function mapThread(thread, changes) {
  let touched = false;
  changes.iterChangedRanges((from,to) => {
    if (from === to ? from > thread.from && from < thread.to : from < thread.to && to > thread.from) touched = true;
  });
  const from=changes.mapPos(thread.from,1),to=changes.mapPos(thread.to,-1);
  return { ...thread,from,to:Math.max(from,to),stale:thread.stale || touched,revision:thread.revision+(touched?1:0),version:thread.version+1 };
}

export function selectionSnapshot(thread, state) {
  if (thread.stale || thread.from === thread.to || state.sliceDoc(thread.from,thread.to)!==thread.original) throw new Error('WORKBENCH_SELECTION_CHANGED');
  return { revision:thread.revision,original:thread.original,version:thread.version };
}

export function verifyReplacement(state, thread, snapshot) {
  if (thread.stale || thread.revision!==snapshot.revision || thread.original!==snapshot.original || state.sliceDoc(thread.from,thread.to)!==snapshot.original) throw new Error('WORKBENCH_SELECTION_CHANGED');
}

export function applyReplacement(view, thread, snapshot, replacement) {
  verifyReplacement(view.state, thread, snapshot);
  const from=thread.from,insert=Text.of(replacement.split(/\r\n?|\n/)),to=from+insert.length;
  view.dispatch({changes:{from,to:thread.to,insert},selection:{anchor:from,head:to},annotations:[isolateHistory.of('full')],userEvent:'input.assistant'});
  return { ...thread,from,to,original:view.state.sliceDoc(from,to),stale:false,revision:thread.revision+1,version:thread.version+1 };
}
