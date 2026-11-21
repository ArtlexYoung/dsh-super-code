import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createEditor } from '../editor/view.js';
import { readingScopeHead } from '../editor/scope.js';
import { createRequests } from './protocol.js';
import { createEditPeer } from './edits.js';
import { refreshMarks } from '../assistant/selection-extension.js';
import { readPreferences } from '../editor/preferences.js';
import { uniqueId } from '../id.js';
import { createEditorGroups } from '../editor/groups.js';

export function createWindowProxy(send, t, { child, initial, canSplit = false } = {}) {
  let editor, current, loading, receiving = false, disposed = false, turn = 0, threads = [], draftRevision = 0, pendingDraft, panelRevision = 0, pendingPanel;
  let settingsRevision = 0, pendingSettings, confirmedPreferences;
  let readOnly = false, editingFailed = false, navigation = 0;
  const requests = createRequests(send), documents = new Map(), states = new Map();
  const panes = new Map();
  let paneSequence = 0, joining;
  const index = {
    change: (...args) => call('index.change', args), candidates: (...args) => call('index.candidates', args),
    describe: (items, signal) => call('index.describe', [items], { signal }),
    resolve: (file, name, offset, signal) => call('index.resolve', [file, name, offset], { signal }),
    search: (query, limit, signal) => call('index.search', [query, limit], { signal }),
  };
  const stores = Object.fromEntries(['snapshot', 'changes', 'reading', 'files', 'layout'].map(key => {
    let value = key === 'snapshot' ? initial : null; const listeners = new Set();
    return [key, { snapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      publish(next) { value = next; for (const listener of listeners) listener(); } }];
  }));
  const fail = error => { if (error.name !== 'AbortError') void requests.request('fail', [error.message]).catch(() => {}); };
  const edit = createEditPeer(value => requests.request('edit', [value]).catch(error => {
    editingFailed = true; editor?.readonly(true); fail(error); throw error;
  }), transaction => {
    receiving = true;
    try { if (loading) loading.state = loading.state.update(transaction).state; else editor?.view?.dispatch(transaction); }
    finally { receiving = false; }
  });
  const canMove = direction => stores.snapshot.snapshot()[direction < 0 ? 'back' : 'forward'];
  function rememberReadingPosition(method, target) {
    const view = editor?.view;
    if (!view || (method !== 'visit' && !(method === 'move' && canMove(target)))) return;
    // 只有独立窗能测量自己的正文。跳转前沿用原有选区同步，让宿主记录返回位置。
    const head = readingScopeHead(view);
    if (head !== null) view.dispatch({ selection: { anchor: head } });
  }
  async function call(method, args = [], options) {
    const target = args[0];
    if (['visit', 'move', 'closeFile'].includes(method)) {
      navigation++;
      rememberReadingPosition(method, target);
    }
    const request = navigation;
    await edit.flush();
    const reveal = method === 'move' ? canMove(target)
      : method === 'visit' && ['line', 'character', 'length'].some(key => target[key] !== undefined);
    const result = await requests.request(method, args, options);
    if (reveal && request === navigation && editor?.view) {
      editor.view.dispatch({ effects: EditorView.scrollIntoView(editor.view.state.selection.main, { y: 'center' }) });
    }
    return result;
  }
  const invoke = (method, args) => { void call(method, args).catch(fail); };
  async function definition() {
    const request = ++navigation, file = current, selection = editor.view.state.selection;
    await call('definition');
    if (request !== navigation) return;
    const view = editor?.view;
    if (view && (file !== current || !selection.eq(view.state.selection))) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main, { y: 'center' }) });
  }
  const assistant = Object.fromEntries(['open', 'select', 'close', 'send', 'stop', 'remove', 'draft', 'mode', 'pin'].map(method => [method, (...args) => call(`assistant.${method}`, args).catch(fail)]));
  Object.assign(assistant, { threads: () => threads, update() {} });
  assistant.draft = value => {
    const state = stores.snapshot.snapshot(), thread = state.assistant?.thread;
    if (!thread) return;
    const revision = ++draftRevision; pendingDraft = { id: thread.id, value, revision };
    stores.snapshot.publish({ ...state, assistant: { ...state.assistant, thread: { ...thread, draft: value } } });
    void call('assistant.draft', [value]).catch(fail).finally(() => { if (pendingDraft?.revision === revision) pendingDraft = null; });
  };
  const commands = {
    definition: () => { void definition().catch(fail); }, project: () => invoke('panel', [{ kind: 'search' }]), projectReplace: () => invoke('panel', [{ kind: 'projectReplace' }]),
    save: () => invoke('save'), undo: () => invoke('undo'), redo: () => invoke('undo', ['redo']), back: () => invoke('move', [-1]), forward: () => invoke('move', [1]),
  };
  function restoreState(value) {
    const state = EditorState.create({ doc: value.text, selection: value.selection ? EditorSelection.fromJSON(value.selection) : undefined });
    const saved = states.get(value.file);
    return saved?.doc.eq(state.doc) ? saved.update({ selection: state.selection }).state : state;
  }
  async function show(value) {
    const request = ++turn;
    edit.initial(value);
    if (current && editor?.view) states.set(current, editor.capture());
    readOnly = !!value.readOnly; editingFailed = false;
    current = value.file;
    const source = current ? { state: restoreState(value) } : null;
    loading = source; editor?.dispose();
    if (!editor || !current) return;
    const state = await editor.state(current, () => ({ text: source.state.doc.toString(), saved: source.state }), stores.snapshot.snapshot().preferences);
    if (disposed || request !== turn) return;
    loading = null;
    receiving = true;
    try { editor.show(state); editor.readonly(readOnly || editingFailed); }
    finally { receiving = false; }
    stores.snapshot.publish({ ...stores.snapshot.snapshot() });
  }
  const proxy = {
    ...stores.snapshot, documents, index, assistant, t, external: true,
    ...Object.fromEntries(['visit', 'move', 'list', 'refresh', 'save', 'fileOperation', 'submitFileAction', 'undo', 'closeFile', 'openConversation', 'pinFile'].map(method => [method, (...args) => call(method, args)])),
    definition,
    ...Object.fromEntries(['cancelCloseFile', 'moveTab', 'keepTab', 'menu', 'copyFile'].map(method => [method, (...args) => invoke(method, args)])),
    openFileWindow: ({ file, editorKind, markdownSplit }) => invoke('openFileWindow', [file, editorKind, markdownSplit]),
    settings(value) {
      const preferences = readPreferences(value), revision = ++settingsRevision;
      pendingSettings = { preferences, revision };
      stores.snapshot.publish({ ...stores.snapshot.snapshot(), preferences });
      return call('settings', [preferences]).catch(error => {
        if (pendingSettings?.revision === revision) stores.snapshot.publish({ ...stores.snapshot.snapshot(), preferences: confirmedPreferences });
        throw error;
      }).finally(() => { if (pendingSettings?.revision === revision) pendingSettings = null; });
    },
    panel(value) {
      if (value) value = { ...value, id: value.id ?? uniqueId() };
      const revision = ++panelRevision; pendingPanel = { value, revision };
      stores.snapshot.publish({ ...stores.snapshot.snapshot(), panel: value });
      void call('panel', [value]).catch(fail).finally(() => { if (pendingPanel?.revision === revision) pendingPanel = null; });
    },
    changes: { ...stores.changes,
      ...Object.fromEntries(['refresh', 'invalidate', 'visible', 'forget'].map(method => [method, (...args) => call(`changes.${method}`, args).catch(fail)])),
      diff: (path, signal) => call('changes.diff', [path], { signal }),
    },
    reading: { ...stores.reading, ...Object.fromEntries(['goal', 'plan', 'file', 'retry', 'step', 'stop', 'open', 'verify'].map(method => [method, (...args) => call(`reading.${method}`, args).catch(fail)])) },
    files: { ...stores.files, activate: (...args) => invoke('files.activate', args), reset: () => invoke('files.reset') },
    layout: { ...stores.layout, change: patch => invoke('layout.change', [patch]), save: () => call('layout.save') },
    git: (value, signal) => call('git', [value], { signal }),
    compareFiles: (left, right, signal) => call('compareFiles', [left, right], { signal }),
    readSaveConflict: (path, signal) => call('readSaveConflict', [path], { signal }),
    applySaveConflict: (entry, text) => call('applySaveConflict', [entry, text]),
    list: (path, signal) => call('list', [path], { signal }),
    models: signal => call('models', [], { signal }),
    fonts: signal => call('fonts', [], { signal }),
    environmentPaths: value => call('environmentPaths', [value]),
    environments: signal => call('environments', [], { signal }),
    replaceProject: (matches, query, progress, signal) => call('replaceProject', [matches, query], { signal, progress }),
    async *searchProject(query, signal) {
      const values = []; let wake, done = false, failure;
      const work = call('searchProject', [query], { signal, progress(value) { values.push(value); wake?.(); } })
        .catch(error => { failure = error; }).finally(() => { done = true; wake?.(); });
      while (!done || values.length) {
        if (values.length) yield values.shift(); else await new Promise(resolve => { wake = resolve; });
      }
      await work; if (failure) throw failure;
    },
    view: () => editor?.view, fail,
    async attach(parent, tooltipParent) {
      editor = createEditor({ parent, tooltipParent, index, t, assistant, currentFile: () => current, receiving: () => true,
        changed(update) {
          if (receiving) return;
          edit.local(update);
          if (update.docChanged) stores.snapshot.publish({ ...stores.snapshot.snapshot() });
        }, commands: { ...Object.fromEntries(Object.entries(commands).map(([key, action]) => [key, () => { action(); return true; }])),
          visit: target => invoke('visit', [target]) },
      });
      const attached = editor;
      if (child) await (joining ||= send({ kind: 'hello' }));
      if (proxy.initialEditor) await show(proxy.initialEditor);
      if (editor === attached && !disposed) await send({ kind: 'ready' });
    },
    detach() {
      turn++;
      if (editor?.view) {
        loading = { state: editor.capture() }; states.set(current, loading.state);
        proxy.initialEditor = { ...proxy.initialEditor, text: loading.state.doc.toString(), selection: loading.state.selection.toJSON() };
      }
      editor?.dispose(); editor = null;
    },
    dispose() {
      disposed = true; this.groups?.reset(); turn++; this.detach(); requests.close(); edit.stop(new Error('WORKBENCH_WINDOW_DISCONNECTED')); states.clear(); child?.();
    },
    async accept(message) {
      if (message.pane !== undefined) {
        const { pane, ...content } = message;
        return panes.get(pane)?.accept(content);
      }
      if (message.kind === 'state') {
        const patch = message.patch;
        if (patch.threads) threads = patch.threads;
        if (patch.documents) {
          documents.clear(); for (const [path, value] of patch.documents) documents.set(path, { text: value.dirty ? 'changed' : '', original: '' });
        }
        if (pendingDraft && patch.snapshot?.assistant?.thread?.id === pendingDraft.id) patch.snapshot = {
          ...patch.snapshot, assistant: { ...patch.snapshot.assistant, thread: { ...patch.snapshot.assistant.thread, draft: pendingDraft.value } },
        };
        if (pendingPanel && patch.snapshot) patch.snapshot = { ...patch.snapshot, panel: pendingPanel.value };
        if (patch.snapshot) {
          confirmedPreferences = patch.snapshot.preferences;
          if (pendingSettings) patch.snapshot = { ...patch.snapshot, preferences: pendingSettings.preferences };
        }
        for (const name of Object.keys(stores)) if (Object.hasOwn(patch, name)) stores[name].publish(patch[name]);
        if (patch.editor) { proxy.initialEditor = patch.editor; await show(patch.editor); }
        if (patch.documents) for (const path of states.keys()) if (!documents.has(path)) states.delete(path);
        if (patch.snapshot && editor?.view) editor.preferences(patch.snapshot.preferences);
        if (patch.threads && editor?.view) {
          receiving = true; try { editor.view.dispatch({ effects: refreshMarks.of(threads) }); } finally { receiving = false; }
        }
      } else if (message.kind === 'edit') {
        try {
          edit.accept(message);
          if (message.file === current) {
            readOnly = !!message.readOnly;
            proxy.initialEditor = { ...proxy.initialEditor, readOnly, version: message.version,
              ...(loading ? { text: loading.state.doc.toString(), selection: loading.state.selection.toJSON() } : {}) };
            editor?.readonly(readOnly || editingFailed);
            if (message.changes) stores.snapshot.publish({ ...stores.snapshot.snapshot() });
          }
        }
        catch (error) { editingFailed = true; edit.stop(error); editor?.readonly(true); fail(error); throw error; }
      } else requests.accept(message);
    },
    flush: () => edit.flush(),
    async returnToHost() { await Promise.all([edit.flush(), ...[...panes.values()].map(view => view.flush())]); await requests.request('return'); },
  };
  if (!child) proxy.groups = createEditorGroups(proxy);
  if (canSplit) proxy.createPane = () => {
    const id = ++paneSequence, opened = requests.request('pane.open', [id]);
    const view = createWindowProxy(value => opened.then(() => send({ ...value, pane: id })), t, {
      initial: { ...proxy.snapshot(), file: null, cursor: null, symbols: [], tabs: [], panel: null, assistant: null, closingFile: null, fileMenu: null },
      child() { panes.delete(id); if (!disposed) void opened.then(() => requests.request('pane.close', [id])).catch(fail); },
    });
    panes.set(id, view);
    return view;
  };
  return proxy;
}
