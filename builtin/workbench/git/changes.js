/** 两个侧栏共享仓库快照；只为可见行计算增删数量。 */
export function createChanges(git, describe) {
  let snapshot = { state: null, sources: [], stats: new Map(), busy: false, error: '' };
  let loading, statistics, timer, disposed = false;
  const subscribers = new Set(), wanted = new Set(), windows = new Map();
  const publish = patch => { if (disposed) return; snapshot = { ...snapshot, ...patch }; for (const listener of subscribers) listener(); };
  function updateWanted() {
    wanted.clear();
    for (const paths of windows.values()) for (const path of paths) if (!snapshot.stats.has(path)) wanted.add(path);
  }
  function accept(result) {
    if (result.kind !== 'state') return;
    const changed = snapshot.state?.version !== result.state.version;
    if (changed) { statistics?.abort(); statistics = null; wanted.clear(); }
    publish({ state: result.state, sources: result.sources || [], stats: changed ? new Map() : snapshot.stats, error: '' });
  }
  async function refresh() {
    if (loading) return loading.work;
    const abort = new AbortController(); publish({ busy: true });
    const work = (async () => {
      try { const result = await git({ action: 'status' }, abort.signal); if (!abort.signal.aborted) accept(result); }
      catch (error) { if (!abort.signal.aborted) publish({ error: describe(error) }); }
      finally { if (loading?.abort === abort) { loading = null; publish({ busy: false }); } }
    })();
    loading = { abort, work }; return work;
  }
  function invalidate() {
    if (!subscribers.size || timer) return;
    timer = setTimeout(() => { timer = null; void refresh(); }, 500);
  }
  async function collect() {
    if (statistics || !wanted.size || !snapshot.state?.exists) return;
    const abort = new AbortController(), version = snapshot.state.version;
    statistics = abort;
    try {
      while (wanted.size && !abort.signal.aborted) {
        const paths = [...wanted].filter(path => !snapshot.stats.has(path)).slice(0, 16);
        if (!paths.length) { wanted.clear(); break; }
        paths.forEach(path => wanted.delete(path));
        const result = await git({ action: 'stats', paths, version }, abort.signal);
        if (abort.signal.aborted || snapshot.state.version !== result.version) return;
        const stats = new Map(snapshot.stats);
        for (const value of result.stats) stats.set(value.path, value);
        publish({ stats });
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        wanted.clear(); publish({ error: describe(error) });
        if (error.message.includes('WORKBENCH_GIT_STALE')) invalidate();
      }
    } finally { if (statistics === abort) statistics = null; }
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) {
          loading?.abort.abort(); loading = null; statistics?.abort(); statistics = null;
          wanted.clear(); windows.clear(); clearTimeout(timer); timer = null; publish({ busy: false });
        }
      };
    },
    accept, refresh, invalidate,
    visible(paths, owner = 'default') {
      windows.set(owner, paths); updateWanted();
      void collect();
    },
    forget(owner) { windows.delete(owner); updateWanted(); },
    async diff(path, signal) {
      if (!snapshot.state) throw new Error('WORKBENCH_GIT_STALE');
      return (await git({ action: 'diff', path, side: 'total', version: snapshot.state.version }, signal)).diff;
    },
    dispose() { disposed = true; loading?.abort.abort(); statistics?.abort(); clearTimeout(timer); subscribers.clear(); },
  };
}
