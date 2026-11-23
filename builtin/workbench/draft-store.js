import { z } from 'zod';

export const MAX_DRAFT_BYTES = 16 * 1024 * 1024;
export const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;
const path = z.string().min(1).max(4096).refine(value => !/[\\\0:]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '..' || part === '.'));
const entriesSchema = z.array(z.object({ path, text: z.string(), original: z.string(), diskVersion: z.string().min(1) })).max(100);
const recordSchema = z.object({ version: z.literal(1), revision: z.number().int().positive(), updatedAt: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), entries: entriesSchema });

export function draftRecord(entries, revision) {
  const parsed = entriesSchema.safeParse(entries);
  if (!parsed.success) throw new Error(Array.isArray(entries) && entries.length > 100 ? 'WORKBENCH_DRAFT_SIZE' : 'WORKBENCH_DRAFT_INVALID');
  if (new Set(parsed.data.map(item => item.path)).size !== parsed.data.length) throw new Error('WORKBENCH_DRAFT_INVALID');
  const bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).length;
  if (bytes > MAX_DRAFT_BYTES) throw new Error('WORKBENCH_DRAFT_SIZE');
  return { version: 1, revision: revision + 1, updatedAt: Date.now(), entries: parsed.data, bytes };
}
function readRecord(value) {
  if (value === undefined) return null;
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new Error('WORKBENCH_DRAFT_INVALID');
  const checked = draftRecord(parsed.data.entries, parsed.data.revision - 1);
  if (checked.bytes !== parsed.data.bytes) throw new Error('WORKBENCH_DRAFT_INVALID');
  return parsed.data;
}
function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open('dsh-super-code-workbench-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts').createIndex('bytes', 'bytes');
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => database.close(); resolve(database); };
    request.onerror = () => reject(new Error('WORKBENCH_DRAFT_STORAGE'));
    request.onblocked = () => reject(new Error('WORKBENCH_DRAFT_STORAGE'));
  });
}

/** 独立于标签元数据；同来源客户端内按会话、项目隔离，写入使用版本核对。 */
export function createDraftStore(sessionId, factory = globalThis.indexedDB) {
  let database;
  async function transact(root, mode, action) {
    if (!factory) throw new Error('WORKBENCH_DRAFT_STORAGE');
    const connection = await (database ||= openDatabase(factory).catch(error => { database = null; throw error; }));
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('drafts', mode), store = transaction.objectStore('drafts'), key = JSON.stringify([sessionId, root]);
      let result, failure;
      const abort = error => { failure = error; transaction.abort(); };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || new Error('WORKBENCH_DRAFT_STORAGE'));
      const request = store.get(key);
      request.onsuccess = () => {
        try { action({ store, key, current: readRecord(request.result), finish: value => { result = value; }, abort }); }
        catch (error) { abort(error); }
      };
    });
  }
  return {
    read: root => transact(root, 'readonly', ({ current, finish }) => finish(current)),
    save(root, entries, revision) {
      const next = draftRecord(entries, revision);
      return transact(root, 'readwrite', ({ store, key, current, finish, abort }) => {
        if ((current?.revision || 0) !== revision) throw new Error('WORKBENCH_RECOVERY_CHANGED');
        let bytes = next.bytes;
        const request = store.index('bytes').openKeyCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (cursor) { if (cursor.primaryKey !== key) bytes += cursor.key; cursor.continue(); return; }
            if (bytes > MAX_RECOVERY_BYTES) { abort(new Error('WORKBENCH_DRAFT_SIZE')); return; }
            store.put(next, key); finish(next);
          } catch { abort(new Error('WORKBENCH_DRAFT_STORAGE')); }
        };
      });
    },
  };
}
