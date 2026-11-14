import { hasMark } from './selection-state.js';

/** 同一项目共享一份临时对话，数量和列表均从原始记录计算。 */
export function createConversationStore() {
  const files = new Map(), pending = new Map(), listeners = new Set();
  return {
    files, pending,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish() { for (const listener of listeners) listener(); },
    rows() {
      return [...files.values()].flat().filter(hasMark).map(thread => ({
        id: thread.id, file: thread.file, from: thread.from, to: thread.to, line: thread.line, character: thread.character,
        preview: (thread.messages[0]?.text || thread.original).replace(/\s+/g, ' ').slice(0, 100),
        count: thread.messages.length, status: thread.status, stale: thread.stale, kind: thread.kind,
      }));
    },
  };
}
