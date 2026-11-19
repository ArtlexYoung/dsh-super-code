import { useSyncExternalStore } from 'react';

/** 工具草稿随原控制器交接，内部窗口与独立窗口共用一份状态。 */
export function usePanelState(workbench, key, initial) {
  const { panel } = useSyncExternalStore(workbench.subscribe, workbench.snapshot);
  const value = panel?.state?.[key] ?? initial;
  const set = next => {
    const current = workbench.snapshot().panel;
    if (!current || current.kind !== panel.kind || current.id !== panel.id) return;
    const previous = current.state?.[key] ?? initial;
    workbench.panel({ ...current, state: { ...current.state, [key]: typeof next === 'function' ? next(previous) : next } });
  };
  return [value, set];
}
