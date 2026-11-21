import test from 'node:test';
import assert from 'node:assert/strict';
import { readChanges, readChange, specTasks } from '../../../builtin/workflows/spec-files.js';
import { fixtureFileApi, specFixtureFiles } from './fixture-files.js';

test('OpenSpec discovers active and archived changes and reads nested specification files', async () => {
  const api = fixtureFileApi(specFixtureFiles), signal = new AbortController().signal;
  const result = await readChanges(api, signal);
  assert.equal(result.kind, 'ready');
  assert.deepEqual(result.changes.map(change => [change.name, change.archived]), [['saved-search', false], ['2026-11-19-sort-amounts', true]]);
  const change = await readChange(api, result.changes[0].path, signal);
  assert.equal(change.documents.length, 4);
  assert.ok(change.documents.some(file => file.path.endsWith('specs/search/filters/spec.md')));
  assert.equal(change.tasks?.length, 4);
  assert.equal(change.tasks?.filter(task => task.completed).length, 2);
});

test('task progress ignores checkbox examples in fenced code and counts nested tasks once', () => {
  assert.deepEqual(specTasks('```md\n- [x] example\n```\n\n- [ ] parent\n  - [X] child\n\n1. [x] numbered\n'), [
    { text: 'parent', completed: false }, { text: 'child', completed: true }, { text: 'numbered', completed: true },
  ]);
});

test('missing project and missing tasks stay distinct from completed work', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await readChanges(fixtureFileApi({}), signal), { kind: 'missing', changes: [] });
  const api = fixtureFileApi({ 'openspec/changes/new/proposal.md': '# Proposal' });
  assert.equal((await readChange(api, 'openspec/changes/new', signal)).tasks, null);
});

test('read errors, cancellation and oversized directory trees are not reported as empty success', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readChanges(fixtureFileApi(specFixtureFiles), controller.signal), { name: 'AbortError' });
  await assert.rejects(readChanges({ async list() { throw new Error('offline'); } }), /offline/);
  const files = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`openspec/changes/large/${index}.md`, '# Spec']));
  await assert.rejects(readChange(fixtureFileApi(files), 'openspec/changes/large'), /SPEC_DIRECTORY_LIMIT/);
});
