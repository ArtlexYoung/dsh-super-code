import { selectionThread, selectionSnapshot, mapThread, applyReplacement, hasMark } from './selection-state.js';
import { refreshMarks } from './selection-extension.js';
import { errorText, message } from '../locales.js';
import { createConversationStore } from './conversations.js';
import { uniqueId } from '../id.js';
import { selectionContext } from '../../../src/workbench/assistant-context.ts';

export function createSelectionAssistant({ editor, api, changed, t, modelOptions = () => ({}), translationLanguage = () => t('translationLanguage') }) {
  let store, unsubscribe = () => {}, marking = false, disposed = false;
  const owned = new Set();
  let active = null, visible = false, mode = 'ask', applying = null;
  const threads = (file = editor.file()) => store.files.get(file) || [];
  function publish() { changed({ thread: active ? { ...active, messages: [...active.messages] } : null, visible, mode, conversations: store.rows() }); }
  function refresh() { store.publish(); }
  function switchFile() { for (const id of owned) store.pending.get(id)?.abort(); close(); active = null; publish(); }
  function bind(value) {
    if (store === value) return;
    if (store) switchFile();
    unsubscribe(); store = value;
    unsubscribe = store.subscribe(() => {
      if (active && !threads(active.file).includes(active)) { active = null; visible = false; }
      publish();
      if (marking) return;
      marking = true;
      queueMicrotask(() => { marking = false; if (!disposed) editor.view()?.dispatch({ effects: refreshMarks.of(threads()) }); });
    });
    publish();
  }
  bind(createConversationStore());
  function forget(thread) {
    const remaining = threads(thread.file).filter(item => item !== thread);
    if (remaining.length) store.files.set(thread.file, remaining);
    else store.files.delete(thread.file);
  }
  function close() {
    visible = false;
    if (active && !hasMark(active) && !active.draft.trim()) forget(active);
    refresh();
  }
  function open(id) {
    const thread = [...store.files.values()].flat().find(item => item.id === id);
    if (!thread) return;
    if (active !== thread) close();
    active = thread; visible = true; mode = thread.kind === 'translation' ? 'translate' : 'ask'; publish();
  }
  function select(action = 'ask') {
    const view = editor.view(), range = view.state.selection.main;
    if (range.empty) return;
    const kind = action === 'translate' ? 'translation' : 'code';
    const language = kind === 'translation' ? translationLanguage() : undefined;
    let thread = threads().find(item => item.kind === kind && item.language === language && !item.stale && item.from === range.from && item.to === range.to);
    if (!thread) {
      thread = selectionThread(editor.file(), view.state, uniqueId(), kind);
      thread.language = language;
      store.files.set(thread.file, [...threads(), thread]);
    }
    open(thread.id);
    if (action === 'translate' && !thread.messages.length) {
      thread.draft = message(t, 'translationRequest', { text: thread.original, language });
      return send();
    }
  }
  function stop() { if (active) store.pending.get(active.id)?.abort(); }
  function remove() {
    if (!active) return;
    stop(); forget(active); active = null; visible = false; refresh();
  }
  async function send() {
    if (!active || active.status === 'running' || !active.draft.trim()) return;
    const thread = active, origin = store, view = editor.view(), instruction = thread.draft.trim(), selectedMode = mode;
    let snapshot, source;
    try { if (selectedMode !== 'translate') { if (thread.file !== editor.file() || !view) throw new Error(); snapshot = selectionSnapshot(thread, view.state); source = selectionContext(view.state.doc, thread.from, thread.to); } }
    catch (error) { thread.note = error.message === 'WORKBENCH_SELECTION_SIZE' ? errorText(error, t) : t('stale'); publish(); return; }
    const abort = new AbortController(), history = thread.messages.map(({ role, text }) => ({ role, text }));
    origin.pending.set(thread.id, abort); owned.add(thread.id); thread.status = 'running'; thread.note = '';
    thread.messages.push({ role: 'user', mode: selectedMode, text: instruction }); thread.draft = ''; refresh();
    try {
      const options = modelOptions(selectedMode === 'translate' ? 'translation' : 'quick');
      const result = selectedMode === 'translate'
        ? await api.translate({ instruction, history, ...options }, abort.signal)
        : await api.assist({ file: thread.file, ...source, mode: selectedMode, instruction, history, ...options }, abort.signal);
      abort.signal.throwIfAborted();
      if (selectedMode !== 'translate' && thread.file !== editor.file()) throw new Error(t('stopped'));
      if (result.kind === 'edit') {
        applying = thread.id;
        try { Object.assign(thread, applyReplacement(editor.view(), thread, snapshot, result.replacement)); }
        finally { applying = null; }
        thread.messages.push({ role: 'assistant', text: result.replacement || t('deleted') }); thread.note = t('edited');
      } else thread.messages.push({ role: 'assistant', text: result.text });
      thread.status = 'idle';
    } catch (error) { thread.status = abort.signal.aborted ? 'stopped' : 'error'; thread.note = abort.signal.aborted ? t('stopped') : errorText(error, t); }
    finally { origin.pending.delete(thread.id); owned.delete(thread.id); origin.publish(); }
  }
  return {
    threads, open, select, close, send, stop, remove, bind,
    draft(value) { if (active) { active.draft = value; refresh(); } },
    mode(value) { mode = value; publish(); },
    pin() { if (active) { active.pinned = !active.pinned; refresh(); } },
    update(update, file = editor.file(), origin = store) {
      if (!update.docChanged) return;
      for (const transaction of update.transactions) if (transaction.docChanged) for (const thread of origin.files.get(file) || []) {
        if (thread.id !== applying) Object.assign(thread, mapThread(thread, transaction.changes));
        const line = update.state.doc.lineAt(Math.min(thread.from, update.state.doc.length));
        thread.line = line.number - 1; thread.character = thread.from - line.from;
      }
      if (origin === store && active?.stale && active.kind !== 'translation') active.note = t('stale');
      origin.publish();
    },
    switchFile,
    dispose() { disposed = true; unsubscribe(); switchFile(); },
  };
}
