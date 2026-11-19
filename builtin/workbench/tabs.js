/** 标签只管理显示顺序；关闭后保留项目缓冲和撤销记录。 */
export function createTabs(documents) {
  const closed = new Set(), rendered = new Set();
  let preview = null, order = [];
  const idOf = (path, kind) => JSON.stringify([kind, path]);
  const keep = path => { if (preview === path) preview = null; };
  const list = () => {
    if (preview && (documents.get(preview)?.dirty || documents.get(preview)?.pinned)) preview = null;
    const ranks = new Map(order.map((id, i) => [id, i]));
    return [...documents].flatMap(([path, doc]) => [
      ...(!closed.has(path) ? [{ id: idOf(path, 'file'), path, kind: 'file', dirty: doc.dirty, pinned: !!doc.pinned, preview: preview === path }] : []),
      ...(rendered.has(path) ? [{ id: idOf(path, 'markdown'), path, kind: 'markdown', dirty: false, pinned: false, preview: false }] : []),
    ]).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length));
  };
  return {
    list, keep,
    isClosed: path => closed.has(path),
    open(path, temporary = false, fresh = false) {
      const reopened = closed.delete(path);
      if (reopened) {
        const doc = documents.get(path); documents.delete(path); documents.set(path, doc);
        order = order.filter(id => id !== idOf(path, 'file'));
      }
      if (!temporary) keep(path);
      else if ((fresh || reopened) && !documents.get(path)?.dirty && !documents.get(path)?.pinned) {
        if (preview && preview !== path && !documents.get(preview)?.dirty && !documents.get(preview)?.pinned) closed.add(preview);
        preview = path;
      }
    },
    render(path) { rendered.add(path); keep(path); },
    close(path, kind = 'file') { if (kind === 'markdown') rendered.delete(path); else { if (documents.has(path)) closed.add(path); keep(path); } },
    move(path, target, after = false) {
      const items = list(), source = items.find(item => item.id === path || item.kind === 'file' && item.path === path), destination = items.find(item => item.id === target || item.kind === 'file' && item.path === target);
      if (!source || !destination || source === destination || source.pinned !== destination.pinned) return;
      const next = items.filter(item => item !== source), at = next.indexOf(destination) + Number(after);
      next.splice(at, 0, source); order = next.map(item => item.id);
      keep(source.path);
    },
    forget(affected) {
      for (const set of [closed, rendered]) for (const path of set) if (affected(path)) set.delete(path);
      if (preview && affected(preview)) preview = null;
      order = order.filter(id => !affected(JSON.parse(id)[1]));
    },
    clear() { closed.clear(); rendered.clear(); preview = null; order = []; },
  };
}
