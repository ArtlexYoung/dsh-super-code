const KEY = 'dsh-super-code-workbench-layout';
export const panelMinimum = { explorer: 130, reading: 260 };

export function readLayout(storage) {
  const defaults = { explorer: 220, reading: 380, learningOpen: storage.getItem('dsh-super-code-reading-enabled') === 'true' };
  try {
    const value = JSON.parse(storage.getItem(KEY));
    if (!value || typeof value !== 'object') return defaults;
    return { ...Object.fromEntries(Object.entries(panelMinimum).map(([key, minimum]) => [key,
      Number.isFinite(value[key]) && value[key] >= minimum ? value[key] : defaults[key]])),
      learningOpen: typeof value.learningOpen === 'boolean' ? value.learningOpen : defaults.learningOpen };
  } catch { return defaults; }
}

export function saveLayout(storage, value) { storage.setItem(KEY, JSON.stringify(value)); }

export function panelWidth(value, minimum, maximum) { return Math.round(Math.max(minimum, Math.min(maximum, value))); }
