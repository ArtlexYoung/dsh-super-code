import { createBuffer } from '../buffer.js';
import { asText, textChanges, undoChanges, mapChanges } from './history.js';
import { replaceProject } from './replace.js';
import { checkProjectMove, moveProjectFile, undoMove } from './move.js';

function fileRequest(project, input) {
  if (input.action === 'trash' && [...project.documents].some(([path, doc]) => (path === input.path || path.startsWith(`${input.path}/`)) && doc.dirty)) throw new Error('WORKBENCH_FILE_UNSAVED');
  if (input.action !== 'move') return input;
  checkProjectMove(project, input.path, input.destination);
  return { ...input, version: project.documents.get(input.path)?.version };
}

export function operateFiles(editing, input, signal) {
  const { project, api, owner, binding } = editing;
  return project.exclusive(async () => {
    if (editing.project !== project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED');
    const result = await api.fileOperation(fileRequest(project, input), signal);
    if (result.token) project.history.record(owner, { kind: input.action === 'move' ? 'move' : 'file', path: result.path, previousPath: result.previousPath, token: result.token });
    if (input.action === 'move') moveProjectFile(project, result);
    if (input.action === 'trash') await editing.remove(input.path, project);
    return result;
  });
}

/** 文件修改流程集中在这里，视图只负责显示和导航。 */
export async function undoEdit(editing, direction) {
  const { project, api, owner, current, binding } = editing;
  const assertContext = () => { if (editing.project !== project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED'); };
  return project.exclusive(async () => {
    assertContext();
    const entry = project.history.peek(owner, direction, current);
    if (!entry) return null;
    if (entry.kind === 'move') return undoMove(editing, entry, direction);
    if (entry.kind === 'file') {
      const dirty = [...project.documents].filter(([path, doc]) => (path === entry.path || path.startsWith(`${entry.path}/`)) && doc.dirty);
      if (dirty.some(([, doc]) => doc.writers.size !== 1 || !doc.writers.has(owner))) throw new Error('WORKBENCH_FILE_UNSAVED');
      for (const [path] of dirty) { assertContext(); await editing.persist(path); }
      assertContext();
      await api.fileOperation({ action: direction, token: entry.token });
      project.history.complete(owner, direction, entry, entry);
      await editing.remove(entry.path, project);
      return entry;
    }
    return undoText(editing, entry, direction, assertContext);
  });
}

async function undoText(editing, entry, direction, assertContext) {
  const { project, api, owner, documents } = editing, disk = await api.read(entry.path);
  assertContext();
  let doc = project.documents.get(entry.path);
  if (!doc) { doc = createBuffer(disk); project.documents.set(entry.path, doc); }
  documents.set(entry.path, doc);
  const local = doc.state?.doc || asText(doc.text), original = asText(doc.original);
  const external = textChanges(original, asText(disk.text));
  if (!external.empty) editing.applyText(entry.path, mapChanges(external, textChanges(original, local)));
  doc.original = disk.text; doc.version = disk.version;
  const before = doc.state?.doc || asText(doc.text), change = undoChanges(entry, before);
  editing.applyText(entry.path, change);
  project.history.complete(owner, direction, entry, { kind: 'text', path: entry.path, before, after: change.apply(before), changes: change, saved: entry.saved });
  if (entry.saved) await editing.persist(entry.path); else editing.schedule(entry.path);
  return entry;
}

export function replaceFiles(editing, matches, query, progress, signal) {
  const { api, project, owner, binding } = editing;
  const assertContext = () => { if (editing.project !== project || editing.binding !== binding) throw new Error('WORKBENCH_PROJECT_CHANGED'); };
  return replaceProject({ api: { async read(path, signal) { assertContext(); const loaded = await api.read(path, signal); assertContext(); return loaded; } }, project, owner, matches, query, progress, signal,
    async persist(path, loaded, after, signal) {
      assertContext();
      let doc = project.documents.get(path);
      if (!doc) { doc = createBuffer(loaded); project.documents.set(path, doc); }
      else editing.acceptDisk(doc, loaded);
      const separator = loaded.text.includes('\r\n') ? '\r\n' : loaded.text.includes('\r') ? '\r' : '\n';
      signal.throwIfAborted();
      // 写入开始后等到结果再记账，停止只取消后续文件，避免已落盘修改丢失撤销入口。
      const result = await api.save({ path, text: after.sliceString(0, after.length, separator), version: loaded.version });
      doc.original = result.text; doc.version = result.version;
    },
    applyText(path, loaded, changes) {
      editing.applyText(path, changes, project); project.publish({ kind: 'saved', path });
      if (editing.project === project && editing.binding === binding) editing.cancel(path);
    },
  });
}
