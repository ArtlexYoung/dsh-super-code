const KEY = 'dsh-super-code-workbench-layout';
export const panelMinimum = { explorer: 130, reading: 260, files: 70 };
const rightDefaults = { conversation: 6, quick: 2, changes: 3, learning: 6 };
const paneDefaults = { conversation: true, quick: false, changes: false, learning: false };
export const sidebarMinimum = 70;

export function readLayout(storage) {
  const defaults = { explorer: 200, reading: 320, files: 280, filesOpen: true, outlineOpen: true, explorerOpen: true, rightOpen: true, right: { ...rightDefaults }, panes: { ...paneDefaults } };
  try {
    const value = JSON.parse(storage.getItem(KEY));
    if (!value || typeof value !== 'object') return defaults;
    return { ...Object.fromEntries(Object.entries(panelMinimum).map(([key, minimum]) => [key,
      Number.isFinite(value[key]) && value[key] >= minimum ? value[key] : defaults[key]])),
      ...Object.fromEntries(['filesOpen', 'outlineOpen', 'explorerOpen', 'rightOpen'].map(key => [key, typeof value[key] === 'boolean' ? value[key] : defaults[key]])),
      panes: Object.fromEntries(Object.entries(paneDefaults).map(([key, fallback]) => [key,
        typeof value.panes?.[key] === 'boolean' ? value.panes[key] : key === 'conversation' ? value.rightOpen !== false : fallback])),
      right: Object.fromEntries(Object.entries(rightDefaults).map(([key, fallback]) => [key,
        Number.isFinite(value.right?.[key]) && value.right[key] > 0 && value.right[key] <= 100 ? value.right[key] : fallback])) };
  } catch { return defaults; }
}

export function saveLayout(storage, value) { storage.setItem(KEY, JSON.stringify(value)); }

/** 主页面持有布局；独立窗口通过现有状态流读写同一份，避免临时来源丢失偏好。 */
export function createLayoutPreference(storage) {
  let state = readLayout(storage);
  const listeners = new Set();
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    change(patch) {
      const panes = patch.panes ? { ...state.panes, ...patch.panes } : state.panes;
      state = { ...state, ...patch, panes, ...(patch.panes ? { rightOpen: Object.values(panes).some(Boolean) } : {}) };
      for (const listener of listeners) listener();
    },
    save() { saveLayout(storage, state); },
  };
}

export function panelWidth(value, minimum, maximum) { return Math.round(Math.max(minimum, Math.min(maximum, value))); }

export function resizeSidebar(sizes, first, second, geometry) {
  const total = geometry.before + geometry.after, minimum = Math.min(sidebarMinimum, total / 2);
  const height = Math.max(minimum, Math.min(total - minimum, geometry.before + geometry.delta));
  const weight = sizes[first] + sizes[second];
  return { ...sizes, [first]: weight * height / total, [second]: weight * (total - height) / total };
}
