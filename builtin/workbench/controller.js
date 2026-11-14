import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { SymbolIndex } from './analysis/index.js';
import { createEditor } from './editor/view.js';
import { defaults, readPreferences } from './editor/preferences.js';
import { wordAt } from './editor/code-info.js';
import { createSelectionAssistant } from './assistant/controller.js';
import { message, errorText } from './locales.js';
import { createReading } from './reading/controller.js';
import { createAnalyzer } from './analysis/background.js';
import { createBuffer } from './buffer.js';
import { createChanges } from './git/changes.js';
import { createFileSearch } from './file-search.js';
import { createProject } from './editing/project.js';
import { asText } from './editing/history.js';
import { createAutosave } from './editing/autosave.js';
import { undoEdit, replaceFiles } from './editing/actions.js';

const INDEX_BYTES = 16 * 1024 * 1024;
const STORAGE_KEY = 'dsh-super-code-workbench';

export function createWorkbench(api, t, { projects = new Map(), translationLanguage } = {}) {
  const analyzer = createAnalyzer(), index = new SymbolIndex(analyzer.analyze), documents = new Map(), subscribers = new Set(), directories = new Map();
  let editor, current = null, generation = 0, opening, scanning, timer, preferences = defaults(), disposed = false;
  let history = [], at = -1, moving = false, navigation = Promise.resolve();
  let saving, operation;
  const owner = Symbol('workbench');
  let project, unsubscribeProject = () => {}, synchronizing = false, receiving = false;
  let snapshot = { file: null, tabs: [], directories, symbols: [], cursor: null, status: t('ready'), error: '', preferences, panel: null, assistant: null, indexing: false, indexed: 0, back: false, forward: false, fileMenu: null, fileClipboard: null };
  const publish = patch => { if (disposed) return; snapshot = { ...snapshot, ...patch }; for (const listener of subscribers) listener(); };
  const fail = error => { if (error.name !== 'AbortError') publish({ error: errorText(error, t) }); };
  const tabs = () => [...documents].map(([path, doc]) => ({ path, dirty: doc.dirty, pinned: !!doc.pinned })).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const assistant = createSelectionAssistant({ editor: { file: () => current, view: () => editor?.view }, api, t, changed: value => publish({ assistant: value }), translationModel: () => preferences.translationModel, translationLanguage });
  const reading = createReading({ api, documents, currentFile: () => current, visit, t, locale: () => t('readingLanguage') });
  const changes = createChanges(api.git, error => errorText(error, t));
  const files = createFileSearch(api.list);
  const autosave = createAutosave(path => save(path), fail);
  loadSettings();

  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) preferences = readPreferences(JSON.parse(saved));
      configureSettings(preferences);
    } catch { publish({ error: t('settingInvalid') }); }
  }

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
      doc.state = update.state;
      if (!synchronizing) {
        doc.writers.add(owner);
        for (const transaction of update.transactions) if (transaction.docChanged) project.history.record(owner, {
          kind: 'text', path: current, before: transaction.startState.doc, after: transaction.newDoc, changes: transaction.changes,
          group: transaction.isUserEvent('input.type') ? 'input' : transaction.isUserEvent('delete') ? 'delete' : null,
        });
        project.publish({ kind: 'text', path: current, changes: update.changes, source: owner });
        autosave.change(current);
      }
      reading.changed(current);
      publish({ tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved') });
      clearTimeout(timer); timer = setTimeout(() => { void updateIndex().catch(fail); }, 180);
    }
    if (update.docChanged || update.selectionSet) cursor();
  }
  async function display(target) {
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    const file = target.file;
    if (!editor) return false;
    const cached = documents.get(file);
    if (target.source && cached && cached.text === cached.original && cached.version !== target.source.version) {
      acceptDisk(cached, target.source);
      await updateIndex(file); reading.changed(file);
    }
    if (current !== file) {
      const turn = ++generation;
      opening?.abort(); opening = new AbortController();
      publish({ status: t('loading'), error: '' });
      let doc = documents.get(file);
      if (!doc) {
        const result = await api.read(file, opening.signal);
        if (turn !== generation) return false;
        doc = project.documents.get(file) || createBuffer(result); project.documents.set(file, doc); documents.set(file, doc);
      }
      const state = await editor.state(file, doc.text, preferences, doc.state);
      if (turn !== generation) return false;
      if (current) documents.get(current).state = editor.view.state;
      doc.state = state;
      assistant.switchFile(); current = file; editor.show(state); editor.preferences(preferences); editor.readonly(project.locked);
      void updateIndex(file).catch(fail);
      if (turn !== generation || !editor) return false;
      publish({ file, tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved') });
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
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    files.reset();
    scanning?.abort(); const abort = new AbortController(); scanning = abort;
    publish({ indexing: true, indexed: 0, error: '' });
    try {
      const project = await api.project(abort.signal); let bytes = 0, partial = false, truncated = project.truncated;
      abort.signal.throwIfAborted();
      await list('', abort.signal);
      for (const path of [...directories.keys()].filter(Boolean)) {
        try { await list(path, abort.signal); }
        catch (error) { if (abort.signal.aborted) throw error; directories.delete(path); partial = true; }
      }
      const paths = new Set(project.files);
      for (const path of [...index.files.keys()]) if (!paths.has(path) && !documents.has(path)) index.remove(path);
      for (const path of new Set([...project.files, ...documents.keys()])) {
        abort.signal.throwIfAborted();
        let doc = documents.get(path), text; const version = doc?.version;
        try {
          if (doc && doc.text !== doc.original) text = doc.text;
          else {
            const loaded = await api.read(path, abort.signal);
            abort.signal.throwIfAborted();
            text = doc && (doc.text !== doc.original || doc.version !== version) ? doc.text : loaded.text;
            if (doc && doc.text === doc.original && doc.version === version && doc.version !== loaded.version) {
              acceptDisk(doc, loaded);
              reading.changed(path);
            }
          }
          bytes += text.length * 2;
          if (bytes > INDEX_BYTES) { truncated = true; break; }
          await index.change(path, text);
          abort.signal.throwIfAborted();
        } catch (error) {
          if (abort.signal.aborted) throw error;
          if (error.message.includes('WORKBENCH_NOT_FILE') && doc && doc.text === doc.original && doc.version === version) {
            documents.delete(path); index.remove(path);
            if (current === path) { assistant.switchFile(); current = null; editor?.dispose(); publish({ file: null, cursor: null, symbols: [] }); }
          } else partial = true;
        }
        if (index.files.size % 20 === 0) publish({ indexed: index.files.size });
      }
      await updateIndex();
      abort.signal.throwIfAborted();
      publish({ tabs: tabs(), indexed: index.files.size, status: truncated ? t('indexLimit') : partial ? t('indexPartial') : message(t, 'indexed', { count: index.files.size }) });
    } catch (error) { if (!abort.signal.aborted) fail(error); }
    finally { if (scanning === abort) publish({ indexing: false }); }
  }
  async function persist(path) {
    const doc = project.documents.get(path);
    if (!doc || !doc.dirty) return;
    const result = await api.save({ path, text: doc.text, version: doc.version });
    doc.original = result.text; doc.version = result.version;
    if (!doc.dirty) doc.writers.clear();
    project.publish({ kind: 'saved', path, source: owner });
    publish({ tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved'), error: '' });
    changes.invalidate();
  }
  async function save(path = current) {
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    if (!project || !path) return;
    autosave.cancel(path);
    const result = project.run(() => persist(path)); saving = result;
    try { await result; } finally { if (saving === result) saving = null; }
  }
  async function definition() {
    if (!current) return;
    await updateIndex();
    const view = editor.view, offset = view.state.selection.main.head, { word } = wordAt(view.state.doc, offset);
    if (!word) return;
    const result = index.navigate(current, word, offset);
    if (result.kind === 'definitions' && result.matches.length === 1) await visit(result.matches[0]);
    else publish({ panel: { kind: 'locations', title: `${word} · ${t(result.kind === 'usages' ? 'occurrences' : 'definitions')}`, ...result } });
  }
  function configureSettings(value) {
    preferences = value; editor?.preferences(preferences); autosave.configure(preferences.autoSave); project?.history.limit(preferences.undoLimit); publish({ preferences });
    for (const [path, doc] of documents) if (doc.dirty) autosave.change(path);
  }
  function settings(value) {
    configureSettings(readPreferences(value));
    project?.publish({ kind: 'settings', preferences, source: owner });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { publish({ error: t('settingsFailed') }); }
  }
  function forgetFiles(affected) {
    opening?.abort(); generation++;
    for (const path of [...documents.keys()]) if (affected(path)) { documents.delete(path); autosave.cancel(path); }
    for (const path of [...index.versions.keys()]) if (affected(path)) index.remove(path);
    for (const path of [...directories.keys()]) if (affected(path)) directories.delete(path);
    const next = history.slice(0, at + 1).filter(item => !affected(item.file)).length - 1;
    history = history.filter(item => !affected(item.file)); at = next;
    if (current && affected(current)) { assistant.switchFile(); current = null; editor?.dispose(); publish({ file: null, cursor: null, symbols: [] }); }
    if (snapshot.fileClipboard && affected(snapshot.fileClipboard.path)) publish({ fileClipboard: null });
  }
  async function fileOperation(input) {
    if (input.action === 'absolutePath') return api.fileOperation(input);
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    let finish;
    const abort = new AbortController(), finished = new Promise(resolve => { finish = resolve; });
    operation = { abort, finished };
    const target = input.action === 'copy' ? input.destination : input.path;
    let attempted = false;
    try {
      await navigation; await saving; abort.signal.throwIfAborted();
      const affected = path => path === input.path || path.startsWith(`${input.path}/`);
      if (input.action === 'trash' && [...project.documents].some(([path, doc]) => affected(path) && doc.dirty)) throw new Error('WORKBENCH_FILE_UNSAVED');
      if (input.action === 'trash') {
        scanning?.abort(); clearTimeout(timer); publish({ indexing: false });
        assistant.switchFile(); editor?.readonly(true);
      }
      attempted = true;
      const result = await project.exclusive(async () => {
        if (input.action === 'trash' && [...project.documents].some(([path, doc]) => affected(path) && doc.dirty)) throw new Error('WORKBENCH_FILE_UNSAVED');
        return api.fileOperation(input, abort.signal);
      });
      if (result.token) project.history.record(owner, { kind: 'file', path: result.path, token: result.token });
      if (input.action === 'trash') { for (const path of project.documents.keys()) if (affected(path)) project.documents.delete(path); project.publish({ kind: 'files', path: input.path, source: owner }); forgetFiles(affected); }
      return result;
    } finally {
      if (attempted && !abort.signal.aborted) {
        try { await list(target.split('/').slice(0, -1).join('/'), abort.signal); } catch (error) { fail(error); }
        files.reset(); changes.invalidate();
      }
      operation = null;
      if (editor?.view) editor.readonly(project.locked);
      publish({ tabs: tabs(), back: at > 0, forward: at < history.length - 1 });
      finish();
    }
  }
  function applyText(path, changes) {
    const doc = project.documents.get(path);
    synchronizing = true;
    try {
      if (path === current && editor?.view) editor.view.dispatch({ changes });
      else doc.state = (doc.state || EditorState.create({ doc: doc.text })).update({ changes }).state;
    } finally { synchronizing = false; }
    doc.writers.add(owner); if (!doc.dirty) doc.writers.clear();
    reading.changed(path); project.publish({ kind: 'text', path, changes, source: owner }); publish({ tabs: tabs() });
  }
  function acceptDisk(doc, loaded) {
    const before = doc.state?.doc || asText(doc.text), after = asText(loaded.text);
    if (!before.eq(after)) applyText(doc.path, { from: 0, to: before.length, insert: after });
    doc.original = loaded.text; doc.version = loaded.version;
    doc.writers.clear();
  }
  function projectChanged(event) {
    if (event.kind === 'lock') { if (event.locked) assistant.switchFile(); editor?.readonly(event.locked); return; }
    if (event.source === owner) return;
    if (event.kind === 'files') forgetFiles(path => path === event.path || path.startsWith(`${event.path}/`));
    if (event.kind === 'settings') configureSettings(event.preferences);
    if (event.kind === 'text' && current === event.path && editor?.view) {
      synchronizing = true; receiving = true;
      try { editor.view.dispatch({ changes: event.changes }); } finally { synchronizing = false; receiving = false; }
    }
    if (event.kind === 'text') reading.changed(event.path);
    publish({ tabs: tabs(), ...(event.kind === 'saved' && event.path === current ? { status: documents.get(current)?.dirty ? t('unsaved') : t('saved') } : {}) });
  }
  const editing = {
    api, owner, documents, get project() { return project; }, get current() { return current; },
    applyText, acceptDisk, persist, schedule: path => autosave.change(path), cancel: path => autosave.cancel(path),
    async remove(path) {
      const affected = value => value === path || value.startsWith(`${path}/`);
      for (const file of project.documents.keys()) if (affected(file)) project.documents.delete(file);
      project.publish({ kind: 'files', path, source: owner }); forgetFiles(affected);
      await list(path.split('/').slice(0, -1).join('/')); files.reset();
    },
  };
  async function undo(direction = 'undo') {
    if (!project || operation) throw new Error('WORKBENCH_FILE_BUSY');
    await navigation; await saving;
    const entry = await undoEdit(editing, direction);
    changes.invalidate();
    publish({ tabs: tabs(), status: t(!entry ? 'undoEmpty' : direction === 'undo' ? 'undone' : 'redone'), error: '' });
    if (entry?.kind === 'text') { if (entry.path !== current) await visit({ file: entry.path }); else void updateIndex().catch(fail); }
  }
  function bindProject(root) {
    if (!projects.has(root.path)) projects.set(root.path, createProject(api, fail));
    unsubscribeProject(); const previous = project; project = projects.get(root.path); unsubscribeProject = project.subscribe(projectChanged);
    if (previous && previous !== project) { documents.clear(); current = null; history = []; at = -1; editor?.dispose(); publish({ file: null, tabs: [], symbols: [], cursor: null }); }
    for (const path of documents.keys()) { const doc = project.documents.get(path); if (doc) documents.set(path, doc); else documents.delete(path); }
    project.history.limit(preferences.undoLimit); assistant.bind(project.conversations);
    for (const [path, doc] of documents) if (doc.dirty) autosave.change(path);
  }
  return {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    snapshot: () => snapshot, documents, index, assistant, reading, changes, files, t,
    git: changes.run,
    async attach(parent, tooltipParent) {
      loadSettings();
      editor = createEditor({ parent, tooltipParent, index, t, changed, assistant, receiving: () => receiving, currentFile: () => current,
        commands: { definition: () => { void definition().catch(fail); return true; }, project: () => { publish({ panel: { kind: 'search' } }); return true; },
          save: () => { void save().catch(fail); return true; },
          projectReplace: () => { publish({ panel: { kind: 'projectReplace' } }); return true; },
          undo: () => { void undo().catch(fail); return true; }, redo: () => { void undo('redo').catch(fail); return true; },
          back: () => { void move(-1).catch(fail); return true; }, forward: () => { void move(1).catch(fail); return true; } },
      });
      const attached = editor;
      publish({ preferences });
      await operation?.finished;
      if (editor !== attached) return;
      const root = await api.fileOperation({ action: 'absolutePath', path: '' });
      if (editor !== attached) return;
      bindProject(root);
      if (current) { const target = history[at] || { file: current }; current = null; await display(target); }
      if (editor === attached) await refresh();
    },
    detach() { opening?.abort(); scanning?.abort(); files.activate(false); generation++; clearTimeout(timer); publish({ fileMenu: null }); assistant.switchFile(); analyzer.dispose(); if (current && editor?.view) documents.get(current).state = editor.view.state; editor?.dispose(); editor = null; },
    dispose() { this.detach(); autosave.dispose(); unsubscribeProject(); disposed = true; assistant.dispose(); reading.dispose(); changes.dispose(); files.dispose(); documents.clear(); index.clear(); subscribers.clear(); },
    visit, move, list, refresh, save, settings, definition, fail, fileOperation, undo, models: api.models, searchProject: api.searchProject,
    async replaceProject(matches, query, progress, signal) {
      if (!project || operation) throw new Error('WORKBENCH_FILE_BUSY');
      await saving;
      try { return await replaceFiles(editing, matches, query, progress, signal); }
      finally { changes.invalidate(); publish({ tabs: tabs() }); void updateIndex().catch(fail); }
    },
    async openConversation(row) {
      try { await visit({ file: row.file, line: row.line, character: row.character, length: row.to - row.from }); }
      finally { assistant.open(row.id); }
    },
    menu(value) { publish({ fileMenu: value }); },
    copyFile({ path, type }) { publish({ fileClipboard: { path, type }, status: t('fileCopied'), error: '' }); },
    async pinFile(path) { await visit({ file: path }); const doc = documents.get(path); if (doc) { doc.pinned = !doc.pinned; publish({ tabs: tabs() }); } },
    view: () => editor?.view,
    panel(value) { publish({ panel: value }); },
  };
}
