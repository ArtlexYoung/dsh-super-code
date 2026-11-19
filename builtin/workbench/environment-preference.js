const languages = new Set(['python', 'javascript', 'go', 'rust', 'java', 'cpp', 'csharp', 'php', 'ruby']);

export function readEnvironmentPaths(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || !Object.entries(value).every(([key, path]) => languages.has(key) && typeof path === 'string' && path.length <= 4096 && !path.includes('\0'))) throw new Error('WORKBENCH_PREFERENCES_INVALID');
  return Object.fromEntries(Object.entries(value).map(([key, path]) => [key, path.trim()]).filter(([, path]) => path));
}

/** 宿主来源由浏览器存储隔离，再按宿主返回的工作区根路径保存；不写入项目。 */
export function createEnvironmentPreference(storage, root) {
  if (typeof root !== 'string' || !root) throw new Error('WORKBENCH_WORKSPACE');
  const key = `dsh-super-code-workspace:${JSON.stringify(root)}:languages`, listeners = new Set();
  let state = { paths: {}, invalid: false };
  function update(next) {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; for (const listener of listeners) listener();
  }
  function refresh(event = { key }) {
    if (event.key !== null && event.key !== key) return;
    try { const saved = storage.getItem(key); update({ paths: saved ? readEnvironmentPaths(JSON.parse(saved)) : {}, invalid: false }); }
    catch { update({ ...state, invalid: true }); }
  }
  refresh();
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(value) {
      const paths = readEnvironmentPaths(value);
      try { storage.setItem(key, JSON.stringify(paths)); }
      catch (cause) { throw new Error('WORKBENCH_SETTINGS_WRITE', { cause }); }
      update({ paths, invalid: false });
    },
    refresh,
  };
}
