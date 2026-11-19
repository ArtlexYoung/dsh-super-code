const limitRatio = value => Math.max(.2, Math.min(.8, value));
const EDITOR_AREA = { left: 0, top: 0, width: 1, height: 1 };

/** 每个分栏持有自己的视图。布局按稳定的视图编号渲染，分割或合并时无需重建编辑器。 */
export function createEditorGroups(primary) {
  const listeners = new Set(), first = { id: 0, workbench: primary };
  let root = first, active = first, sequence = 0, snapshot;

  function publish() {
    const panes = [], dividers = [];
    function place(node, rect) {
      if (!node.children) { panes.push({ pane: node, rect }); return; }
      const { left, top, width, height } = rect;
      const along = node.vertical ? height : width;
      const offset = along * node.ratio;
      dividers.push({ node, rect });
      if (node.vertical) {
        place(node.children[0], { left, top, width, height: offset });
        place(node.children[1], { left, top: top + offset, width, height: height - offset });
      } else {
        place(node.children[0], { left, top, width: offset, height });
        place(node.children[1], { left: left + offset, top, width: width - offset, height });
      }
    }
    place(root, EDITOR_AREA);
    const parked = panes.some(({ pane }) => pane === first) ? null : { pane: first, rect: EDITOR_AREA, hidden: true };
    snapshot = { panes: panes.sort((a, b) => a.pane.id - b.pane.id), dividers, active, parked };
    for (const listener of listeners) listener();
  }
  function replace(node, leaf, next) {
    if (node === leaf) return next;
    if (!node.children) return node;
    const children = node.children.map(child => replace(child, leaf, next)).filter(Boolean);
    if (children.length === 1) return children[0];
    node.children = children;
    return node;
  }
  publish();
  return {
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    activate(pane) { if (active !== pane && snapshot.panes.some(item => item.pane === pane)) { active = pane; publish(); } },
    split(pane, direction, initial) {
      if (!snapshot.panes.some(item => item.pane === pane)) return;
      const next = { id: ++sequence, workbench: primary.createPane(), initial };
      if (initial?.preview) next.previews = new Set([initial.item.path]);
      const before = direction === 'left' || direction === 'up';
      root = replace(root, pane, { id: next.id, vertical: direction === 'up' || direction === 'down', ratio: .5, children: before ? [next, pane] : [pane, next] });
      publish();
      return next;
    },
    resize(node, ratio) { node.ratio = limitRatio(ratio); publish(); },
    remove(pane) {
      const available = snapshot.panes;
      if (!available.some(item => item.pane === pane) || pane === first && available.length === 1) return;
      root = replace(root, pane, null) || first;
      if (active === pane) active = available.find(item => item.pane !== pane)?.pane || first;
      if (pane !== first) {
        pane.closed = true;
        primary.keepPaneEdits?.(pane.workbench);
        pane.workbench.dispose();
      }
      publish();
    },
    reset() {
      for (const { pane } of snapshot.panes) if (pane !== first) { pane.closed = true; pane.workbench.dispose(); }
      root = active = first;
      publish();
    },
  };
}

export function groupRect({ left, top, width, height }) {
  return { left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` };
}
