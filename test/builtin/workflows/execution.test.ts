import test from 'node:test';
import assert from 'node:assert/strict';
import { executionFacts } from '../../../builtin/workflows/execution.js';

test('execution facts use only the selected conversation and preserve host todo status', () => {
  const state = { byId: {
    selected: { cwd: '/repo', projectionValues: {
      superCodeTasks: { current: { kind: 'task', title: 'Fix export', status: 'active', goal: 'Preserve leading zeros', next: 'Verify sample data' } },
      superCodeFeedback: { phase: 'running', request: 'Old request', todos: [{ content: 'Inspect export', status: 'completed' }],
        activities: [{ callId: 'tool-1', tool: 'read', status: 'succeeded' }] },
    } },
    other: { projectionValues: { superCodeFeedback: { request: 'Private other task', todos: [{ content: 'Other task', status: 'pending' }] } } },
  } };
  const facts = executionFacts(state, 'selected');
  assert.equal(facts.goal, 'Preserve leading zeros');
  assert.equal(facts.title, 'Fix export');
  assert.equal(facts.taskStatus, 'active');
  assert.equal(facts.next, 'Verify sample data');
  assert.equal(facts.cwd, '/repo');
  assert.equal(facts.phase, 'running');
  assert.deepEqual(facts.todos, [{ content: 'Inspect export', status: 'completed' }]);
  assert.equal(facts.activities[0].callId, 'tool-1');
  assert.equal(JSON.stringify(facts).includes('Private other task'), false);
  assert.deepEqual(executionFacts(state, 'missing').todos, []);
});

test('legacy public projection shape works, and file activity keeps the latest operation per path', () => {
  const facts = executionFacts({ projectionsBySession: { sample: { values: {
    workingDirectory: 'C:\\repo', superCodeFeedback: {
      goal: { kind: 'recorded', text: 'Document export behavior' },
      files: [{ path: 'docs/export.md', operation: 'create', seq: 1 }, { path: 'src/export.ts', operation: 'edit', seq: 2 }, { path: 'docs/export.md', operation: 'edit', seq: 3 }],
      omittedFiles: 2,
    },
  } } } }, 'sample');
  assert.equal(facts.goal, 'Document export behavior');
  assert.equal(facts.cwd, 'C:\\repo');
  assert.equal(facts.partial, true);
  assert.deepEqual(facts.files, [{ path: 'docs/export.md', operation: 'edit', seq: 3 }, { path: 'src/export.ts', operation: 'edit', seq: 2 }]);
});

test('native todos are usable before feedback arrives; a new empty feedback plan clears old todos', () => {
  const values = { todos: [{ content: 'Native task', status: 'in_progress' }] };
  assert.equal(executionFacts({ byId: { sample: { projectionValues: values } } }, 'sample').todos.length, 1);
  const facts = executionFacts({ byId: { sample: { projectionValues: { ...values, superCodeFeedback: { todos: [], request: 'New request' } } } } }, 'sample');
  assert.deepEqual(facts.todos, []);
  assert.equal(facts.goal, 'New request');
});
