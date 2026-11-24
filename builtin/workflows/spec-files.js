import { marked } from 'marked';

/** Read only the current workspace; the host enforces path and sandbox boundaries. */
function artifactOrder(entry, path) {
  if (entry.path === `${path}/proposal.md`) return 0;
  if (entry.path.startsWith(`${path}/specs/`)) return 1;
  if (entry.path === `${path}/design.md`) return 2;
  if (entry.path === `${path}/tasks.md`) return 3;
  return 4;
}

export async function readChanges(api, signal) {
  const root = await api.list('', signal);
  if (root.truncated) throw new Error('SPEC_DIRECTORY_LIMIT');
  if (!root.entries.some(entry => entry.type === 'directory' && entry.name === 'openspec')) return { kind: 'missing', changes: [] };
  const spec = await api.list('openspec', signal);
  if (spec.truncated) throw new Error('SPEC_DIRECTORY_LIMIT');
  if (!spec.entries.some(entry => entry.type === 'directory' && entry.name === 'changes')) return { kind: 'ready', changes: [] };
  const listed = await api.list('openspec/changes', signal);
  if (listed.truncated) throw new Error('SPEC_DIRECTORY_LIMIT');
  const changes = listed.entries.filter(entry => entry.type === 'directory' && entry.name !== 'archive').map(entry => ({ ...entry, archived: false }));
  if (listed.entries.some(entry => entry.type === 'directory' && entry.name === 'archive')) {
    const archive = await api.list('openspec/changes/archive', signal);
    if (archive.truncated) throw new Error('SPEC_DIRECTORY_LIMIT');
    changes.push(...archive.entries.filter(entry => entry.type === 'directory').map(entry => ({ ...entry, archived: true })));
  }
  return { kind: 'ready', changes };
}

export function specTasks(markdown) {
  const tasks = [];
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type === 'list_item' && token.task) tasks.push({ text: token.text.split('\n')[0], completed: token.checked === true });
  });
  return tasks;
}

async function listDocuments(api, path, signal) {
  const queue = [{ path, depth: 0 }], documents = [];
  let folders = 0;
  while (queue.length) {
    signal.throwIfAborted();
    const current = queue.shift();
    if (++folders > 128 || current.depth > 8) throw new Error('SPEC_DIRECTORY_LIMIT');
    const listed = await api.list(current.path, signal);
    if (listed.truncated) throw new Error('SPEC_DIRECTORY_LIMIT');
    for (const entry of listed.entries) {
      if (entry.type === 'directory') queue.push({ path: entry.path, depth: current.depth + 1 });
      if (entry.type === 'file' && /\.md$/i.test(entry.name)) documents.push(entry);
    }
    if (documents.length > 256) throw new Error('SPEC_DIRECTORY_LIMIT');
  }
  return documents;
}

export async function readChange(api, path, signal = new AbortController().signal) {
  const documents = await listDocuments(api, path, signal);
  documents.sort((a, b) => artifactOrder(a, path) - artifactOrder(b, path) || a.path.localeCompare(b.path));
  const taskFile = documents.find(entry => entry.path === `${path}/tasks.md`);
  const tasks = taskFile ? specTasks((await api.read(taskFile.path, signal)).text) : null;
  return { documents, tasks };
}
