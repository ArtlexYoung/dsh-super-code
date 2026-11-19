import { ChangeSet } from '@codemirror/state';
import { literalMatches } from '../../../src/workbench/search-query.ts';
import { asText } from './history.js';

export function replacementChange(text, query) {
  return ChangeSet.of([...literalMatches(text.toString(), query.search, query.caseSensitive)].map(match => ({ ...match, insert: query.replace })), text.length);
}

/** 已成功的文件逐项记账；取消或冲突不会抹掉已应用部分的撤销入口。 */
export async function replaceProject({ api, project, owner, matches, query, applyText, persist, progress, signal }) {
  const result = { changed: [], failed: [] };
  for (const match of matches) {
    signal.throwIfAborted();
    try {
      await project.exclusive(async () => {
        const loaded = await api.read(match.path, signal), cached = project.documents.get(match.path);
        signal.throwIfAborted();
        if (loaded.version !== match.version || cached?.dirty) throw new Error('WORKBENCH_CONFLICT');
        const before = asText(loaded.text), changes = replacementChange(before, query);
        if (changes.empty) return;
        const after = changes.apply(before);
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
