import { errorText, message } from './locales.js';

/** 主工作台负责记录自己的分栏；独立窗口的导航不覆盖这份记录。 */
export function createWorkspaceRecovery(workbench, store, changed, t) {
  let root, timer, request, disposed = false, started = false, attempted = '', cleanups = [];
  let state = { candidate: null, busy: false, error: '', failures: [] };
  const publish = patch => { state = { ...state, ...patch }; changed({ recovery: state }); };
  function flush() {
    clearTimeout(timer);
    if (!root || disposed || request) return;
    const value = workbench.groups.capture();
    if (value.panes.some(pane => pane.tabs.length)) started = true;
    if (!started) return;
    const content = JSON.stringify(value);
    if (content === attempted) return;
    attempted = content;
    try { store.save(root, { version: 1, updatedAt: Date.now(), ...value }); publish({ candidate: null, error: '' }); }
    catch (error) { publish({ error: errorText(error, t) }); }
  }
  function schedule() { clearTimeout(timer); if (!disposed) timer = setTimeout(flush, 500); }
  function watch() {
    for (const cleanup of cleanups) cleanup();
    cleanups = workbench.groups.snapshot().panes.flatMap(({ pane }) => [pane.workbench.subscribe(schedule), pane.workbench.subscribeLocation(schedule)]);
    schedule();
  }
  const unsubscribe = workbench.groups.subscribe(watch);
  const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
  window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
  watch();
  return {
    flush,
    bind(path) {
      if (root === path) return;
      request?.abort(); request = null; clearTimeout(timer);
      root = path; started = false; attempted = '';
      try {
        const candidate = store.read(root);
        publish({ candidate: candidate?.panes.some(pane => pane.tabs.length) ? candidate : null, busy: false, error: '', failures: [] });
        if (candidate) changed({ recentFiles: candidate.panes[candidate.active].recent });
      } catch (error) { publish({ candidate: null, busy: false, failures: [], error: errorText(error, t) }); }
    },
    async restore() {
      const saved = state.candidate;
      if (!saved || request || workbench.groups.snapshot().panes.some(({ pane }) => pane.workbench.snapshot().tabs.length)) return;
      const abort = new AbortController(); request = abort; clearTimeout(timer);
      publish({ busy: true, error: '', failures: [] });
      const failures = [], pending = [];
      const initial = saved.panes.map((value, index) => {
        if (index === 0) return null;
        let resolve, reject;
        pending.push(new Promise((done, fail) => { resolve = done; reject = fail; }));
        abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
        return { async restore(view) { failures.push(...await view.restoreSession(value, abort.signal)); return true; }, opened: resolve, fail: reject };
      });
      try {
        const panes = workbench.groups.restore(saved.tree, saved.active, initial);
        await Promise.all([workbench.restoreSession(saved.panes[0], abort.signal).then(value => failures.push(...value)), ...pending]);
        abort.signal.throwIfAborted();
        workbench.groups.activate(panes[saved.active]); panes[saved.active].workbench.view()?.focus();
      } catch (error) { abort.abort(); if (error.name !== 'AbortError') throw error; }
      finally {
        if (request === abort) {
          request = null;
          const count = workbench.groups.snapshot().panes.reduce((total, { pane }) => total + pane.workbench.snapshot().tabs.length, 0);
          started = count > 0;
          publish({ candidate: count ? null : saved, busy: false, failures }); flush();
          changed({ status: abort.signal.aborted ? t('resumeStopped') : message(t, 'resumeFinished', { count }) });
        }
      }
    },
    stop() { request?.abort(); },
    retry() { attempted = ''; if (started) flush(); else { const path = root; root = undefined; this.bind(path); } },
    dismiss() { publish({ error: '', failures: [] }); },
    dispose() {
      flush(); disposed = true; request?.abort(); request = null; clearTimeout(timer);
      unsubscribe(); for (const cleanup of cleanups) cleanup();
      window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden);
    },
  };
}
