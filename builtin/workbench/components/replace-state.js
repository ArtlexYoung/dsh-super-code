import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorText } from '../locales.js';
import { usePanelState } from './panel-state.js';
import { uniqueId } from '../id.js';
import { remainingReplacements } from '../editing/replace.js';
import { searchQueryKey } from '../../../src/workbench/search-query.ts';

const sameQuery = (first, second) => first && second && searchQueryKey(first) === searchQueryKey(second);

async function scanMatches(workbench, query, signal, paths) {
  const rows = []; let completion;
  for await (const event of workbench.searchProject(query, signal)) {
    signal.throwIfAborted();
    if (event.kind === 'file' && (!paths || paths.has(event.path))) rows.push({ ...event, key: event.path });
    if (event.kind === 'done') completion = event;
  }
  signal.throwIfAborted();
  if (!completion) throw new Error('WORKBENCH_REMOTE');
  return { rows, ...completion };
}

/** 查询、选择和结果随工具窗口共享；在途操作只更新它开始时的那份预览。 */
export function useReplacement(workbench, t) {
  const { searchQuery: query } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const [savedPreview, setPreview] = usePanelState(workbench, 'replacePreview', null), [read, setRead] = usePanelState(workbench, 'replaceRead', null);
  const [applied, setApplied] = usePanelState(workbench, 'replaceResult', null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), pending = useRef(null);
  const preview = sameQuery(savedPreview?.query, query) ? savedPreview : null;
  const failure = error?.read === read ? error.text : '';
  useEffect(() => () => pending.current?.abort.abort(), []);
  const current = id => workbench.snapshot().panel?.state?.replaceRead === id;
  const update = (id, change) => setPreview(previous => previous?.id === id ? change(previous) : previous);
  const change = patch => { setRead(null); workbench.setSearchQuery(patch); setPreview(null); setApplied(null); setError(null); };
  function start(id, kind) {
    pending.current?.abort.abort();
    const abort = new AbortController(); pending.current = { abort, id, kind };
    setBusy(true); setError(null); setApplied(null);
    return abort;
  }
  function finish(abort) { if (pending.current?.abort === abort) { pending.current = null; setBusy(false); } }
  async function scan(remaining = false) {
    const id = uniqueId(), paths = remaining ? new Set(preview.rows.map(row => row.path)) : null;
    const selected = remaining ? new Set(preview.selected) : null;
    const abort = start(id, remaining ? 'recheck' : 'scan'); setRead(id); setPreview(remaining ? { ...preview, id } : null);
    try {
      const result = await scanMatches(workbench, query, abort.signal, paths);
      if (!current(id)) return;
      setPreview({ id, query, ...result, selected: result.rows.filter(row => !selected || selected.has(row.path)).map(row => row.path), active: null });
    } catch (error) { if (!abort.signal.aborted && current(id)) setError({ read: id, text: errorText(error, t) }); }
    finally { finish(abort); }
  }
  async function apply() {
    const selected = new Set(preview.selected), rows = preview.rows.filter(row => selected.has(row.path));
    if (!rows.length) return;
    const { id } = preview, abort = start(id, 'apply');
    const progress = value => {
      if (current(id)) setApplied(value);
      update(id, previous => remainingReplacements(previous, value.changed));
    };
    try {
      const result = await workbench.replaceProject(rows, query, progress, abort.signal, id);
      const failed = new Set(result.failed.map(item => item.path));
      update(id, previous => remainingReplacements(previous, rows.filter(row => !failed.has(row.path)).map(row => row.path)));
    } catch (error) { if (!abort.signal.aborted && current(id)) setError({ read: id, text: errorText(error, t) }); }
    finally { finish(abort); }
  }
  function stop() {
    const request = pending.current;
    if (!request) return;
    request.abort.abort();
    if (request.kind === 'scan') update(request.id, () => null);
  }
  const select = (path, checked) => update(preview.id, previous => ({ ...previous,
    selected: checked ? [...new Set([...previous.selected, path])] : previous.selected.filter(item => item !== path) }));
  const selectAll = checked => update(preview.id, previous => ({ ...previous, selected: checked ? previous.rows.map(row => row.path) : [] }));
  const inspect = path => update(preview.id, previous => ({ ...previous, active: path }));
  return { query, preview, busy, failure, applied, change, scan, apply, stop, select, selectAll, inspect };
}
