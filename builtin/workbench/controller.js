import { EditorView } from '@codemirror/view';
import { SymbolIndex } from './analysis/index.js';
import { createEditor } from './editor/view.js';
import { defaults, readPreferences } from './editor/preferences.js';
import { wordAt } from './editor/code-info.js';
import { createSelectionAssistant } from './assistant/controller.js';
import { message, errorText } from './locales.js';

const INDEX_BYTES = 16 * 1024 * 1024;
const STORAGE_KEY = 'dsh-super-code-workbench';

export function createWorkbench(api, t) {
  const index = new SymbolIndex(), documents = new Map(), subscribers = new Set(), directories = new Map();
  let editor, current = null, generation = 0, opening, scanning, timer, preferences = defaults(), disposed = false;
  let history = [], at = -1, moving = false, navigation = Promise.resolve();
  let snapshot = { file: null, tabs: [], directories, symbols: [], cursor: null, status: t('ready'), error: '', preferences, panel: null, assistant: null, indexing: false, indexed: 0, back: false, forward: false };
  const publish = patch => { if (disposed) return; snapshot = { ...snapshot, ...patch }; for (const listener of subscribers) listener(); };
  const fail = error => { publish({ error: errorText(error, t) }); };
  const tabs = () => [...documents].map(([path, doc]) => ({ path, dirty: doc.text !== doc.original }));
  const assistant = createSelectionAssistant({ editor: { file: () => current, view: () => editor?.view }, api, t, changed: value => publish({ assistant: value }) });

  function position() {
    const view = editor?.view;
    if (!view || !current) return null;
    const range = view.state.selection.main, line = view.state.doc.lineAt(range.from);
    return { file: current, line: line.number - 1, character: range.from - line.from, length: range.to - range.from };
  }
  function cursor() {
    const value = position();
    publish({ cursor: value, back: at > 0, forward: at < history.length - 1 });
    if (!moving && at >= 0 && value) history[at] = value;
  }
  async function updateIndex(file = current) {
    const doc = documents.get(file);
    if (!doc) return;
    const text = doc.text;
    await index.change(file, text);
    if (file === current && text === documents.get(file)?.text) publish({ symbols: index.files.get(file)?.symbols || [] });
  }
  function changed(update) {
    if (update.docChanged) {
      const doc = documents.get(current);
      doc.text = update.state.doc.toString(); doc.state = update.state;
      publish({ tabs: tabs(), status: doc.text === doc.original ? t('saved') : t('unsaved') });
      clearTimeout(timer); timer = setTimeout(() => { void updateIndex().catch(fail); }, 180);
    }
    if (update.docChanged || update.selectionSet) cursor();
  }
  async function display(target) {
    const file = target.file;
    if (!editor) return false;
    if (current !== file) {
      const turn = ++generation;
      opening?.abort(); opening = new AbortController();
      publish({ status: t('loading'), error: '' });
      let doc = documents.get(file);
      if (!doc) {
        const result = await api.read(file, opening.signal);
        if (turn !== generation) return false;
        doc = { ...result, original: result.text, state: null }; documents.set(file, doc);
      }
      const state = await editor.state(file, doc.text, preferences, doc.state);
      if (turn !== generation) return false;
      if (current) documents.get(current).state = editor.view.state;
      assistant.switchFile(); current = file; editor.show(state); editor.preferences(preferences);
      await updateIndex(file);
      if (turn !== generation || !editor) return false;
      publish({ file, tabs: tabs(), status: doc.text === doc.original ? t('saved') : t('unsaved') });
    }
    const view = editor.view, line = view.state.doc.line(Math.min((target.line ?? 0) + 1, view.state.doc.lines));
    const from = Math.min(line.to, line.from + (target.character ?? 0));
    view.dispatch({ selection: { anchor: from, head: Math.min(view.state.doc.length, from + (target.length ?? 0)) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    view.focus(); cursor(); return true;
  }
  function visit(target) {
    const work = navigation.then(async () => {
      const previous = position(); if (at >= 0 && previous) history[at] = previous;
      moving = true;
      try { if (await display(target)) { history.splice(at + 1); history.push(position()); at++; } }
      finally { moving = false; cursor(); }
    });
    navigation = work.catch(fail); return work;
  }
  function move(direction) {
    const work = navigation.then(async () => {
      const next = at + direction; if (next < 0 || next >= history.length) return;
      const before = position(); if (before) history[at] = before;
      moving = true;
      try { if (await display(history[next])) at = next; } finally { moving = false; cursor(); }
    });
    navigation = work.catch(fail); return work;
  }
  async function list(path = '', signal) {
    const result = await api.list(path, signal);
    signal?.throwIfAborted();
    directories.set(path, result); publish({ directories: new Map(directories) });
    return result;
  }
  async function refresh() {
    scanning?.abort(); const abort = new AbortController(); scanning = abort;
    publish({ indexing: true, indexed: 0, error: '' });
    try {
      const project = await api.project(abort.signal); let bytes = 0, partial = false, truncated = project.truncated;
      abort.signal.throwIfAborted();
      await list('', abort.signal);
      const paths = new Set(project.files);
      for (const path of [...index.files.keys()]) if (!paths.has(path) && !documents.has(path)) index.remove(path);
      for (const path of project.files) {
        abort.signal.throwIfAborted();
        let doc = documents.get(path), text;
        try {
          if (doc && doc.text !== doc.original) text = doc.text;
          else {
            const version = doc?.version, loaded = await api.read(path, abort.signal);
            abort.signal.throwIfAborted();
            text = doc && (doc.text !== doc.original || doc.version !== version) ? doc.text : loaded.text;
            if (doc && doc.text === doc.original && doc.version === version && doc.version !== loaded.version) {
              Object.assign(doc, loaded, { original: text, state: null });
              if (path === current && editor?.view) {
                editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: text } });
                doc.state = editor.view.state;
              }
            }
          }
          bytes += text.length * 2;
          if (bytes > INDEX_BYTES) { truncated = true; break; }
          await index.change(path, text);
          abort.signal.throwIfAborted();
        } catch (error) { if (abort.signal.aborted) throw error; partial = true; }
        if (index.files.size % 20 === 0) publish({ indexed: index.files.size });
      }
      await updateIndex();
      abort.signal.throwIfAborted();
      publish({ tabs: tabs(), indexed: index.files.size, status: truncated ? t('indexLimit') : partial ? t('indexPartial') : message(t, 'indexed', { count: index.files.size }) });
    } catch (error) { if (!abort.signal.aborted) fail(error); }
    finally { if (scanning === abort) publish({ indexing: false }); }
  }
  async function save() {
    const doc = documents.get(current);
    if (!doc || doc.text === doc.original) return;
    const result = await api.save({ path: current, text: doc.text, version: doc.version });
    doc.original = result.text; doc.version = result.version;
    publish({ tabs: tabs(), status: doc.text === doc.original ? t('saved') : t('unsaved'), error: '' });
  }
  async function definition() {
    if (!current) return;
    await updateIndex();
    const view = editor.view, offset = view.state.selection.main.head, { word } = wordAt(view.state.doc.toString(), offset);
    if (!word) return;
    const result = index.navigate(current, word, offset);
    if (result.kind === 'definitions' && result.matches.length === 1) await visit(result.matches[0]);
    else publish({ panel: { kind: 'locations', title: `${word} · ${t(result.kind === 'usages' ? 'occurrences' : 'definitions')}`, ...result } });
  }
  function settings(value) {
    preferences = readPreferences(value); editor?.preferences(preferences); publish({ preferences });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { publish({ error: t('settingsFailed') }); }
  }
  return {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    snapshot: () => snapshot, documents, index, assistant, t,
    async attach(parent, tooltipParent) {
      try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) preferences = readPreferences(JSON.parse(saved)); }
      catch { publish({ error: t('settingInvalid') }); }
      editor = createEditor({ parent, tooltipParent, index, t, changed, assistant, currentFile: () => current,
        commands: { definition: () => { void definition().catch(fail); return true; }, project: () => { publish({ panel: { kind: 'search' } }); return true; },
          back: () => { void move(-1).catch(fail); return true; }, forward: () => { void move(1).catch(fail); return true; } },
      });
      const attached = editor;
      publish({ preferences });
      if (current) { const target = history[at] || { file: current }; current = null; await display(target); }
      if (editor === attached) await refresh();
    },
    detach() { opening?.abort(); scanning?.abort(); generation++; clearTimeout(timer); assistant.switchFile(); if (current && editor?.view) documents.get(current).state = editor.view.state; editor?.dispose(); editor = null; },
    dispose() { this.detach(); disposed = true; assistant.dispose(); documents.clear(); index.clear(); subscribers.clear(); },
    visit, move, list, refresh, save, settings, definition, fail,
    view: () => editor?.view,
    panel(value) { publish({ panel: value }); },
  };
}
