/** 标签只管理显示顺序；关闭后保留项目缓冲和撤销记录。 */
export function createTabs(documents) {
  const closed = new Set();
  const list = () => [...documents].filter(([path]) => !closed.has(path))
    .map(([path, doc]) => ({ path, dirty: doc.dirty, pinned: !!doc.pinned }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return {
    list,
    isClosed: path => closed.has(path),
    open(path) {
      if (!closed.delete(path)) return;
      const doc = documents.get(path); documents.delete(path); documents.set(path, doc);
    },
    close(path) { if (documents.has(path)) closed.add(path); },
    move(path, target, after = false) {
      const items = list(), source = items.find(item => item.path === path), destination = items.find(item => item.path === target);
      if (!source || !destination || path === target || source.pinned !== destination.pinned) return;
      const order = items.filter(item => item !== source), at = order.indexOf(destination) + Number(after);
      order.splice(at, 0, source);
      const entries = [...order.map(item => [item.path, documents.get(item.path)]), ...[...documents].filter(([path]) => closed.has(path))];
      documents.clear(); for (const [path, doc] of entries) documents.set(path, doc);
    },
    forget(affected) { for (const path of closed) if (affected(path)) closed.delete(path); },
    clear() { closed.clear(); },
  };
}
