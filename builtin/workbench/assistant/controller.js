import { selectionThread, selectionSnapshot, mapThread, applyReplacement, hasMark } from './selection-state.js';
import { refreshMarks } from './selection-extension.js';
import { errorText } from '../locales.js';

export function createSelectionAssistant({ editor, api, changed, t }) {
  const files = new Map(), pending = new Map();
  let active = null, visible = false, mode = 'ask', applying = null;
  const threads = (file = editor.file()) => files.get(file) || [];
  function publish() { changed({ thread: active ? { ...active, messages: [...active.messages] } : null, visible, mode }); }
  function refresh() { editor.view()?.dispatch({ effects: refreshMarks.of(threads()) }); publish(); }
  function close() {
    visible = false;
    if (active && !hasMark(active) && !active.draft.trim()) files.set(active.file, threads().filter(item => item !== active));
    publish();
  }
  function open(id) {
    const thread = threads().find(item => item.id === id);
    if (!thread) return;
    active = thread; visible = true; mode = 'ask'; publish();
  }
  function select() {
    const view = editor.view(), range = view.state.selection.main;
    if (range.empty) return;
    let thread = threads().find(item => !item.stale && item.from === range.from && item.to === range.to);
    if (!thread) {
      thread = selectionThread(editor.file(), view.state, crypto.randomUUID());
      files.set(thread.file, [...threads(), thread]);
    }
    open(thread.id);
  }
  function stop() { if (active) pending.get(active.id)?.abort(); }
  function remove() {
    if (!active) return;
    stop(); files.set(active.file, threads().filter(item => item !== active)); active = null; visible = false; refresh();
  }
  async function send() {
    if (!active || active.status === 'running' || !active.draft.trim()) return;
    const thread = active, view = editor.view(), instruction = thread.draft.trim(), selectedMode = mode;
    let snapshot;
    try { snapshot = selectionSnapshot(thread, view.state); }
    catch { thread.note = t('stale'); publish(); return; }
    const abort = new AbortController(), history = thread.messages.map(({ role, text }) => ({ role, text }));
    pending.set(thread.id, abort); thread.status = 'running'; thread.note = '';
    thread.messages.push({ role: 'user', mode: selectedMode, text: instruction }); thread.draft = ''; refresh();
    try {
      const result = await api.assist({ file: thread.file, text: view.state.doc.toString(), from: thread.from, to: thread.to, mode: selectedMode, instruction, history }, abort.signal);
      abort.signal.throwIfAborted();
      if (thread.file !== editor.file()) throw new Error(t('stopped'));
      if (result.kind === 'edit') {
        applying = thread.id;
        try { Object.assign(thread, applyReplacement(editor.view(), thread, snapshot, result.replacement)); }
        finally { applying = null; }
        thread.messages.push({ role: 'assistant', text: result.replacement || t('deleted') }); thread.note = t('edited');
      } else thread.messages.push({ role: 'assistant', text: result.text });
      thread.status = 'idle';
    } catch (error) { thread.status = 'error'; thread.note = abort.signal.aborted ? t('stopped') : errorText(error, t); }
    finally { pending.delete(thread.id); refresh(); }
  }
  return {
    threads, open, select, close, send, stop, remove,
    draft(value) { if (active) { active.draft = value; publish(); } },
    mode(value) { mode = value; publish(); },
    pin() { if (active) { active.pinned = !active.pinned; refresh(); } },
    update(update) {
      if (!update.docChanged) return;
      for (const transaction of update.transactions) if (transaction.docChanged) for (const thread of threads()) {
        if (thread.id !== applying) Object.assign(thread, mapThread(thread, transaction.changes));
      }
      if (active?.stale) active.note = t('stale');
      publish();
    },
    switchFile() { for (const abort of pending.values()) abort.abort(); active = null; visible = false; publish(); },
    dispose() { for (const abort of pending.values()) abort.abort(); pending.clear(); },
  };
}
