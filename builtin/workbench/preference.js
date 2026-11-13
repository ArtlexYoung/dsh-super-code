const KEY = 'dsh-super-code-workbench-enabled';
const LEGACY_READING_KEY = 'dsh-super-code-reading-enabled';

/** 纯界面模块的开关保存在当前客户端，不改变项目、预设或模型。 */
export function createWorkbenchPreference(storage) {
  const listeners = new Set();
  const read = () => storage.getItem(KEY) === 'true' || storage.getItem(LEGACY_READING_KEY) === 'true';
  let enabled = read();
  const update = value => { if (value === enabled) return; enabled = value; for (const listener of listeners) listener(); };
  return {
    snapshot: () => enabled,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(value) {
      storage.setItem(KEY, String(value));
      if (storage.getItem(LEGACY_READING_KEY) === 'true') storage.setItem(LEGACY_READING_KEY, 'false');
      update(value);
    },
    refresh(event) { if ([KEY, LEGACY_READING_KEY, null].includes(event.key)) update(read()); },
  };
}
