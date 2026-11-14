const DIRECTORY_BATCH = 4;
const UPDATE_INTERVAL = 100;

export function matchFiles(files, query) {
  const text = query.trim().replaceAll('\\', '/').toLowerCase();
  return text ? files.filter(path => path.toLowerCase().includes(text)) : [];
}

export function createFileSearch(list) {
  const listeners = new Set();
  let snapshot = { files: [], searching: false, truncated: false, error: null };
  let folders = [''], cursor = 0, files = new Set(), seen = new Set(['']), active = false, request, complete = false;
  const publish = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  function cancel() { const previous = request; request = null; previous?.abort(); }
  function collect(result) {
    if (result.status === 'rejected') { publish({ error: result.reason }); return; }
    if (result.value.truncated) publish({ truncated: true });
    for (const entry of result.value.entries) {
      if (entry.type === 'file') files.add(entry.path);
      else if (!seen.has(entry.path)) { seen.add(entry.path); folders.push(entry.path); }
    }
  }
  async function scan() {
    if (request || complete || !active) return;
    const abort = new AbortController(); request = abort;
    publish({ searching: true });
    let updated = Date.now();
    while (cursor < folders.length) {
      const batch = folders.slice(cursor, cursor + DIRECTORY_BATCH);
      const results = await Promise.allSettled(batch.map(path => list(path, abort.signal)));
      // 宿主可能在取消后才返回；旧扫描不能覆盖刷新后的目录。
      if (request !== abort) return;
      for (const result of results) collect(result);
      cursor += batch.length;
      if (Date.now() - updated >= UPDATE_INTERVAL) { publish({ files: [...files] }); updated = Date.now(); }
    }
    complete = true; request = null;
    publish({ files: [...files], searching: false });
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => snapshot,
    activate(value) {
      active = value;
      if (active) void scan();
      else { cancel(); publish({ searching: false }); }
    },
    reset() {
      cancel(); folders = ['']; cursor = 0; files = new Set(); seen = new Set(['']); complete = false;
      publish({ files: [], searching: false, truncated: false, error: null });
      if (active) void scan();
    },
    dispose() { active = false; cancel(); listeners.clear(); },
  };
}
