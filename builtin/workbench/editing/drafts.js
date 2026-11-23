import { createBuffer } from '../buffer.js';
import { asText, textChanges } from './history.js';

/** 恢复只进入编辑缓冲，保留原磁盘基线供现有保存冲突流程核对。 */
export function restoreDraft(editing, entry) {
  const { project, binding, owner } = editing;
  return project.exclusive(async () => {
    const disk = await editing.api.read(entry.path);
    if (editing.project !== project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED');
    let doc = project.documents.get(entry.path);
    if (doc?.dirty) throw new Error('WORKBENCH_RECOVERY_DIRTY');
    if (!doc) { doc = createBuffer(disk); project.documents.set(entry.path, doc); }
    const before = asText(doc.text), after = asText(entry.text), changes = textChanges(before, after);
    editing.cancel(entry.path);
    if (disk.text === entry.text) { editing.acceptDisk(doc, disk); project.publish({ kind: 'saved', path: entry.path }); return; }
    doc.original = entry.original; doc.version = entry.diskVersion;
    project.history.record(owner, { kind: 'text', path: entry.path, before, after, changes });
    editing.applyText(entry.path, changes);
    doc.saveReview = true;
    project.publish({ kind: 'saved', path: entry.path });
  });
}
