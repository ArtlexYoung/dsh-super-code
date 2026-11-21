import { createConversationStore } from '../assistant/conversations.js';
import { createHistory } from './history.js';
import { uniqueId } from '../id.js';

/** 同一目录只有一份缓冲区和写入队列，切换对话不丢失编辑或历史。 */
export function createProject(api, fail, environment) {
  const listeners = new Set(), documents = new Map();
  let pending = Promise.resolve(), disposed = false, locked = false;
  const run = action => {
    const result = pending.then(() => { if (disposed) throw new Error('WORKBENCH_FILE_BUSY'); return action(); });
    pending = result.catch(() => {}); return result;
  };
  const history = createHistory(tokens => {
    for (let i = 0; i < tokens.length; i += 100) void api.fileOperation({ action: 'releaseHistory', tokens: tokens.slice(i, i + 100) }).catch(fail);
  });
  const publish = event => { for (const listener of listeners) listener(event); };
  const unsubscribeEnvironment = environment?.subscribe(() => publish({ kind: 'environment' }));
  return {
    id: uniqueId(), documents, history, environment, conversations: createConversationStore(), run, get locked() { return locked; },
    exclusive(action) { return run(async () => { locked = true; publish({ kind: 'lock', locked }); try { return await action(); } finally { locked = false; publish({ kind: 'lock', locked }); } }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish,
    dispose() { unsubscribeEnvironment?.(); disposed = true; void pending.finally(() => { history.dispose(); documents.clear(); listeners.clear(); }); },
  };
}
