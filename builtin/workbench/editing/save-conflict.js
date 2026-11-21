import { asText, textChanges, mapChanges } from './history.js';

/** 三个版本都是完整文本；null 表示重叠修改需要用户选择，空字符串是有效合并结果。 */
function mergeDraft(base, draft, disk) {
  if (draft === disk) return disk;
  const original = asText(base), external = asText(disk);
  try {
    const changes = mapChanges(textChanges(original, asText(draft)), textChanges(original, external));
    const result = changes.apply(external), separator = disk.includes('\r\n') ? '\r\n' : disk.includes('\r') ? '\r' : '\n';
    return result.sliceString(0, result.length, separator);
  } catch (error) {
    if (error.message !== 'WORKBENCH_UNDO_CONFLICT') throw error;
    return null;
  }
}

export async function readSaveConflict(editing, path, signal) {
  const { project, binding } = editing;
  const disk = await editing.api.read(path, signal);
  signal?.throwIfAborted();
  if (editing.project !== project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED');
  const doc = project.documents.get(path);
  if (!doc) throw new Error('WORKBENCH_DRAFT_CHANGED');
  const base = doc.original, draft = doc.text;
  return { project: project.id, path, base, draft, version: doc.version, disk, merged: mergeDraft(base, draft, disk.text) };
}

/** 只更新共享缓冲区；写盘仍走原有 save 的版本保护，比较本身不会写入或暂存文件。 */
export function applySaveConflict(editing, entry, text) {
  const { project, binding, owner } = editing;
  return project.exclusive(async () => {
    const assertContext = () => {
      if (editing.project !== project || project.id !== entry.project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED');
    };
    assertContext();
    const disk = await editing.api.read(entry.path);
    assertContext();
    const doc = project.documents.get(entry.path);
    if (!doc || doc.text !== entry.draft || doc.original !== entry.base || doc.version !== entry.version) throw new Error('WORKBENCH_DRAFT_CHANGED');
    if (disk.version !== entry.disk.version || disk.text !== entry.disk.text) throw new Error('WORKBENCH_CONFLICT_STALE');
    const before = asText(doc.text), after = asText(text), changes = textChanges(before, after);
    editing.cancel(entry.path);
    doc.original = disk.text; doc.version = disk.version; doc.saveReview = true;
    if (!changes.empty) {
      project.history.record(owner, { kind: 'text', path: entry.path, before, after, changes });
      editing.applyText(entry.path, changes);
    }
    if (!doc.dirty) doc.writers.clear();
    project.publish({ kind: 'saved', path: entry.path });
  });
}
