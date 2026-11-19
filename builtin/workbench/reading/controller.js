import { errorText } from '../locales.js';
import { rebaseReading, resolveExcerpt } from './references.js';

const MAX_BUFFER_CHARS = 2 * 1024 * 1024;

export function createReading({ api, documents, currentFile, visit, t, locale }) {
  const subscribers = new Set();
  let request, context = new AbortController(), disposed = false;
  const cache = new Map();
  const initial = { goal: '', plan: null, planSources: [], active: -1, sections: [], sources: [], status: 'idle', stage: '', error: '', stale: false, partial: false, finished: false, target: null };
  let snapshot = { ...initial };
  function publish(patch) { if (disposed) return; snapshot = { ...snapshot, ...patch }; for (const listener of subscribers) listener(); }
  function buffers() {
    const result = []; let chars = 0;
    for (const [path, doc] of documents) {
      if (doc.text === doc.original) continue;
      chars += doc.text.length;
      if (chars > MAX_BUFFER_CHARS || result.length === 32) throw new Error('READING_BUFFER_SIZE');
      result.push({ path, text: doc.text, version: doc.version });
    }
    return result;
  }
  function stop() {
    request?.abort(); request = null;
    if (snapshot.status === 'running') publish({ status: 'stopped', finished: false });
  }
  function begin() {
    request?.abort(); const abort = new AbortController(); request = abort;
    if (disposed) abort.abort();
    publish({ status: 'running', stage: 'reading', error: '', finished: false });
    return abort;
  }
  async function synchronize(state, signal) {
    const texts = new Map();
    for (const file of new Set([...state.sources, ...state.planSources].map(source => source.file))) {
      signal.throwIfAborted();
      const doc = documents.get(file);
      const loaded = doc && doc.text !== doc.original ? doc : await api.read(file, signal);
      signal.throwIfAborted();
      texts.set(file, loaded.text);
    }
    for (const file of texts.keys()) { const doc = documents.get(file); if (doc && doc.text !== doc.original) texts.set(file, doc.text); }
    return rebaseReading(state, texts, true);
  }
  async function run(input, active = -1, abort = begin()) {
    publish({ status: 'running', error: '', finished: false, stale: false, partial: false, active, sections: [], sources: [], target: input });
    try {
      abort.signal.throwIfAborted();
      const content = { ...input, locale: locale(), buffers: buffers() };
      for await (const value of api.reading(content, abort.signal)) {
        abort.signal.throwIfAborted();
        if (value.kind === 'status') publish({ stage: value.stage });
        else if (value.kind === 'sources') publish({ ...rebaseReading({ ...snapshot, sources: value.sources }, new Map([...documents].map(([file, doc]) => [file, doc.text]))), partial: value.partial });
        else if (value.kind === 'plan') publish({ plan: value.plan, planSources: snapshot.sources });
        else if (value.kind === 'section') publish({ sections: [...snapshot.sections, value.section] });
        else if (value.kind === 'done') publish({ finished: true });
      }
      if (!snapshot.finished) throw new Error('WORKBENCH_MODEL_INCOMPLETE');
      const checked = await synchronize(snapshot, abort.signal);
      abort.signal.throwIfAborted();
      publish({ ...checked, status: 'ready' });
      if (!checked.stale && active >= 0) cache.set(active, { locale: locale(), value: { sections: snapshot.sections, sources: snapshot.sources, partial: snapshot.partial } });
    } catch (error) {
      if (request === abort) publish({ status: abort.signal.aborted ? 'stopped' : 'error', error: abort.signal.aborted ? '' : errorText(error, t), finished: false });
    } finally { if (request === abort) request = null; }
  }
  function actions({ currentFile, visit }) {
    async function locate(ref, signal = context.signal) {
      const doc = documents.get(ref.file);
      const loaded = doc && doc.text !== doc.original ? doc : await api.read(ref.file, signal);
      signal.throwIfAborted();
      const latest = documents.get(ref.file);
      const source = latest && latest.text !== latest.original ? latest : loaded;
      const resolved = resolveExcerpt(ref, source.text);
      if (!resolved) { publish({ stale: true }); return false; }
      await visit({ file: ref.file, line: resolved.fromLine - 1, length: resolved.quote.replace(/\r(?=\n|$)/g, '').length, source });
      signal.throwIfAborted(); return true;
    }
    async function step(index, force = false) {
      const item = snapshot.plan?.steps[index]; if (!item) return;
      const abort = begin();
      try {
        const checked = await synchronize({ ...snapshot, sources: [], sections: [] }, abort.signal);
        abort.signal.throwIfAborted(); publish(checked);
        if (checked.stale || !await locate(checked.plan.steps[index].refs[0], abort.signal)) { publish({ status: 'ready' }); return; }
        const current = checked.plan.steps[index];
        const input = { kind: 'explain', goal: snapshot.planGoal, file: current.refs[0].file, step: current };
        const saved = cache.get(index);
        if (!force && saved?.locale === locale()) {
          const result = await synchronize({ ...snapshot, ...saved.value }, abort.signal);
          abort.signal.throwIfAborted();
          if (!result.stale) { publish({ ...saved.value, ...result, target: input, active: index, error: '', status: 'ready', finished: true }); return; }
        }
        await run(input, index, abort);
      } catch (error) { if (request === abort) publish({ error: errorText(error, t), status: 'error' }); }
      finally { if (request === abort) request = null; }
    }
    return {
      async plan() {
        if (!snapshot.goal.trim()) return;
        cache.clear(); publish({ plan: null, planSources: [], planGoal: snapshot.goal.trim() });
        await run({ kind: 'plan', goal: snapshot.goal.trim(), ...(currentFile() ? { file: currentFile() } : {}) });
      },
      async file() {
        if (!currentFile()) return;
        await run({ kind: 'explain', goal: snapshot.goal.trim() || t('readingFileGoal'), file: currentFile() });
      },
      async retry() {
        if (snapshot.stale && snapshot.plan) {
          cache.clear(); publish({ plan: null, planSources: [] });
          await run({ kind: 'plan', goal: snapshot.planGoal, ...(currentFile() ? { file: currentFile() } : {}) });
        } else if (snapshot.active >= 0) await step(snapshot.active, true);
        else if (snapshot.target) await run(snapshot.target);
      },
      step, locate,
      async open(ref) { try { return await locate(ref); } catch (error) { if (error.name !== 'AbortError') publish({ error: errorText(error, t) }); return false; } },
    };
  }
  const reading = {
    ...actions({ currentFile, visit }),
    // 学习状态及请求共用，文件入口和引用跳转跟随各自视图。
    forView(navigation) { return { ...reading, ...actions(navigation) }; },
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }, snapshot: () => snapshot,
    bind(value) {
      if (documents === value) return;
      stop(); context.abort(); context = new AbortController(); documents = value; cache.clear();
      publish({ ...initial, planGoal: undefined, goal: snapshot.goal });
    },
    goal(value) { publish({ goal: value }); }, stop,
    changed(file) {
      for (const [key, saved] of cache) if (saved.value.sources.some(source => source.file === file)) cache.delete(key);
      if (![...snapshot.sources, ...snapshot.planSources].some(source => source.file === file)) return;
      const doc = documents.get(file);
      if (doc) publish(rebaseReading(snapshot, new Map([[file, doc.text]])));
    },
    async verify() {
      const before = snapshot;
      if (!before.sources.length && !before.planSources.length) return;
      try { const checked = await synchronize(before, new AbortController().signal); if (snapshot === before) publish(checked); }
      catch (error) { if (snapshot === before) publish({ stale: true, error: errorText(error, t) }); }
    },
    dispose() { stop(); context.abort(); disposed = true; subscribers.clear(); cache.clear(); },
  };
  return reading;
}
