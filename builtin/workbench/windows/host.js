import { createMessageSender, decode } from './protocol.js';
import { createEditHost } from './edits.js';

export function createWindowHost(workbench, send, close, metadata, onReady = () => workbench.windowState({ state: 'active', presentation: metadata.presentation || { kind: 'workbench' } })) {
  let stopped = false;
  const transmit = createMessageSender(async content => { if (!stopped) await send(content); });
  const scope = createHost(workbench, transmit, close, metadata, onReady);
  return { accept: content => scope.accept(decode(content)), dispose() { stopped = true; scope.dispose(); } };
}

function createHost(workbench, transmit, close, metadata, onReady) {
  const requests = new Map(), seen = new Map(), cleanups = [];
  const panes = new Map();
  let stopped = false, scheduled = false, editorFile, ready = false, initialized = false;
  const push = value => { if (!stopped && initialized) void transmit(value).catch(close); };
  const edits = createEditHost(workbench.view, push);
  const calls = Object.fromEntries(['visit', 'move', 'list', 'refresh', 'save', 'settings', 'environmentPaths', 'definition', 'fileOperation', 'undo', 'closeFile', 'closeTabs', 'reopenTab', 'cancelCloseFile',
    'moveTab', 'keepTab', 'setSearchQuery', 'openConversation', 'menu', 'copyFile', 'pinFile', 'panel', 'submitFileAction', 'applySaveConflict'].map(name => [name, args => workbench[name](...args)]));
  for (const [name, target, methods] of [
    ['assistant', workbench.assistant, ['open', 'select', 'close', 'send', 'stop', 'remove', 'draft', 'mode', 'pin']],
    ['reading', workbench.reading, ['goal', 'plan', 'file', 'retry', 'step', 'stop', 'open', 'verify']],
    ['changes', workbench.changes, ['refresh', 'invalidate', 'visible', 'forget']],
    ['files', workbench.files, ['activate', 'reset']],
    ['layout', workbench.layout, ['change', 'save']],
  ]) for (const method of methods) calls[`${name}.${method}`] = args => target[method](...args);
  Object.assign(calls, {
    'index.change': args => workbench.index.change(...args),
    'index.candidates': args => workbench.index.candidates(...args),
    'index.describe': (args, signal) => workbench.index.describe(args[0], signal),
    'index.resolve': (args, signal) => workbench.index.resolve(args[0], args[1], args[2], signal),
    'index.search': (args, signal) => workbench.index.search(args[0], args[1], signal),
    edit: args => edits.apply(args[0]),
    list: (args, signal) => workbench.list(args[0], signal),
    fail: args => workbench.fail(new Error(args[0])),
    models: (_args, signal) => workbench.models(signal),
    fonts: (_args, signal) => workbench.fonts(signal),
    environments: (_args, signal) => workbench.environments(signal),
    git: (args, signal) => workbench.git(args[0], signal),
    compareFiles: (args, signal) => workbench.compareFiles(args[0], args[1], signal),
    readSaveConflict: (args, signal) => workbench.readSaveConflict(args[0], signal),
    previewReplacement: (args, signal) => workbench.previewReplacement(args[0], args[1], signal),
    'changes.diff': (args, signal) => workbench.changes.diff(args[0], signal),
    replaceProject: ([matches, query, previewId], signal, progress) => workbench.replaceProject(matches, query, progress, signal, previewId),
    async searchProject(args, signal, progress) { for await (const value of workbench.searchProject(args[0], signal)) progress(value); },
    openFileWindow([file, editorKind, markdownSplit]) {
      if (typeof file !== 'string' || !file || !['file', 'markdown'].includes(editorKind)) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
      void workbench.openFileWindow?.({ kind: 'file', file, editorKind, markdownSplit: markdownSplit === true }, true);
    },
    return: () => { queueMicrotask(() => close()); },
  });
  function disposePane(id) {
    const pane = panes.get(id);
    if (!pane) return;
    panes.delete(id); pane.host?.dispose(); workbench.keepPaneEdits?.(pane.view); pane.view.dispose(); pane.container.remove();
  }
  if (metadata?.presentation?.kind === 'workbench' && workbench.createPane) Object.assign(calls, {
    async 'pane.open'([id], signal) {
      if (!Number.isSafeInteger(id) || id < 1 || panes.has(id)) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
      const container = document.createElement('div'), tooltips = document.createElement('div');
      const view = workbench.createPane(), pane = { container, view };
      container.hidden = true; container.append(tooltips); document.body.append(container); panes.set(id, pane);
      try {
        await view.attach(container, tooltips);
        signal.throwIfAborted();
        pane.host = createHost(view, value => transmit({ ...value, pane: id }), close, undefined, () => {});
      } catch (error) { disposePane(id); throw error; }
    },
    'pane.close': ([id]) => disposePane(id),
  });
  function publish() {
    scheduled = false;
    if (!initialized || stopped) return;
    const sources = { snapshot: workbench.snapshot(), changes: workbench.changes.snapshot(), files: workbench.files.snapshot(), reading: workbench.reading.snapshot(), layout: workbench.layout.snapshot() };
    const patch = {};
    for (const [name, value] of Object.entries(sources)) if (seen.get(name) !== value) { seen.set(name, value); patch[name] = value; }
    const file = sources.snapshot.file;
    if (editorFile !== file) { editorFile = file; patch.editor = edits.initial(file); }
    if (patch.snapshot) {
      // 窗口状态属于原界面，外部视图不再递归创建窗口。
      patch.snapshot = { ...patch.snapshot, window: null };
      patch.threads = workbench.assistant.threads();
      patch.documents = [...workbench.documents].map(([path, doc]) => [path, { dirty: doc.dirty }]);
    }
    if (Object.keys(patch).length) push({ kind: 'state', patch });
  }
  function schedule() { if (!scheduled && !stopped) { scheduled = true; queueMicrotask(publish); } }
  for (const store of [workbench, workbench.changes, workbench.files, workbench.reading, workbench.layout]) cleanups.push(store.subscribe(schedule));
  cleanups.push(workbench.subscribeEditor(edits.changed));
  return {
    async accept(message) {
      if (stopped) return;
      if (initialized && message.pane !== undefined) {
        const { pane, ...content } = message;
        await panes.get(pane)?.host?.accept(content);
        return;
      }
      if (message.kind === 'hello') {
        if (initialized || message.pane !== undefined) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
        initialized = true; if (metadata) push({ kind: 'init', metadata }); publish(); return;
      }
      if (!initialized) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
      if (message.kind === 'ready') { if (!ready) { ready = true; onReady(); } return; }
      if (message.kind === 'cancel') { requests.get(message.id)?.abort(); return; }
      if (message.kind !== 'call' || !Number.isSafeInteger(message.id) || message.id < 1 || !Object.hasOwn(calls, message.method) || !Array.isArray(message.args) || message.args.length > 6 || requests.has(message.id)) throw new Error('WORKBENCH_WINDOW_PROTOCOL');
      const abort = new AbortController(); requests.set(message.id, abort);
      try {
        const value = await calls[message.method](message.args, abort.signal, value => push({ kind: 'progress', id: message.id, value }));
        if (!stopped) push({ kind: 'result', id: message.id, value });
      } catch (error) { push({ kind: 'error', id: message.id, error: error.message || 'WORKBENCH_WINDOW_PROTOCOL' }); }
      finally { requests.delete(message.id); }
    },
    dispose() {
      stopped = true;
      for (const unsubscribe of cleanups) unsubscribe();
      for (const id of panes.keys()) disposePane(id);
      for (const abort of requests.values()) abort.abort();
      requests.clear();
    },
  };
}
