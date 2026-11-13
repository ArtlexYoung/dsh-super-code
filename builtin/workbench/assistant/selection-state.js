import { isolateHistory } from '@codemirror/commands';

export function selectionThread(file, state, id) {
  const range = state.selection.main;
  if (range.empty) throw new Error('请先选择代码');
  return { id,file,from:range.from,to:range.to,original:state.sliceDoc(range.from,range.to),revision:0,stale:false,messages:[],draft:'',status:'idle',pinned:false };
}

export function hasMark(thread) { return thread.pinned || thread.messages.length > 0; }

export function mapThread(thread, changes) {
  let touched = false;
  changes.iterChangedRanges((from,to) => {
    if (from === to ? from > thread.from && from < thread.to : from < thread.to && to > thread.from) touched = true;
  });
  const from=changes.mapPos(thread.from,1),to=changes.mapPos(thread.to,-1);
  return { ...thread,from,to:Math.max(from,to),stale:thread.stale || touched,revision:thread.revision+(touched?1:0) };
}

export function selectionSnapshot(thread, state) {
  if (thread.stale || thread.from === thread.to || state.sliceDoc(thread.from,thread.to)!==thread.original) throw new Error('原选区已变化，请重新选择代码');
  return { revision:thread.revision,original:thread.original };
}

export function applyReplacement(view, thread, snapshot, replacement) {
  if (thread.stale || thread.revision!==snapshot.revision || thread.original!==snapshot.original || view.state.sliceDoc(thread.from,thread.to)!==snapshot.original) throw new Error('请求期间原选区已变化，未覆盖新代码');
  const from=thread.from;
  view.dispatch({changes:{from,to:thread.to,insert:replacement},selection:{anchor:from,head:from+replacement.length},annotations:[isolateHistory.of('full')],userEvent:'input.assistant'});
  return { ...thread,from,to:from+replacement.length,original:replacement,stale:false,revision:thread.revision+1 };
}
