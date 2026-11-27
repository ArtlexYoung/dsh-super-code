import { defaults, readPreferences } from './editor/preferences.js';

const KEY = 'dsh-super-code-workbench-enabled';
const OPEN_FILES_KEY = 'dsh-super-code-workbench-open-files';
const LEGACY_READING_KEY = 'dsh-super-code-reading-enabled';
const EDITOR_KEY = 'dsh-super-code-workbench';

/** 全部会话和两个设置入口共用；保存失败不发布尚未持久化的值。 */
export function createEditorPreference(storage) {
  const listeners = new Set();
  let state = { preferences: defaults(), invalid: false };
  const update = next => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; for (const listener of listeners) listener();
  };
  function refresh(event = { key: EDITOR_KEY }) {
    if (event.key !== null && event.key !== EDITOR_KEY) return;
    let next;
    try {
      const saved = storage.getItem(EDITOR_KEY);
      next = { preferences: saved ? readPreferences(JSON.parse(saved)) : defaults(), invalid: false };
    } catch { next = { ...state, invalid: true }; }
    update(next);
  }
  refresh();
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(value) {
      const preferences = readPreferences(value);
      try { storage.setItem(EDITOR_KEY, JSON.stringify(preferences)); }
      catch (cause) { throw new Error('WORKBENCH_SETTINGS_WRITE', { cause }); }
      update({ preferences, invalid: false });
    },
    refresh,
  };
}

/** 纯界面模块的开关保存在当前客户端，不改变项目、预设或模型。 */
export function createWorkbenchPreference(storage) {
  const listeners = new Set();
  const read = () => ({
    enabled: storage.getItem(KEY) !== 'false' || storage.getItem(LEGACY_READING_KEY) === 'true',
    openFiles: storage.getItem(OPEN_FILES_KEY) !== 'false',
  });
  let state = read();
  const update = value => { if (value.enabled === state.enabled && value.openFiles === state.openFiles) return; state = value; for (const listener of listeners) listener(); };
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(patch) {
      if (patch.enabled !== undefined) {
        storage.setItem(KEY, String(patch.enabled));
        if (storage.getItem(LEGACY_READING_KEY) === 'true') storage.setItem(LEGACY_READING_KEY, 'false');
      }
      if (patch.openFiles !== undefined) storage.setItem(OPEN_FILES_KEY, String(patch.openFiles));
      update(read());
    },
    refresh(event) { if ([KEY, OPEN_FILES_KEY, LEGACY_READING_KEY, null].includes(event.key)) update(read()); },
  };
}
