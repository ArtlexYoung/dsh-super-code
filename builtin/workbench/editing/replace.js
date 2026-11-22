import { ChangeSet } from '@codemirror/state';
import { literalMatches } from '../../../src/workbench/search-query.ts';
import { asText } from './history.js';

export function replacementChange(text, query) {
  return ChangeSet.of([...literalMatches(text.toString(), query.search, query.caseSensitive)].map(match => ({ ...match, insert: query.replace })), text.length);
}

/** 预览与写入使用同一份版本检查和替换计算，预览本身不修改缓冲。 */
export async function readReplacement(api, project, match, query, signal) {
  const loaded = await api.read(match.path, signal);
  signal.throwIfAborted();
  if (loaded.version !== match.version || project.documents.get(match.path)?.dirty) throw new Error('WORKBENCH_CONFLICT');
  const before = asText(loaded.text), changes = replacementChange(before, query);
  return { loaded, before, changes, after: changes.apply(before) };
}

export function remainingReplacements(preview, paths) {
  const completed = new Set(paths), rows = preview.rows.filter(row => !completed.has(row.path));
  if (!rows.length) return null;
  return { ...preview, rows, selected: preview.selected.filter(path => !completed.has(path)), active: completed.has(preview.active) ? null : preview.active };
}

/** 已成功的文件逐项记账；取消或冲突不会抹掉已应用部分的撤销入口。 */
export async function replaceProject({ api, project, owner, matches, query, applyText, persist, progress, signal }) {
  const result = { changed: [], failed: [] };
  for (const match of matches) {
    signal.throwIfAborted();
    try {
      await project.exclusive(async () => {
        const { loaded, before, changes, after } = await readReplacement(api, project, match, query, signal);
        if (before.eq(after)) return;
        await persist(match.path, loaded, after, signal);
        project.history.record(owner, { kind: 'text', path: match.path, before, after, changes, saved: true });
        applyText(match.path, loaded, changes);
        result.changed.push(match.path);
      });
    } catch (error) { if (signal.aborted) throw error; result.failed.push({ path: match.path, error }); }
    progress({ ...result });
  }
  return result;
}
