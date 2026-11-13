const KEY = 'dsh-super-code-workbench-enabled';

/** 纯界面模块的开关保存在当前客户端，不改变项目、预设或模型。 */
export function createWorkbenchPreference(storage, key = KEY) {
  const listeners = new Set();
  let enabled = storage.getItem(key) === 'true';
  const update = value => { if (value === enabled) return; enabled = value; for (const listener of listeners) listener(); };
  return {
    snapshot: () => enabled,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(value) { storage.setItem(key, String(value)); update(value); },
    refresh(event) { if (event.key === key || event.key === null) update(storage.getItem(key) === 'true'); },
  };
}
