import { errorText } from './locales.js';

/** 每个会话一份协调器；分栏和独立窗口订阅它，已离开的项目仍能备份未保存内容。 */
export function createDraftRecovery(store, t) {
  const trackers = new Map(), listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const publish = (tracker, patch) => { tracker.state = { ...tracker.state, ...patch }; notify(); };
  async function load(tracker) {
    publish(tracker, { loading: true });
    try {
      const record = await store.read(tracker.root);
      tracker.revision = record?.revision || 0;
      tracker.candidates = new Map(record?.entries.map(entry => [entry.path, entry]));
      tracker.loaded = true; tracker.content = JSON.stringify(record?.entries || []);
      publish(tracker, { candidates: [...tracker.candidates.keys()], updatedAt: record?.updatedAt || 0, error: '', blocked: false });
      schedule(tracker);
    } catch (error) { publish(tracker, { error: errorText(error, t), blocked: true }); }
    finally { publish(tracker, { loading: false }); }
  }
  function schedule(tracker) {
    clearTimeout(tracker.timer);
    tracker.timer = setTimeout(() => { void flush(tracker); }, 350);
  }
  function projectChanged(tracker, event) {
    if (event.kind === 'beforeMove') {
      if (!tracker.loaded || tracker.state.loading || tracker.state.blocked) throw new Error('WORKBENCH_MOVE_RECOVERY');
      if (tracker.candidates.has(event.to)) throw new Error('WORKBENCH_MOVE_RECOVERY');
      return;
    }
    if (event.kind === 'move') {
      const entry = tracker.candidates.get(event.from);
      if (entry) {
        tracker.candidates.delete(event.from);
        tracker.candidates.set(event.to, { ...entry, path: event.to, diskVersion: entry.diskVersion === event.previousVersion ? event.version : entry.diskVersion });
        publish(tracker, { candidates: [...tracker.candidates.keys()] });
      }
      void flush(tracker); return;
    }
    if (['text', 'saved', 'files'].includes(event.kind)) schedule(tracker);
  }
  function capture(tracker) {
    const entries = new Map(tracker.candidates);
    if (tracker.finalEntries) {
      for (const entry of tracker.finalEntries) if (!entries.has(entry.path)) entries.set(entry.path, entry);
      return [...entries.values()];
    }
    for (const [path, doc] of tracker.project.documents) {
      if (!tracker.candidates.has(path) && doc.dirty && doc.writers.has(tracker.owner)) {
        entries.set(path, { path, text: doc.text, original: doc.original, diskVersion: doc.version });
      }
    }
    return [...entries.values()];
  }
  async function flush(tracker) {
    clearTimeout(tracker.timer);
    if (!tracker.loaded || tracker.state.blocked) return;
    if (tracker.pending) { tracker.again = true; return tracker.pending; }
    const entries = capture(tracker), content = JSON.stringify(entries);
    if (content === tracker.content) return;
    publish(tracker, { busy: true });
    tracker.pending = Promise.resolve().then(() => store.save(tracker.root, entries, tracker.revision)).then(record => {
      tracker.revision = record.revision; tracker.content = content;
      publish(tracker, { updatedAt: record.updatedAt, error: '', blocked: false });
    }).catch(error => publish(tracker, { error: errorText(error, t), blocked: error.message === 'WORKBENCH_RECOVERY_CHANGED' }))
      .finally(() => {
        tracker.pending = null; publish(tracker, { busy: false });
        if (tracker.again) { tracker.again = false; schedule(tracker); }
      });
    return tracker.pending;
  }
  const flushAll = () => { for (const tracker of trackers.values()) void flush(tracker); };
  const hidden = () => { if (document.visibilityState === 'hidden') flushAll(); };
  window.addEventListener('pagehide', flushAll); document.addEventListener('visibilitychange', hidden);
  return {
    bind(root, project, owner) {
      if (trackers.has(root)) return;
      const tracker = { root, project, owner, candidates: new Map(), loaded: false, revision: 0,
        state: { candidates: [], updatedAt: 0, busy: false, loading: true, error: '', blocked: false } };
      tracker.unsubscribe = project.subscribe(event => projectChanged(tracker, event));
      trackers.set(root, tracker); void load(tracker);
    },
    snapshot: root => trackers.get(root)?.state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    entry: (root, path) => trackers.get(root)?.candidates.get(path),
    async consume(root, path, entry) {
      const tracker = trackers.get(root);
      if (tracker?.candidates.get(path) !== entry) throw new Error('WORKBENCH_RECOVERY_CHANGED');
      tracker.candidates.delete(path);
      publish(tracker, { candidates: [...tracker.candidates.keys()] });
      await flush(tracker);
    },
    async retry(root) {
      const tracker = trackers.get(root);
      if (!tracker) return;
      if (!tracker.loaded || tracker.state.blocked) await load(tracker);
      tracker.content = null; await flush(tracker);
    },
    flush: root => { const tracker = trackers.get(root); return tracker && flush(tracker); },
    dispose() {
      for (const tracker of trackers.values()) { tracker.finalEntries = capture(tracker); tracker.unsubscribe(); clearTimeout(tracker.timer); }
      flushAll();
      listeners.clear(); window.removeEventListener('pagehide', flushAll); document.removeEventListener('visibilitychange', hidden);
    },
  };
}
