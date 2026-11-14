import { selectionThread, selectionSnapshot, mapThread, applyReplacement, hasMark } from './selection-state.js';
import { refreshMarks } from './selection-extension.js';
import { errorText, message } from '../locales.js';
import { createConversationStore } from './conversations.js';

export function createSelectionAssistant({ editor, api, changed, t, translationModel = () => undefined, translationLanguage = () => t('translationLanguage') }) {
  let store, unsubscribe = () => {}, marking = false, disposed = false;
  const owned = new Set();
  let active = null, visible = false, mode = 'ask', applying = null;
  const threads = (file = editor.file()) => store.files.get(file) || [];
  function publish() { changed({ thread: active ? { ...active, messages: [...active.messages] } : null, visible, mode, conversations: store.rows() }); }
  function refresh() { store.publish(); }
  function bind(value) {
    if (store === value) return;
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
  function close() {
    visible = false;
    if (active && !hasMark(active) && !active.draft.trim()) store.files.set(active.file, threads(active.file).filter(item => item !== active));
    refresh();
  }
  function open(id) {
    const thread = [...store.files.values()].flat().find(item => item.id === id);
    if (!thread) return;
    active = thread; visible = true; mode = thread.kind === 'translation' ? 'translate' : 'ask'; publish();
  }
  function select(action = 'ask') {
    const view = editor.view(), range = view.state.selection.main;
    if (range.empty) return;
    const kind = action === 'translate' ? 'translation' : 'code';
    const language = kind === 'translation' ? translationLanguage() : undefined;
    let thread = threads().find(item => item.kind === kind && item.language === language && !item.stale && item.from === range.from && item.to === range.to);
    if (!thread) {
      thread = selectionThread(editor.file(), view.state, crypto.randomUUID(), kind);
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
    stop(); store.files.set(active.file, threads(active.file).filter(item => item !== active)); active = null; visible = false; refresh();
  }
  async function send() {
    if (!active || active.status === 'running' || !active.draft.trim()) return;
    const thread = active, view = editor.view(), instruction = thread.draft.trim(), selectedMode = mode;
    let snapshot;
    try { if (selectedMode !== 'translate') { if (thread.file !== editor.file() || !view) throw new Error(); snapshot = selectionSnapshot(thread, view.state); } }
    catch { thread.note = t('stale'); publish(); return; }
    const abort = new AbortController(), history = thread.messages.map(({ role, text }) => ({ role, text }));
    store.pending.set(thread.id, abort); owned.add(thread.id); thread.status = 'running'; thread.note = '';
    thread.messages.push({ role: 'user', mode: selectedMode, text: instruction }); thread.draft = ''; refresh();
    try {
      const model = translationModel();
      const result = selectedMode === 'translate'
        ? await api.translate({ instruction, history, ...(model ? { model } : {}) }, abort.signal)
        : await api.assist({ file: thread.file, text: view.state.doc.toString(), from: thread.from, to: thread.to, mode: selectedMode, instruction, history }, abort.signal);
      abort.signal.throwIfAborted();
      if (selectedMode !== 'translate' && thread.file !== editor.file()) throw new Error(t('stopped'));
      if (result.kind === 'edit') {
        applying = thread.id;
        try { Object.assign(thread, applyReplacement(editor.view(), thread, snapshot, result.replacement)); }
        finally { applying = null; }
        thread.messages.push({ role: 'assistant', text: result.replacement || t('deleted') }); thread.note = t('edited');
      } else thread.messages.push({ role: 'assistant', text: result.text });
      thread.status = 'idle';
    } catch (error) { thread.status = 'error'; thread.note = abort.signal.aborted ? t('stopped') : errorText(error, t); }
    finally { store.pending.delete(thread.id); owned.delete(thread.id); refresh(); }
  }
  return {
    threads, open, select, close, send, stop, remove, bind,
    draft(value) { if (active) { active.draft = value; publish(); } },
    mode(value) { mode = value; publish(); },
    pin() { if (active) { active.pinned = !active.pinned; refresh(); } },
    update(update) {
      if (!update.docChanged) return;
      for (const transaction of update.transactions) if (transaction.docChanged) for (const thread of threads()) {
        if (thread.id !== applying) Object.assign(thread, mapThread(thread, transaction.changes));
        const line = update.state.doc.lineAt(Math.min(thread.from, update.state.doc.length));
        thread.line = line.number - 1; thread.character = thread.from - line.from;
      }
      if (active?.stale && active.kind !== 'translation') active.note = t('stale');
      refresh();
    },
    switchFile() { for (const id of owned) store.pending.get(id)?.abort(); active = null; visible = false; publish(); },
    dispose() { disposed = true; unsubscribe(); for (const id of owned) store.pending.get(id)?.abort(); },
  };
}
