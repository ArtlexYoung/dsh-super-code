import { hasMark } from './selection-state.js';

/** 同一会话和项目的各个视图共享对话，数量和列表均从原始记录计算。 */
export function createConversationStore() {
  const files = new Map(), pending = new Map(), listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    files, pending,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    rows() {
      return [...files.values()].flat().filter(hasMark).map(thread => ({
        id: thread.id, file: thread.file, from: thread.from, to: thread.to, line: thread.line, character: thread.character,
        preview: (thread.messages[0]?.text || thread.original).replace(/\s+/g, ' ').slice(0, 100),
        count: thread.messages.length, status: thread.status, stale: thread.stale, kind: thread.kind, pinned: thread.pinned,
      }));
    },
    archive() {
      return [...files.values()].flat().filter(item => item.pinned).map(({ id, file, kind, language, line, character, from, to, original, stale, messages }) => ({
        id, file, kind, language, line, character, from, to, original, stale, messages: messages.filter(item => !item.proposalId),
      }));
    },
    restore(items) {
      const current = new Set([...files.values()].flat().map(item => item.id));
      for (const item of items) {
        if (current.has(item.id)) continue;
        const threads = files.get(item.file) || [];
        files.set(item.file, [...threads, { ...item, pinned: true, unchecked: !item.stale, draft: '', revision: 0, version: 0, status: 'idle' }]);
      }
      publish();
    },
  };
}
