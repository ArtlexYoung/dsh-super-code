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
    rename(from, to) {
      for (const set of [closed, rendered]) if (set.delete(from)) set.add(to);
      if (preview === from) preview = to;
      order = order.map(id => { const [kind, path] = JSON.parse(id); return idOf(path === from ? to : path, kind); });
    },
    clear() { closed.clear(); rendered.clear(); preview = null; order = []; },
  };
}

export function tabsToClose(items, mode, path, kind = 'file') {
  const at = items.findIndex(item => item.path === path && item.kind === kind);
  if (mode !== 'saved' && at < 0) return [];
  return items.filter((item, index) => !item.pinned && (
    mode === 'saved' ? !item.dirty : mode === 'others' ? index !== at : mode === 'right' && index > at
  ));
}

/** 同路径的源码和渲染仍用类型区分；目录只用于区分不同路径的同名文件。 */
export function tabDirectories(items) {
  const groups = new Map(), result = new Map();
  for (const path of new Set(items.map(item => item.path))) {
    const parts = path.split('/'), name = parts.pop();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ path, parts });
  }
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      let depth = 1;
      while (depth < entry.parts.length && entries.some(other => other !== entry && other.parts.slice(-depth).join('/') === entry.parts.slice(-depth).join('/'))) depth++;
      result.set(entry.path, entry.parts.slice(-depth).join('/') || '.');
    }
  }
  return result;
}

/** 历史在一个工作台的分栏之间共享，不复制正文；分栏收起后仍可恢复。 */
export function createClosedTabs() {
  const listeners = new Set();
  let entries = [];
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    peek: () => entries.at(-1),
    record(entry) { entries = entries.filter(item => item.file !== entry.file || item.kind !== entry.kind); entries.push(entry); entries = entries.slice(-20); publish(); },
    remove(entry) { entries = entries.filter(item => item !== entry); publish(); },
    forget(affected) { entries = entries.filter(item => !affected(item.file)); publish(); },
    rename(from, to) { entries = entries.map(entry => entry.file === from ? { ...entry, file: to } : entry); publish(); },
    clear() { entries = []; publish(); },
  };
}
