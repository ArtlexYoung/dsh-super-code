export function checkProjectMove(project, from, to) {
  if (project.documents.has(to)) throw new Error('WORKBENCH_FILE_EXISTS');
  project.publish({ kind: 'beforeMove', from, to });
}

export async function undoMove(editing, entry, direction) {
  const { project, api, owner } = editing;
  checkProjectMove(project, entry.path, entry.previousPath);
  const result = await api.fileOperation({ action: direction, token: entry.token, version: project.documents.get(entry.path)?.version });
  project.history.complete(owner, direction, entry, { ...entry, path: result.path, previousPath: result.previousPath });
  moveProjectFile(project, result);
  return { ...entry, path: result.path };
}

/** 共享正文只移动一次；视图收到事件后各自更新导航与标签，不复制草稿。 */
export function moveProjectFile(project, { previousPath: from, path: to, version, previousVersion }) {
  const doc = project.documents.get(from);
  if (doc) { project.documents.delete(from); doc.path = to; doc.version = version; project.documents.set(to, doc); }
  project.history.rename(from, to);
  const threads = project.conversations.files.get(from);
  if (threads) {
    project.conversations.files.delete(from);
    for (const thread of threads) { thread.file = to; thread.version++; }
    project.conversations.files.set(to, threads); project.conversations.publish();
  }
  project.publish({ kind: 'move', from, to, version, previousVersion });
  for (const path of new Set([from, to].map(path => path.split('/').slice(0, -1).join('/')))) project.publish({ kind: 'directory', path });
}

export function moveMapEntry(map, from, to) {
  if (!map.has(from)) return;
  const entries = [...map]; map.clear();
  for (const [path, value] of entries) map.set(path === from ? to : path, value);
}
