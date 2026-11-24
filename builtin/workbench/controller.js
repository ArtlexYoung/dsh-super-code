import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { SymbolIndex } from './analysis/index.js';
import { createEditor } from './editor/view.js';
import { readingScopeHead } from './editor/scope.js';
import { defaults } from './editor/preferences.js';
import { createEditorPreference } from './preference.js';
import { createLayoutPreference } from './layout.js';
import { wordAt } from './editor/code-info.js';
import { createSelectionAssistant } from './assistant/controller.js';
import { message, errorText } from './locales.js';
import { createReading } from './reading/controller.js';
import { createAnalyzer } from './analysis/background.js';
import { createBuffer } from './buffer.js';
import { createChanges, isGitRead } from './git/changes.js';
import { createFileSearch } from './file-search.js';
import { createProject } from './editing/project.js';
import { asText, textChanges } from './editing/history.js';
import { createAutosave } from './editing/autosave.js';
import { undoEdit, replaceFiles, operateFiles } from './editing/actions.js';
import { moveMapEntry } from './editing/move.js';
import { readReplacement, remainingReplacements } from './editing/replace.js';
import { readSaveConflict, applySaveConflict } from './editing/save-conflict.js';
import { createWorkspaceRecovery } from './recovery.js';
import { createDraftRecovery } from './draft-recovery.js';
import { connectStudy } from './study-store.js';
import { restoreDraft } from './editing/drafts.js';
import { createTabs, createClosedTabs, tabsToClose } from './tabs.js';
import { createEditorGroups } from './editor/groups.js';
import { createWindowRoute } from './windows/route.js';
import { createWindowView } from './windows/view.js';
import { diffLines } from 'diff';
import { compareText, MAX_DIFF_LINES } from '../../src/workbench/git/text-diff.ts';
import { uniqueId } from './id.js';
import { locationBatches, projectSearchDefaults } from '../../src/workbench/search-query.ts';
import { externalDefinitions } from './analysis/environment.js';
import { createEnvironmentPreference } from './environment-preference.js';

const projectViews = new WeakMap();

function collectBuffers(project, paths) {
  for (const path of paths) {
    const doc = project.documents.get(path);
    if (!doc || doc.dirty || doc.pinned || [...project.conversationScopes.values()].some(store => store.files.get(path)?.length)) continue;
    if ([...(projectViews.get(project) || [])].some(documents => documents.has(path))) continue;
    project.documents.delete(path);
  }
}

export function createWorkbench(api, t, { projects = new Map(), translationLanguage, settings: preference = createEditorPreference(localStorage), layout = createLayoutPreference(localStorage), sharedIndex, historyOwner, pane = false, session, draftStore, draftRecovery, stopRecovery, closedTabs = createClosedTabs(), studyStore, studyScope = studyStore } = {}) {
  const analyzer = createAnalyzer(), documents = new Map(), states = new Map(), subscribers = new Set(), directories = new Map(), listings = new Map();
  const index = sharedIndex || new SymbolIndex(analyzer.analyze, { read: async (file, signal) => project.documents.get(file)?.text ?? (await api.read(file, signal)).text,
    external: async (file, name, offset, source, signal) => {
      await binding;
      const target = project, state = target.environment.snapshot(), paths = state.paths;
      if (state.invalid) throw new Error(t('settingInvalid'));
      const result = await externalDefinitions(api, analyzer.analyze, paths, file, name, offset, source, signal);
      if (project !== target || paths !== target.environment.snapshot().paths) throw new DOMException('Workspace changed', 'AbortError');
      return result;
    } });
  let editor, current = null, generation = 0, opening, scanning, timer, preferences = defaults(), disposed = false;
  let history = [], at = -1, moving = false, navigation = Promise.resolve(), binding = Promise.resolve(), requested = 0;
  let saving, operation, pendingClose;
  let projectPath, resuming;
  let studyReading, previousStudyWrite;
  const studyPins = new Map(), studyErrors = new Map();
  const locations = new Map();
  let kept = false, retainedParent, retainedHost;
  const editorSubscribers = new Set();
  const locationSubscribers = new Set();
  // 同会话窗口共用撤销记录，编辑通知仍按视图区分，保证其他窗口收到修改。
  const owner = historyOwner || Symbol('workbench'), origin = Symbol('workbench-view');
  let project, unsubscribeProject = () => {}, synchronizing = false, receiving = false;
  let snapshot = { searchQuery: { ...projectSearchDefaults }, file: null, editorKind: 'file', tabs: [], canReopenTab: Boolean(closedTabs.peek()), recentFiles: [], saveConflict: null, directories, symbols: [], cursor: null, status: t('ready'), error: '', preferences, environmentPaths: {}, panel: null, assistant: null, indexing: false, indexed: 0, back: false, forward: false, fileMenu: null, fileClipboard: null, closingFile: null };
  const publish = patch => { if (disposed) return; snapshot = { ...snapshot, unsaved: [...(project?.documents.values() || [])].filter(doc => doc.dirty).map(doc => ({ path: doc.path, review: doc.saveReview })), ...patch }; for (const listener of subscribers) listener(); };
  const unsubscribeIndex = index.subscribe(() => publish(index.snapshot()));
  snapshot = { ...snapshot, ...index.snapshot() };
  const fail = error => { if (error.name !== 'AbortError') publish({ error: errorText(error, t) }); };
  const drafts = draftRecovery || (draftStore ? createDraftRecovery(draftStore, t) : null);
  const unsubscribeDrafts = drafts?.subscribe(() => publish({ drafts: drafts.snapshot(projectPath) }));
  const fileTabs = createTabs(documents), tabs = fileTabs.list;
  const unsubscribeClosedTabs = closedTabs.subscribe(() => publish({ canReopenTab: Boolean(closedTabs.peek()) }));
  const assistant = createSelectionAssistant({ editor: { file: () => current, view: () => editor?.view }, api, t, changed: value => publish({ assistant: value }),
    stores: () => project?.conversationScopes.values(), modelOptions: kind => ({ ...(preferences[`${kind}Model`] ? { model: preferences[`${kind}Model`] } : {}), reasoningEffort: preferences[`${kind}Reasoning`] }), translationLanguage });
  const reading = createReading({ api, documents, currentFile: () => current, visit, t, locale: () => t('readingLanguage') });
  const changes = createChanges(async (input, signal) => {
    const target = project;
    try { return await api.git(input, signal); }
    finally { if (!isGitRead(input.action)) target?.publish({ kind: 'git' }); }
  }, error => errorText(error, t));
  const files = createFileSearch(api.list);
  const autosave = createAutosave(async path => {
    const target = project;
    let ready;
    do {
      ready = binding;
      await ready;
      if (operation) await operation.finished;
    } while (ready !== binding || operation);
    if (!disposed && project === target && preferences.autoSave !== 'manual') await save(path, true);
  }, fail);
  const unsubscribeSettings = preference.subscribe(loadSettings);
  loadSettings();

  function loadSettings() {
    const value = preference.snapshot();
    configureSettings(value.preferences);
    if (value.invalid) publish({ error: t('settingInvalid') });
    else if ([t('settingsFailed'), t('settingInvalid')].includes(snapshot.error)) publish({ error: '' });
  }

  function position(reading = false) {
    const view = editor?.view;
    if (!view || !current) return null;
    const range = view.state.selection.main, head = reading && preferences.readerMode && snapshot.editorKind === 'file' ? readingScopeHead(view) : null;
    const from = head ?? range.from, line = view.state.doc.lineAt(from);
    return { file: current, kind: snapshot.editorKind, line: line.number - 1, character: from - line.from, length: head === null ? range.to - range.from : 0 };
  }
  let selectionGroup = null;
  function cursor(update) {
    const value = position(), previous = history[at];
    if (!moving && at >= 0 && value) {
      const pointer = update?.transactions.some(transaction => transaction.isUserEvent('select.pointer'));
      const group = pointer ? update.state.selection.main.anchor : null;
      const distinct = previous && ['file', 'kind', 'line', 'character', 'length'].some(key => previous[key] !== value[key]);
      if (update?.selectionSet && !update.docChanged && distinct && !(pointer && selectionGroup === group)) {
        history.splice(at + 1); history.push(value); at++;
      } else history[at] = value;
      selectionGroup = group;
    }
    publish({ cursor: value, back: at > 0, forward: at < history.length - 1 });
  }
  async function updateIndex(file = current) {
    if (!editor) return;
    const doc = project?.documents.get(file);
    if (!doc) return;
    const text = doc.text;
    await index.change(file, text);
    if (file === current && text === documents.get(file)?.text) publish({ symbols: index.declarations(file) });
  }
  function changed(update) {
    if (current) states.set(current, update.state);
    for (const listener of editorSubscribers) listener({ file: current, update });
    if (update.docChanged) {
      history = history.map(item => {
        if (item.file !== current) return item;
        const before = update.startState.doc.line(Math.min(item.line + 1, update.startState.doc.lines));
        const from = Math.min(before.to, before.from + item.character), end = Math.min(update.startState.doc.length, from + item.length);
        const mapped = update.changes.mapPos(from, -1), line = update.state.doc.lineAt(mapped);
        return { ...item, line: line.number - 1, character: mapped - line.from, length: update.changes.mapPos(end, 1) - mapped };
      });
      const doc = documents.get(current);
      fileTabs.keep(current);
      doc.state = update.state;
      if (!synchronizing) {
        doc.saveReview = false;
        doc.writers.add(owner);
        for (const transaction of update.transactions) if (transaction.docChanged) project.history.record(owner, {
          kind: 'text', path: current, before: transaction.startState.doc, after: transaction.newDoc, changes: transaction.changes,
          group: transaction.isUserEvent('input.type') ? 'input' : transaction.isUserEvent('delete') ? 'delete' : null,
        });
        project.publish({ kind: 'text', path: current, changes: update.changes, source: origin });
        autosave.change(current);
      }
      reading.changed(current);
      publish({ tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved') });
      clearTimeout(timer); timer = setTimeout(() => { void updateIndex().catch(fail); }, 180);
    }
    if (update.docChanged || update.selectionSet) cursor(update);
  }
  function rememberEditor() {
    if (!current || !editor?.view) return;
    locations.set(current, editor.location?.() || position());
    const state = editor.capture();
    documents.get(current).state = state; states.set(current, state);
  }
  async function waitOpening(work, signal) {
    signal.throwIfAborted();
    let cancel;
    const cancelled = new Promise((_resolve, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true }); });
    try { return await Promise.race([work(), cancelled]); }
    finally { signal.removeEventListener('abort', cancel); }
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
      opening?.controller.abort(); const abort = new AbortController(); opening = { file, controller: abort };
      publish({ status: t('loading'), error: '' });
      const targetProject = project;
      let doc = documents.get(file) || targetProject.documents.get(file);
      const version = doc?.version;
      if (!doc || !doc.dirty) {
        let result;
        try { result = target.source || await waitOpening(() => api.read(file, abort.signal), abort.signal); }
        catch (error) { if (abort.signal.aborted) return false; throw error; }
        if (turn !== generation) return false;
        if (doc) { if (doc.version === version && !doc.dirty) acceptDisk(doc, result); }
        else { doc = project.documents.get(file) || createBuffer(result); project.documents.set(file, doc); }
      }
      const fresh = !documents.has(file);
      documents.set(file, doc);
      const abandon = () => {
        if (fresh && documents.get(file) === doc) { documents.delete(file); fileTabs.forget(path => path === file); publish({ tabs: tabs() }); }
        collectBuffers(targetProject, [file]);
      };
      let state;
      try { state = await waitOpening(() => editor.state(file, () => ({ text: doc.text, saved: states.get(file) }), preferences), abort.signal); }
      catch (error) { abandon(); if (abort.signal.aborted) return false; throw error; }
      if (turn !== generation) { abandon(); return false; }
      rememberEditor();
      doc.state = state;
      states.set(file, state);
      const previousPreview = tabs().find(tab => tab.preview)?.path;
      assistant.switchFile(); current = file; fileTabs.open(file, preferences.previewTabs, fresh); editor.show(state); editor.preferences(preferences); editor.readonly(project.locked);
      if (previousPreview && fileTabs.isClosed(previousPreview) && !tabs().some(tab => tab.path === previousPreview)) {
        documents.delete(previousPreview); states.delete(previousPreview); fileTabs.forget(path => path === previousPreview);
        collectBuffers(project, [previousPreview]);
      }
      void updateIndex(file).catch(fail);
      if (turn !== generation || !editor) return false;
      publish({ file, recentFiles: [file, ...snapshot.recentFiles.filter(path => path !== file)].slice(0, 50), tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved') });
    }
    const editorKind = target.kind === 'markdown' ? 'markdown' : 'file';
    if (editorKind === 'markdown') fileTabs.render(file);
    else if (fileTabs.isClosed(file)) fileTabs.open(file, preferences.previewTabs);
    publish({ editorKind, tabs: tabs(), status: documents.get(file).dirty ? t('unsaved') : t('saved') });
    const view = editor.view;
    assistant.validateRestored(file, view.state);
    const thread = target.threadId && assistant.threads(file).find(item => item.id === target.threadId);
    const location = thread && !thread.stale ? { line: thread.line, character: thread.character, length: thread.to - thread.from } : target;
    if (location.line !== undefined || location.character !== undefined || location.length !== undefined) {
      const line = view.state.doc.line(Math.min((location.line ?? 0) + 1, view.state.doc.lines));
      const from = Math.min(line.to, line.from + (location.character ?? 0));
      view.dispatch({ selection: { anchor: from, head: Math.min(view.state.doc.length, from + (location.length ?? 0)) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    }
    if (editorKind === 'file') view.focus();
    cursor(); return true;
  }
  function stopRestoring() { recovery?.stop(); stopRecovery?.(); resuming?.abort(); }
  function visit(target, restoring = false) {
    if (!restoring) stopRestoring();
    if (target.library) { controller.panel({ kind: 'library', title: target.file, target }); return Promise.resolve(); }
    const ready = binding, request = ++requested;
    opening?.controller.abort();
    const work = navigation.then(async () => {
      await ready;
      if (binding !== ready || request !== requested) return;
      const previous = position(true); if (at >= 0 && previous) history[at] = previous;
      moving = true;
      try { if (await display(target)) { history.splice(at + 1); history.push(position()); at++; } }
      finally { moving = false; cursor(); }
    });
    navigation = work.catch(restoring ? () => {} : fail); return work;
  }
  function move(direction) {
    stopRestoring();
    const ready = binding;
    opening?.controller.abort();
    const work = navigation.then(async () => {
      await ready;
      if (binding !== ready) return;
      const next = at + direction; if (next < 0 || next >= history.length) return;
      const before = position(true); if (before) history[at] = before;
      moving = true;
      try { if (await display(history[next])) at = next; } finally { moving = false; cursor(); }
    });
    navigation = work.catch(fail); return work;
  }
  async function selectNeighbor(items, index) {
    const next = items[index + 1] || items[index - 1];
    if (next) {
      moving = true;
      try {
        if (!await display({ file: next.path, kind: next.kind })) return false;
        history.splice(at + 1); history.push(position()); at++;
      } finally { moving = false; }
      return true;
    }
    rememberEditor();
    assistant.switchFile(); current = null; editor?.dispose(); clearTimeout(timer);
    publish({ file: null, editorKind: 'file', cursor: null, symbols: [], status: t('ready') });
    return true;
  }
  async function confirmClose(path, mode) {
    const doc = documents.get(path);
    if (mode === 'check' && doc.dirty) { publish({ closingFile: path }); return false; }
    if (mode === 'save') { await save(path); if (doc.dirty) throw new Error('WORKBENCH_TAB_CHANGED'); }
    return true;
  }
  async function removeTab({ path, kind }, mode, ready) {
    const items = tabs(), index = items.findIndex(item => item.path === path && item.kind === kind);
    if (index < 0) return true;
    rememberEditor();
    const location = locations.get(path), doc = documents.get(path);
    if (current === path && snapshot.editorKind === kind && !await selectNeighbor(items, index)) return false;
    if (binding !== ready || disposed) return false;
    fileTabs.close(path, kind);
    if (mode !== 'move') closedTabs.record({ file: path, kind, location });
    publish({ tabs: tabs(), closingFile: null, status: doc.dirty ? t('tabClosedWithEdits') : snapshot.status, error: '' });
    cursor(); return true;
  }
  async function closeTab(item, mode, preservePinned) {
    const ready = binding, currentTab = tabs().find(tab => tab.path === item.path && tab.kind === item.kind);
    if (!currentTab || preservePinned && currentTab.pinned) return true;
    if (item.kind === 'file' && !await confirmClose(item.path, mode)) return false;
    if (binding !== ready || disposed) return false;
    return removeTab(item, mode, ready);
  }
  function runClose(request, mode = 'check') {
    stopRestoring();
    const ready = binding;
    if (pendingClose !== request) { pendingClose = request; publish({ closingFile: null }); }
    const work = navigation.then(async () => {
      await ready; await saving;
      while (pendingClose === request && request.items.length && binding === ready && !disposed) {
        if (operation || project?.locked) throw new Error('WORKBENCH_FILE_BUSY');
        if (!await closeTab(request.items[0], mode, request.preservePinned)) return;
        request.items.shift(); mode = 'check';
      }
    });
    navigation = work.catch(fail); return work;
  }
  function closeFile(path, mode = 'check', kind = 'file') {
    const head = pendingClose?.items[0];
    const request = mode !== 'check' && head?.path === path && head.kind === kind ? pendingClose : { items: [{ path, kind }], preservePinned: false };
    return runClose(request, mode);
  }
  function closeTabs(mode, path, kind) {
    return runClose({ items: tabsToClose(tabs(), mode, path, kind), preservePinned: true });
  }
  function reopenTab() {
    stopRestoring();
    const ready = binding;
    const work = navigation.then(async () => {
      await ready;
      const entry = closedTabs.peek();
      if (!entry || disposed || binding !== ready) return;
      const previous = position(true); if (at >= 0 && previous) history[at] = previous;
      const sourceOpen = tabs().some(item => item.path === entry.file && item.kind === 'file');
      const location = states.has(entry.file) ? undefined : entry.location;
      moving = true;
      try {
        if (!await display({ ...location, file: entry.file, kind: entry.kind })) return;
        if (entry.kind === 'markdown' && !sourceOpen) fileTabs.close(entry.file);
        fileTabs.keep(entry.file); closedTabs.remove(entry);
        history.splice(at + 1); history.push(position()); at++;
        await editor.restoreViewport?.(location?.viewport);
        publish({ tabs: tabs() });
      } finally { moving = false; cursor(); }
    });
    navigation = work.catch(fail); return work;
  }
  async function list(path = '', signal) {
    const request = {}; listings.set(path, request);
    try {
      const result = await api.list(path, signal);
      signal?.throwIfAborted();
      if (listings.get(path) === request) { directories.set(path, result); publish({ directories: new Map(directories) }); }
      return result;
    } finally { if (listings.get(path) === request) listings.delete(path); }
  }
  async function refresh() {
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    if (sharedIndex) { await list(''); await updateIndex(); return; }
    files.reset();
    scanning?.abort(); const abort = new AbortController(); scanning = abort;
    index.progress({ indexing: true, indexPartial: true });
    publish({ indexing: true, indexed: 0, error: '' });
    try {
      await list('', abort.signal);
      const listing = await api.project(abort.signal), retained = new Set(); let partial = false, updated = Date.now();
      const cached = listing.cached || {}, metadata = []; let metadataBytes = 0, yielding = performance.now();
      abort.signal.throwIfAborted();
      for (const path of [...directories.keys()].filter(Boolean)) {
        try { await list(path, abort.signal); }
        catch (error) { if (abort.signal.aborted) throw error; directories.delete(path); partial = true; }
      }
      const paths = new Set(listing.files);
      for (const path of [...index.files.keys()]) if (!paths.has(path) && !documents.has(path)) index.remove(path);
      for (const path of new Set([...listing.files, ...project.documents.keys()])) {
        abort.signal.throwIfAborted();
        let doc = project.documents.get(path), text; const version = doc?.version;
        try {
          if (!doc && cached[path]) {
            index.restore(path, cached[path]); retained.add(path);
            if (performance.now() - yielding >= 12) { publish({ indexed: index.files.size }); await new Promise(resolve => setTimeout(resolve, 0)); yielding = performance.now(); }
            continue;
          }
          let disk;
          if (doc && doc.text !== doc.original) text = doc.text;
          else {
            const loaded = await api.read(path, abort.signal);
            disk = loaded;
            abort.signal.throwIfAborted();
            doc = project.documents.get(path);
            text = doc && (doc.text !== doc.original || doc.version !== version) ? doc.text : loaded.text;
            if (doc && doc.text === doc.original && doc.version === version && doc.version !== loaded.version) {
              acceptDisk(doc, loaded);
              reading.changed(path);
            }
          }
          await index.change(path, text);
          retained.add(path);
          abort.signal.throwIfAborted();
          const latest = project.documents.get(path), entry = index.files.get(path);
          if (api.storeIndex && disk && (!latest || !latest.dirty && latest.text === text && latest.version === disk.version) && /^[a-z]+:[a-f0-9]{64}$/.test(entry?.key || '')) {
            const value = { path, version: disk.version, key: entry.key, filter: Array.from(entry.filter), symbols: index.declarations(path).map(({ name, offset, line, character, kind }) => ({ name, offset, line, character, kind })) };
            const size = JSON.stringify(value).length;
            // 限制上传缓存，不限制索引文件数；没被保存的部分下次照常分析。
            if (metadataBytes + size < 8 * 1024 * 1024) { metadata.push(value); metadataBytes += size; }
          }
        } catch (error) {
          if (abort.signal.aborted) throw error;
          if (error.message.includes('WORKBENCH_NOT_FILE') && doc && doc.text === doc.original && doc.version === version) {
            project.documents.delete(path); project.publish({ kind: 'files', path, source: origin }); forgetFiles(path);
          } else partial = true;
        }
        if (Date.now() - updated >= 100) { publish({ indexed: index.files.size }); updated = Date.now(); }
      }
      for (const path of index.files.keys()) if (!retained.has(path) && path !== current) index.remove(path);
      await updateIndex();
      abort.signal.throwIfAborted();
      if (metadata.length) await api.storeIndex(metadata, abort.signal);
      index.progress({ indexPartial: listing.truncated || partial });
      publish({ tabs: tabs(), indexed: index.files.size, status: listing.truncated ? t('indexLimit') : partial ? message(t, 'indexPartial', { count: index.files.size }) : message(t, 'indexed', { count: index.files.size }) });
    } catch (error) { if (!abort.signal.aborted) fail(error); }
    finally { if (scanning === abort) index.progress({ indexing: false }); }
  }
  async function persist(path) {
    const target = project, doc = target.documents.get(path);
    if (!doc || !doc.dirty) return;
    let result;
    try { result = await api.save({ path, text: doc.text, version: doc.version }); }
    catch (error) {
      if (error.message.includes('WORKBENCH_CONFLICT') && project === target) publish({ saveConflict: path });
      throw error;
    }
    doc.original = result.text; doc.version = result.version; doc.saveReview = false;
    if (!doc.dirty) doc.writers.clear();
    target.publish({ kind: 'saved', path, source: origin });
    if (project === target) {
      publish({ tabs: tabs(), status: doc.dirty ? t('unsaved') : t('saved'), error: '', saveConflict: snapshot.saveConflict === path ? null : snapshot.saveConflict });
      changes.invalidate();
    }
  }
  async function save(path = current, automatic = false) {
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    if (!project || !path) return;
    autosave.cancel(path);
    const target = project, ready = binding;
    const result = target.run(() => {
      if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
      if (automatic && target.documents.get(path)?.saveReview) return;
      return persist(path);
    }); saving = result;
    try { await result; } finally { if (saving === result) saving = null; }
  }
  async function saveAll() {
    if (!project || snapshot.saveBatch?.busy) return;
    const target = project, ready = binding, paths = [...target.documents.values()].filter(doc => doc.dirty).map(doc => doc.path), failures = [];
    const active = () => project === target && binding === ready;
    publish({ saveBatch: { busy: true, completed: 0, total: paths.length, failures } });
    try {
      for (const [index, path] of paths.entries()) {
        if (!active()) throw new Error('WORKBENCH_PROJECT_CHANGED');
        try { await save(path); } catch (error) { failures.push({ path, error: errorText(error, t), conflict: error.message.includes('WORKBENCH_CONFLICT') }); }
        if (active()) publish({ saveBatch: { busy: true, completed: index + 1, total: paths.length, failures: [...failures] } });
      }
    } finally { if (active()) publish({ saveBatch: { ...snapshot.saveBatch, busy: false } }); }
  }
  async function syncGitFile(target, path) {
    const ready = binding;
    try {
      const loaded = await api.read(path), doc = target.documents.get(path);
      if (doc) { acceptDisk(doc, loaded, target); target.publish({ kind: 'saved', path, source: origin }); }
      if (project !== target || binding !== ready) return;
      await index.change(path, loaded.text);
    } catch (error) {
      if (!error.message.includes('WORKBENCH_NOT_FILE')) throw error;
      target.documents.delete(path); target.publish({ kind: 'files', path, source: origin });
      if (project === target && binding === ready) forgetFiles(path);
    }
  }
  async function syncGitFiles(target, paths) {
    const ready = binding;
    for (const path of paths) {
      if (project !== target || binding !== ready) return;
      await syncGitFile(target, path);
    }
    for (const path of new Set(paths.map(path => path.split('/').slice(0, -1).join('/')))) {
      if (project !== target || binding !== ready) return;
      await list(path);
    }
    if (project === target && binding === ready) publish({ tabs: tabs(), status: t('saved') });
  }
  async function git(input, signal) {
    const fileEdit = input.action === 'resolveConflict' || input.action === 'restoreHunk' && input.side !== 'staged';
    if (!fileEdit && !['checkout', 'pull', 'merge', 'abortMerge'].includes(input.action)) return changes.run(input, signal);
    const ready = binding;
    await ready;
    if (binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
    const target = project;
    return target.exclusive(async () => {
      if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
      signal?.throwIfAborted();
      if (fileEdit ? target.documents.get(input.path)?.dirty : [...target.documents.values()].some(doc => doc.dirty)) throw new Error('WORKBENCH_GIT_UNSAVED');
      try { return await changes.run(input, signal); }
      finally {
        if (project === target && binding === ready) {
          const paths = fileEdit ? [input.path] : [...target.documents.keys()];
          try { await syncGitFiles(target, paths); }
          catch (error) { if (project === target && binding === ready) publish({ error: message(t, 'gitSyncFailed', { error: errorText(error, t) }) }); }
          finally { if (project === target && binding === ready) files.reset(); }
        }
      }
    });
  }
  async function definition() {
    if (!current) return;
    const abort = new AbortController();
    opening?.controller.abort(); opening = { file: current, controller: abort };
    try { await locateDefinition(current, editor.view.state.doc, abort.signal); }
    catch (error) { if (!abort.signal.aborted) throw error; }
  }
  async function locateDefinition(file, document, signal) {
    await updateIndex();
    if (file !== current || document !== editor?.view?.state.doc) return;
    const view = editor.view, offset = view.state.selection.main.head, { word } = wordAt(view.state.doc, offset);
    if (!word) return;
    const result = await index.navigate(file, word, offset, signal);
    if (file !== current || document !== editor?.view?.state.doc) return;
    if (result.kind === 'definitions' && result.matches.length === 1) await visit(result.matches[0]);
    else controller.panel({ kind: 'locations', title: `${word} · ${t(result.kind === 'usages' ? 'occurrences' : 'definitions')}`, ...result });
  }
  function configureSettings(value) {
    preferences = value; editor?.preferences(preferences); autosave.configure(preferences.autoSave);
    if (!preferences.previewTabs) for (const path of documents.keys()) fileTabs.keep(path);
    if (project) { const target = project; void target.run(() => target.history.limit(value.undoLimit)).catch(fail); }
    publish({ preferences, tabs: tabs() });
    for (const [path, doc] of documents) if (doc.dirty) autosave.change(path);
  }
  function settings(value) {
    try { preference.save(value); }
    catch (error) {
      if (error.message === 'WORKBENCH_SETTINGS_WRITE') throw new Error(t('settingsFailed'), { cause: error });
      throw error;
    }
  }
  async function submitFileAction() {
    const dialog = snapshot.panel;
    if (dialog?.kind !== 'fileAction' || dialog.busy) return;
    const update = patch => { if (snapshot.panel?.id === dialog.id) publish({ panel: { ...snapshot.panel, ...patch } }); };
    update({ busy: true, error: '' });
    try {
      const { name } = dialog;
      const path = dialog.action === 'trash' ? dialog.path : dialog.action === 'move' ? name : [dialog.parent, name].filter(Boolean).join('/');
      if (!['trash', 'move'].includes(dialog.action) && (!name.trim() || /[/\\\0]/.test(name) || ['.', '..'].includes(name))) throw new Error('WORKBENCH_FILE_NAME');
      const input = ['rename', 'move'].includes(dialog.action) ? { action: 'move', path: dialog.path, destination: path }
        : dialog.action === 'copy' ? { action: 'copy', path: dialog.source.path, destination: path } : { action: dialog.action, path };
      const result = await fileOperation(input);
      if (snapshot.panel?.id === dialog.id) publish({ panel: null });
      if (dialog.action === 'createFile') { await visit({ file: result.path }); controller.keepTab(result.path); }
    } catch (error) { if (snapshot.panel?.id === dialog.id) update({ error: errorText(error, t) }); else fail(error); }
    finally { update({ busy: false }); }
  }
  function forgetFiles(path) {
    const affected = value => value === path || value.startsWith(`${path}/`);
    const cancelled = opening && affected(opening.file);
    if (cancelled) { opening.controller.abort(); generation++; }
    fileTabs.forget(affected); closedTabs.forget(affected);
    for (const path of [...documents.keys()]) if (affected(path)) { documents.delete(path); autosave.cancel(path); }
    for (const path of states.keys()) if (affected(path)) states.delete(path);
    for (const path of locations.keys()) if (affected(path)) locations.delete(path);
    for (const path of [...index.versions.keys()]) if (affected(path)) index.remove(path);
    for (const directory of listings.keys()) if (affected(directory) || !directory || path.startsWith(`${directory}/`)) listings.delete(directory);
    for (const [directory, result] of directories) {
      if (affected(directory)) directories.delete(directory);
      else { const entries = result.entries.filter(entry => !affected(entry.path)); if (entries.length !== result.entries.length) directories.set(directory, { ...result, entries }); }
    }
    publish({ directories: new Map(directories), recentFiles: snapshot.recentFiles.filter(file => !affected(file)),
      saveConflict: snapshot.saveConflict && affected(snapshot.saveConflict) ? null : snapshot.saveConflict });
    const next = history.slice(0, at + 1).filter(item => !affected(item.file)).length - 1;
    history = history.filter(item => !affected(item.file)); at = next;
    if (current && affected(current)) { assistant.switchFile(); current = null; editor?.dispose(); publish({ file: null, cursor: null, symbols: [] }); }
    if (snapshot.fileClipboard && affected(snapshot.fileClipboard.path)) publish({ fileClipboard: null });
    if (snapshot.closingFile && affected(snapshot.closingFile)) publish({ closingFile: null });
    cursor();
    if (cancelled) publish({ status: t(current ? documents.get(current).dirty ? 'unsaved' : 'saved' : 'ready') });
  }
  async function fileOperation(input) {
    if (input.action === 'absolutePath') return api.fileOperation(input);
    const ready = binding;
    await ready;
    if (binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
    if (operation) throw new Error('WORKBENCH_FILE_BUSY');
    let finish;
    const abort = new AbortController(), finished = new Promise(resolve => { finish = resolve; });
    operation = { abort, finished };
    const target = project, destination = 'destination' in input ? input.destination : input.path;
    let attempted = false;
    try {
      await navigation; await saving; abort.signal.throwIfAborted();
      if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
      if (['trash', 'move'].includes(input.action)) {
        scanning?.abort(); clearTimeout(timer); publish({ indexing: false });
        assistant.switchFile(); editor?.readonly(true);
      }
      attempted = true;
      return await operateFiles(editing, input, abort.signal);
    } finally {
      if (attempted && !abort.signal.aborted && project === target && binding === ready) {
        for (const path of new Set([input.path, destination].map(path => path.split('/').slice(0, -1).join('/')))) {
          try { await list(path, abort.signal); } catch (error) { fail(error); }
          if (input.action !== 'move') target.publish({ kind: 'directory', path, source: origin });
        }
        files.reset(); changes.invalidate();
      }
      operation = null;
      if (editor?.view) editor.readonly(project?.locked);
      publish({ tabs: tabs(), back: at > 0, forward: at < history.length - 1 });
      finish();
    }
  }
  async function reconfigureMovedEditor(path) {
    const attached = editor, view = editor?.view, target = project, doc = documents.get(path);
    if (!view || !doc) return;
    const state = await attached.state(path, () => ({ text: doc.text, saved: states.get(path) }), preferences);
    if (current !== path || documents.get(path) !== doc || project !== target || editor?.view !== view) return;
    states.set(path, state); doc.state = state; attached.show(state); attached.readonly(project.locked);
    cursor();
  }
  async function reindexMovedFile(path) {
    if (project.documents.has(path)) { await updateIndex(path); publish({ indexed: index.files.size }); return; }
    const target = project, ready = binding, marker = Symbol();
    index.versions.set(path, marker);
    let text;
    try { text = (await api.read(path)).text; }
    catch (error) { if (/WORKBENCH_NOT_TEXT|WORKBENCH_FILE_SIZE/.test(error.message)) return; throw error; }
    if (project !== target || binding !== ready || index.versions.get(path) !== marker) return;
    await index.change(path, text);
    if (project === target) publish({ indexed: index.files.size, symbols: index.declarations(current) });
  }
  function moveViewFile(from, to) {
    stopRestoring(); scanning?.abort(); opening?.controller.abort(); clearTimeout(timer); generation++;
    rememberEditor();
    for (const map of [documents, states, locations]) moveMapEntry(map, from, to);
    fileTabs.rename(from, to); closedTabs.rename(from, to); autosave.cancel(from);
    history = history.map(item => item.file === from ? { ...item, file: to } : item);
    if (pendingClose) pendingClose.items = pendingClose.items.map(item => item.path === from ? { ...item, path: to } : item);
    if (current === from) { current = to; void reconfigureMovedEditor(to).catch(fail); }
    index.remove(from); void reindexMovedFile(to).catch(fail);
    reading.stop(); reading.changed(from);
    const remap = path => path === from ? to : path;
    publish({ file: current, tabs: tabs(), recentFiles: snapshot.recentFiles.map(remap), indexing: false, symbols: index.declarations(current),
      saveConflict: remap(snapshot.saveConflict), closingFile: remap(snapshot.closingFile), fileMenu: null,
      fileClipboard: snapshot.fileClipboard && { ...snapshot.fileClipboard, path: remap(snapshot.fileClipboard.path) } });
    if (documents.get(to)?.dirty) autosave.change(to);
    cursor();
  }
  function applyText(path, changes, target = project) {
    const doc = target.documents.get(path), attached = project === target;
    synchronizing = true;
    try {
      if (attached && path === current && editor?.view) editor.view.dispatch({ changes });
      else {
        const transaction = (attached && states.get(path) || doc.state || EditorState.create({ doc: doc.text })).update({ changes });
        doc.state = transaction.state;
        if (attached && states.has(path)) states.set(path, transaction.state);
        assistant.update({ docChanged: transaction.docChanged, transactions: [transaction], state: doc.state }, path, target.conversationScopes.values());
      }
    } finally { synchronizing = false; }
    doc.writers.add(owner); if (!doc.dirty) doc.writers.clear();
    target.publish({ kind: 'text', path, changes, source: origin });
    if (attached) { reading.changed(path); publish({ tabs: tabs() }); }
  }
  function acceptDisk(doc, loaded, target = project) {
    const before = doc.state?.doc || asText(doc.text), after = asText(loaded.text);
    doc.original = loaded.text; doc.version = loaded.version; doc.saveReview = false;
    doc.writers.clear();
    if (!before.eq(after)) {
      let changes;
      try { changes = textChanges(before, after); }
      catch (error) { if (error.message !== 'WORKBENCH_UNDO_CONFLICT') throw error; changes = { from: 0, to: before.length, insert: after }; }
      applyText(doc.path, changes, target);
    }
  }
  function projectChanged(event) {
    if (event.kind === 'beforeMove') { scanning?.abort(); clearTimeout(timer); publish({ indexing: false }); return; }
    if (event.kind === 'move') { moveViewFile(event.from, event.to); return; }
    if (event.kind === 'environment') { publish({ environmentPaths: project.environment.snapshot().paths }); return; }
    if (event.kind === 'lock') { if (event.locked) assistant.switchFile(); editor?.readonly(event.locked); return; }
    if (event.source === origin) return;
    if (event.kind === 'saved' && snapshot.saveConflict === event.path) publish({ saveConflict: null, error: '' });
    if (event.kind === 'files') { forgetFiles(event.path); files.reset(); }
    if (event.kind === 'directory') {
      if (directories.has(event.path) || listings.has(event.path)) void list(event.path).catch(fail);
      files.reset();
    }
    if (['files', 'directory', 'saved', 'git'].includes(event.kind)) changes.invalidate();
    if (event.kind === 'text' && current === event.path && editor?.view) {
      synchronizing = true; receiving = true;
      try { editor.view.dispatch({ changes: event.changes }); } finally { synchronizing = false; receiving = false; }
    }
    if (event.kind === 'text' && current !== event.path && states.has(event.path)) states.set(event.path, states.get(event.path).update({ changes: event.changes }).state);
    if (event.kind === 'text') { reading.changed(event.path); if (event.path !== current) void updateIndex(event.path).catch(fail); }
    publish({ tabs: tabs(), ...(event.kind === 'saved' && event.path === current ? { status: documents.get(current)?.dirty ? t('unsaved') : t('saved') } : {}) });
  }
  const editing = {
    api, owner, documents, get project() { return project; }, get current() { return current; }, get binding() { return binding; },
    applyText, acceptDisk, persist, schedule: path => autosave.change(path), cancel: path => autosave.cancel(path),
    async remove(path, target = project) {
      const affected = value => value === path || value.startsWith(`${path}/`);
      for (const file of target.documents.keys()) if (affected(file)) target.documents.delete(file);
      target.publish({ kind: 'files', path, source: origin });
      target.publish({ kind: 'directory', path: path.split('/').slice(0, -1).join('/'), source: origin });
      if (project !== target) return;
      forgetFiles(path);
      try { await list(path.split('/').slice(0, -1).join('/')); } catch (error) { fail(error); }
      files.reset();
    },
  };
  async function undo(direction = 'undo') {
    if (!project || operation) throw new Error('WORKBENCH_FILE_BUSY');
    const target = project, ready = binding;
    await navigation; await saving;
    if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
    publish({ error: '' });
    const entry = await undoEdit(editing, direction);
    if (project !== target || binding !== ready) return;
    changes.invalidate();
    publish({ tabs: tabs(), status: t(!entry ? 'undoEmpty' : direction === 'undo' ? 'undone' : 'redone') });
    if (entry?.kind === 'text') { if (entry.path !== current) await visit({ file: entry.path }); else void updateIndex().catch(fail); }
  }
  function showStudyError() {
    const errors = studyErrors.get(projectPath);
    publish({ studyError: errors?.pins || errors?.reading || '' });
  }
  function bindStudy(root, kind, state, after) {
    return connectStudy(studyStore(root, kind), state, error => {
      const errors = studyErrors.get(root) || {};
      errors[kind] = error ? errorText(error, t) : '';
      studyErrors.set(root, errors);
      if (projectPath === root) showStudyError();
    }, after);
  }
  function bindProject(root) {
    if (projectPath !== root.path) {
      recovery?.flush();
      previousStudyWrite = studyReading?.close() || previousStudyWrite; studyReading = null;
    }
    if (!projects.has(root.path)) projects.set(root.path, createProject(api, fail, createEnvironmentPreference(localStorage, root.path)));
    unsubscribeProject(); const previous = project; project = projects.get(root.path); unsubscribeProject = project.subscribe(projectChanged);
    if (previous && previous !== project) {
      controller.groups?.reset();
      const paths = [...documents.keys()]; projectViews.get(previous)?.delete(documents); documents.clear(); collectBuffers(previous, paths);
      states.clear(); locations.clear(); fileTabs.clear(); closedTabs.clear(); pendingClose = null; directories.clear(); listings.clear(); current = null; history = []; at = -1; editor?.dispose();
      changes.reset();
      publish({ file: null, searchQuery: { ...projectSearchDefaults }, recentFiles: [], tabs: [], symbols: [], cursor: null, closingFile: null, fileClipboard: null, fileMenu: null, panel: null, saveConflict: null, saveBatch: null, directories: new Map(directories), error: '', status: t('ready') });
    }
    if (!projectViews.has(project)) projectViews.set(project, new Set());
    projectViews.get(project).add(documents);
    project.environment.refresh();
    publish({ environmentPaths: project.environment.snapshot().paths });
    for (const path of documents.keys()) { const doc = project.documents.get(path); if (doc) documents.set(path, doc); else documents.delete(path); }
    const conversations = project.conversationsFor(studyScope);
    assistant.bind(conversations); reading.bind(project.documents); configureSettings(preferences);
    projectPath = root.path; recovery?.bind(root.path);
    drafts?.bind(root.path, project, owner); publish({ drafts: drafts?.snapshot(root.path) });
    if (!studyStore) return;
    showStudyError();
    if (!studyPins.has(root.path)) studyPins.set(root.path, bindStudy(root.path, 'pins', conversations));
    studyReading ||= bindStudy(root.path, 'reading', reading, previousStudyWrite);
    return Promise.all([studyPins.get(root.path).ready, studyReading.ready]);
  }
  async function restoreTab(item, signal) {
    await visit({ ...item.location, file: item.path, kind: item.kind }, true);
    signal.throwIfAborted();
    if (current !== item.path) throw new Error('WORKBENCH_PROJECT_CHANGED');
    fileTabs.keep(item.path); documents.get(item.path).pinned ||= item.pinned;
    if (item.kind === 'file') await editor.restoreViewport?.(item.location?.viewport, signal);
  }
  async function* searchProject(query, signal) {
    await binding;
    signal?.throwIfAborted();
    const target = project, buffers = new Map();
    if (query.locations) for (const [path, doc] of target.documents) if (doc.dirty) buffers.set(path, doc.text);
    const input = buffers.size ? { ...query, buffers: [...buffers.keys()] } : query;
    for await (const event of api.searchProject(input, signal)) {
      signal?.throwIfAborted();
      if (project !== target) return;
      if (event.kind !== 'matches' || !buffers.has(event.path)) yield event;
      else for (const matches of locationBatches(buffers.get(event.path), query.search, query.caseSensitive, query)) {
        signal?.throwIfAborted();
        yield { ...event, matches };
      }
    }
  }
  const controller = {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    snapshot: () => snapshot, documents, index, assistant, reading, changes, files, layout, t,
    git,
    attach(parent, tooltipParent) {
      if (editor && parent === retainedParent) return binding;
      binding = (async () => {
        if (editor && kept) {
          editor.move(parent, tooltipParent); retainedParent = parent;
          if (current && editor.view) {
            const file = current, doc = documents.get(file), attached = editor;
            const state = await attached.state(file, () => ({ text: doc.text, saved: states.get(file) }), preferences);
            if (editor !== attached || current !== file) return;
            editor.show(state); editor.readonly(project.locked);
          }
          retainedHost?.remove(); retainedHost = null; return;
        }
        rememberEditor();
        editor?.dispose(); retainedHost?.remove(); retainedHost = null; retainedParent = parent;
        preference.refresh(); loadSettings();
        editor = createEditor({ parent, tooltipParent, index, t, changed, assistant, receiving: () => receiving, currentFile: () => current,
          viewportChanged: () => { for (const listener of locationSubscribers) listener(); },
          commands: { visit: target => { void visit(target).catch(fail); },
            definition: () => { void definition().catch(fail); return true; }, project: () => { controller.panel({ kind: 'search' }); return true; },
            save: () => { void save().catch(fail); return true; },
            projectReplace: () => { controller.panel({ kind: 'projectReplace' }); return true; },
            undo: () => { void undo().catch(fail); return true; }, redo: () => { void undo('redo').catch(fail); return true; },
            back: () => { void move(-1).catch(fail); return true; }, forward: () => { void move(1).catch(fail); return true; } },
        });
        const attached = editor;
        publish({ preferences });
        await operation?.finished;
        if (editor !== attached) return;
        const root = await api.fileOperation({ action: 'absolutePath', path: '' });
        if (editor !== attached) return;
        await bindProject(root);
        if (editor !== attached) return;
        if (current) { const target = { file: current, kind: snapshot.editorKind }; current = null; await display(target); }
        if (editor === attached && !pane) void refresh().catch(fail);
      })();
      return binding;
    },
    detach() {
      recovery?.flush();
      resuming?.abort();
      rememberEditor();
      if (kept) {
        if (!retainedHost) { retainedHost = document.createElement('div'); retainedHost.hidden = true; document.body.append(retainedHost); }
        if (retainedParent && !retainedParent.isConnected) retainedHost.append(retainedParent);
        return;
      }
      opening?.controller.abort(); scanning?.abort(); listings.clear(); files.activate(false); generation++; clearTimeout(timer); assistant.switchFile(); analyzer.dispose(); if (!sharedIndex) index.clear();
      editor?.dispose(); editor = null; retainedHost?.remove(); retainedHost = null;
      publish({ fileMenu: null, indexed: 0, indexing: false, symbols: [] });
    },
    dispose() {
      recovery?.dispose();
      studyReading?.close(); for (const connection of studyPins.values()) connection.close(); studyPins.clear();
      unsubscribeDrafts?.(); if (!historyOwner) drafts?.dispose();
      this.groups?.reset(); unsubscribeIndex();
      windowRoute.dispose(); kept = false; this.detach(); autosave.dispose(); unsubscribeProject(); unsubscribeSettings(); unsubscribeClosedTabs(); disposed = true; assistant.dispose(); reading.dispose(); changes.dispose(); files.dispose();
      const paths = [...documents.keys()]; projectViews.get(project)?.delete(documents); documents.clear(); if (project) collectBuffers(project, paths);
      states.clear(); subscribers.clear(); editorSubscribers.clear(); locationSubscribers.clear();
    },
    visit, move, list, refresh, save, saveAll, settings, definition, fail, fileOperation, submitFileAction, undo, closeFile, closeTabs, reopenTab, models: api.models, fonts: api.fonts, searchProject,
    async recoverDraft(path) {
      const root = projectPath, target = project, entry = drafts?.entry(root, path);
      if (!entry) throw new Error('WORKBENCH_RECOVERY_CHANGED');
      await restoreDraft(editing, entry);
      await drafts.consume(root, path, entry);
      if (project === target) await visit({ file: path });
    },
    async discardDraft(path) {
      const entry = drafts?.entry(projectPath, path);
      if (!entry) throw new Error('WORKBENCH_RECOVERY_CHANGED');
      await drafts.consume(projectPath, path, entry);
    },
    draftText(path) {
      const entry = drafts?.entry(projectPath, path);
      if (!entry) throw new Error('WORKBENCH_RECOVERY_CHANGED');
      return entry.text;
    },
    retryDrafts: () => drafts?.retry(projectPath),
    async readSaveConflict(path, signal) {
      await binding;
      if (!project) throw new Error('WORKBENCH_WORKSPACE');
      return readSaveConflict(editing, path, signal);
    },
    async applySaveConflict(entry, text) {
      if (!project || operation) throw new Error('WORKBENCH_FILE_BUSY');
      const target = project, ready = binding;
      await applySaveConflict(editing, entry, text);
      if (project !== target || binding !== ready) return;
      publish({ saveConflict: snapshot.saveConflict === entry.path ? null : snapshot.saveConflict, error: '', status: t('conflictApplied'), tabs: tabs() });
      void updateIndex(entry.path).catch(fail);
    },
    async environmentPaths(value) {
      const target = project, ready = binding;
      await ready;
      if (disposed || target !== project || ready !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED');
      if (!target) throw new Error('WORKBENCH_WORKSPACE');
      try { target.environment.save(value); }
      catch (error) { if (error.message === 'WORKBENCH_SETTINGS_WRITE') throw new Error(t('settingsFailed'), { cause: error }); throw error; }
    },
    async environments(signal) {
      await binding;
      if (!project) throw new Error('WORKBENCH_WORKSPACE');
      if (!api.environments) throw new Error('WORKBENCH_ENV_UNAVAILABLE');
      const target = project, state = target.environment.snapshot();
      if (state.invalid) throw new Error(t('settingInvalid'));
      const result = await api.environments(state.paths, signal);
      signal?.throwIfAborted();
      if (target !== project || state !== target.environment.snapshot()) throw new DOMException('Workspace changed', 'AbortError');
      return result;
    },
    async searchContext(item, signal) {
      const buffer = project.documents.get(item.file);
      const doc = buffer?.state?.doc ?? asText(buffer?.text ?? (await api.read(item.file, signal)).text);
      signal?.throwIfAborted();
      if (item.line >= doc.lines) return null;
      const number = item.line + 1, start = item.sampleStart || 0;
      if (doc.line(number).text.slice(start, start + item.lineText.length) !== item.lineText) return null;
      const lines = [];
      for (let n = Math.max(1, number - 2); n <= Math.min(doc.lines, number + 2); n++) lines.push({ number: n, text: doc.line(n).text.slice(0, 240) });
      return lines;
    },
    async compareFiles(left, right, signal) {
      if (left === right) throw new Error('WORKBENCH_COMPARE_SAME');
      const values = await Promise.all([left, right].map(async path => project?.documents.get(path)?.text ?? (await api.read(path, signal)).text));
      signal?.throwIfAborted();
      return compareText(left, values[0], values[1], diffLines(values[0], values[1], { timeout: 500, maxEditLength: MAX_DIFF_LINES }));
    },
    setSearchQuery(patch) {
      const panel = snapshot.panel?.kind === 'projectReplace' ? { ...snapshot.panel, state: { ...snapshot.panel.state, replaceRead: null, replacePreview: null, replaceResult: null } } : snapshot.panel;
      publish({ searchQuery: { ...snapshot.searchQuery, ...patch }, panel });
    },
    cancelCloseFile() { pendingClose = null; publish({ closingFile: null }); },
    keepTab(path) { fileTabs.keep(path); publish({ tabs: tabs() }); },
    moveTab(path, target, after) { fileTabs.move(path, target, after); publish({ tabs: tabs() }); },
    async previewReplacement(match, query, signal) {
      const target = project, ready = binding;
      const result = await readReplacement(api, target, match, query, signal);
      if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
      const before = result.before.toString(), after = result.after.toString();
      return compareText(match.path, before, after, diffLines(before, after, { timeout: 500, maxEditLength: MAX_DIFF_LINES }));
    },
    async replaceProject(matches, query, progress, signal, previewId) {
      if (!project || operation) throw new Error('WORKBENCH_FILE_BUSY');
      const target = project, ready = binding;
      await saving;
      if (project !== target || binding !== ready) throw new Error('WORKBENCH_PROJECT_CHANGED');
      const report = result => {
        const panel = snapshot.panel, state = panel?.state;
        if (previewId && state?.replacePreview?.id === previewId) {
          controller.panel({ ...panel, state: { ...state, replacePreview: remainingReplacements(state.replacePreview, result.changed), replaceResult: result } });
        }
        progress(result);
      };
      try { return await replaceFiles(editing, matches, query, report, signal); }
      finally { if (project === target && binding === ready) { changes.invalidate(); publish({ tabs: tabs() }); void updateIndex().catch(fail); } }
    },
    async openConversation(row, show = true) {
      const ready = binding;
      try { await visit({ file: row.file, threadId: row.id }); }
      catch (error) {
        if (ready === binding && error.message === 'WORKBENCH_NOT_FILE') assistant.validateRestored(row.file);
        if (!show || error.message !== 'WORKBENCH_NOT_FILE') throw error;
      }
      if (show && ready === binding) assistant.open(row.id);
    },
    menu(value) { publish({ fileMenu: value }); },
    copyFile({ path, type }) { publish({ fileClipboard: { path, type }, status: t('fileCopied'), error: '' }); },
    async pinFile(path) { await visit({ file: path }); const doc = documents.get(path); if (doc) { fileTabs.keep(path); doc.pinned = !doc.pinned; publish({ tabs: tabs() }); } },
    view: () => editor?.view,
    captureSession() {
      const active = editor?.location?.() || position();
      return { tabs: tabs().map(({ path, kind, pinned, dirty }) => ({ path, kind, pinned, dirty, location: path === current ? active || undefined : locations.get(path) })),
        current: current ? { file: current, kind: snapshot.editorKind } : null, recent: snapshot.recentFiles };
    },
    async restoreSession(value, signal) {
      const abort = new AbortController(), cancel = () => { abort.abort(); opening?.controller.abort(); generation++; };
      resuming = abort; signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      const failures = [];
      try {
        for (const item of value.tabs) {
          abort.signal.throwIfAborted();
          try {
            await restoreTab(item, abort.signal);
          } catch (error) { abort.signal.throwIfAborted(); failures.push({ path: item.path, error: errorText(error, t) }); }
        }
        abort.signal.throwIfAborted();
        for (const item of value.tabs) if (item.kind === 'markdown' && !value.tabs.some(tab => tab.path === item.path && tab.kind === 'file')) fileTabs.close(item.path);
        if (value.current && documents.has(value.current.file)) await visit(value.current, true);
        publish({ tabs: tabs(), recentFiles: value.recent });
        return failures;
      } finally { signal.removeEventListener('abort', cancel); if (resuming === abort) resuming = null; }
    },
    createPane: () => createWorkbench(api, t, { projects, translationLanguage, settings: preference, layout, sharedIndex: index, historyOwner: owner, draftRecovery: drafts, closedTabs, pane: true, stopRecovery: () => recovery?.stop(), studyScope }),
    hasUnsavedFiles: () => project && [...project.documents.values()].some(doc => doc.dirty),
    keepPaneEdits(pane) {
      for (const [path, doc] of pane.documents) if (doc.dirty && project?.documents.get(path) === doc) autosave.change(path);
    },
    panel(value) { publish({ panel: value ? value.id ? value : { ...value, id: uniqueId() } : null }); },
    subscribeEditor(listener) { editorSubscribers.add(listener); return () => editorSubscribers.delete(listener); },
    subscribeLocation(listener) { locationSubscribers.add(listener); return () => locationSubscribers.delete(listener); },
    keepAlive(value) { kept = value; },
    windowState(value) { publish({ window: value }); },
    openWindow: presentation => windowRoute.open(presentation),
    openFileWindow: (presentation, native) => windowRoute.open(presentation, native),
    returnWindow: () => windowRoute.close(),
  };
  if (!pane) controller.groups = createEditorGroups(controller);
  const recovery = session && !pane ? createWorkspaceRecovery(controller, session, patch => publish(patch), t) : null;
  controller.recovery = recovery;
  const windowRoute = createWindowRoute(controller, api.windows, t, presentation => presentation.kind === 'closeFile' ? { workbench: controller, dispose() {} } : createWindowView(
    createWorkbench(api, t, { projects, translationLanguage, settings: preference, layout, sharedIndex: index, historyOwner: owner, draftRecovery: drafts, studyScope }), controller, presentation));
  return controller;
}
