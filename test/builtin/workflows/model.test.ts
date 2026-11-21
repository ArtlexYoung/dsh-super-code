import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workflowCatalog } from '../../../scripts/skills/catalog.mjs';
import { recipes } from '../../../builtin/workflows/recipes.js';
import { skillAvailability, filterSkills, commandDraft, initialPreferences, readPreferences, recordProgress, savePreferences, emptyRoute, emptyStage, changeStage, nextStageIndex, subscribePreferences } from '../../../builtin/workflows/model.js';

test('workflow catalog covers every distributed Skill and every route resolves to a real entry', async () => {
  const catalog = await workflowCatalog();
  assert.deepEqual(catalog.map(pack => pack.skills.length), [27, 58, 12, 1]);
  assert.deepEqual(JSON.parse(await readFile(new URL('../../../builtin/workflows/catalog.json', import.meta.url), 'utf8')), catalog);
  for (const recipe of recipes) {
    const pack = catalog.find(pack => pack.id === recipe.pack)!;
    assert.equal(new Set(recipe.steps.map(step => step.id)).size, recipe.steps.length);
    for (const step of recipe.steps) assert.ok(pack.skills.some(skill => skill.name === step.skill), `${recipe.id}/${step.skill}`);
    for (const tool of recipe.tools || []) assert.ok(pack.skills.some(skill => skill.name === tool.skill), `${recipe.id}/${tool.skill}`);
    if (recipe.playbook) assert.match(await readFile(new URL(`../../../builtin/skills/pstack/dsh/skills/poteto-mode/playbooks/${recipe.playbook}.md`, import.meta.url), 'utf8'), /Verify|Prove/);
  }
});

test('availability preserves host priority, disabled packages, invocation flags and Windows paths', () => {
  const skill = { name: 'tdd', path: 'pstack/dsh/skills/tdd/SKILL.md', userInvocable: true };
  assert.equal(skillAvailability(skill, []), 'unavailable');
  assert.equal(skillAvailability(skill, [{ name: 'tdd', path: '/project/.dsh/skills/tdd/SKILL.md' }]), 'overridden');
  assert.equal(skillAvailability(skill, [{ name: 'tdd', path: '/profile/skills/dsh-super-code/mattpocock/skills/tdd/SKILL.md' }]), 'overridden');
  assert.equal(skillAvailability(skill, [{ name: 'tdd', path: 'C:\\资料\\skills\\dsh-super-code\\pstack\\dsh\\skills\\tdd\\SKILL.md' }]), 'ready');
  assert.equal(skillAvailability(skill, [{ name: 'tdd', path: '/plugin/builtin/skills/' + skill.path, userInvocable: false }]), 'reference');
});

test('search combines package, words and favorites without changing the source', () => {
  const skills = [{ id: 'matt/tdd', pack: 'matt', name: 'tdd', description: 'test first' }, { id: 'pstack/tdd', pack: 'pstack', name: 'tdd', description: 'test first' }];
  assert.deepEqual(filterSkills(skills, { query: 'TEST tdd', pack: 'matt', favorites: [], onlyFavorites: false }), [skills[0]]);
  assert.deepEqual(filterSkills(skills, { query: '', pack: '', favorites: ['pstack/tdd'], onlyFavorites: true }), [skills[1]]);
  assert.equal(skills.length, 2);
});

test('command insertion preserves the draft and is idempotent', () => {
  assert.equal(commandDraft({ name: 'tdd' }, 'Fix invoice totals', 'Verify the bug'), '/tdd Verify the bug\n\nFix invoice totals');
  assert.equal(commandDraft({ name: 'tdd' }, '/tdd Fix invoice totals'), '/tdd Fix invoice totals');
});

test('favorite, recent and per-conversation progress survive reload; failed writes remain visible', () => {
  let data: string | null = null;
  const storage = { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } };
  const value = recordProgress({ favorites: ['matt/tdd'], recent: ['matt/tdd'], runs: {} }, 'session', 'matt-fix', changeStage(emptyRoute(), 'diagnosing-bugs', { ...emptyStage(), status: 'completed', result: 'Reproduction and regression passed' }));
  savePreferences(storage, value);
  assert.deepEqual(readPreferences(storage), value);
  assert.throws(() => savePreferences({ setItem: () => { throw new Error('quota'); } }, value), /quota/);
  data = '{}';
  assert.equal(initialPreferences(storage).error, true);
  data = '{"favorites":[],"recent":[],"runs":{"session":{"recipe":"x","completed":[-1]}}}';
  assert.throws(() => readPreferences(storage));
});

test('legacy progress follows the same work, never a new checkpoint at the old index', () => {
  const legacy = JSON.stringify({ favorites: ['mattpocock/grilling'], recent: [], runs: {
    session: { recipe: 'matt-feature', completed: [0, 1, 2, 3, 4] },
    oil: { recipe: 'oil-design', completed: [0, 2] },
    fix: { recipe: 'matt-fix', completed: [0, 2, 3] },
  } });
  const read = readPreferences({ getItem: (key: string) => key.endsWith('.v1') ? legacy : null });
  assert.deepEqual(Object.keys(read.runs.session.routes['matt-feature'].stages), ['to-spec']);
  assert.deepEqual(Object.keys(read.runs.oil.routes['oil-design'].stages), ['task', 'implement']);
  assert.deepEqual(Object.keys(read.runs.fix.routes['matt-fix'].stages), ['diagnosing-bugs', 'code-review', 'retro']);
  assert.deepEqual(read.favorites, ['mattpocock/grilling']);
});

test('independent routes keep progress when switching and use stable checkpoint identities', () => {
  const empty = initialPreferences({ getItem: () => null }).value;
  const featureRoute = changeStage(emptyRoute(), 'to-spec', { ...emptyStage(), status: 'completed', result: 'Specification reviewed' });
  const feature = recordProgress(empty, 'session', 'matt-feature', featureRoute);
  const fixRoute = changeStage(emptyRoute(), 'diagnosing-bugs', { ...emptyStage(), status: 'active' });
  const fix = recordProgress(feature, 'session', 'matt-fix', fixRoute);
  assert.deepEqual(fix.runs.session.routes, { 'matt-feature': featureRoute, 'matt-fix': fixRoute });
  const storage = new Map<string, string>();
  savePreferences({ setItem: (key: string, value: string) => { storage.set(key, value); } }, fix);
  assert.deepEqual(readPreferences({ getItem: (key: string) => storage.get(key) ?? null }), fix);
});

test('repeated use of one Skill updates the generated checkpoint and preserves user text', () => {
  const first = '本次流程步骤：Feature / 理解现状\n本关目标：了解入口';
  const second = '本次流程步骤：Feature / 定义结构\n本关目标：设计类型';
  const draft = commandDraft({ name: 'poteto-mode' }, '保留我的需求\n和第二行', first);
  assert.equal(commandDraft({ name: 'poteto-mode' }, draft, second), `/poteto-mode ${second}\n\n保留我的需求\n和第二行`);
  assert.equal(commandDraft({ name: 'poteto-mode' }, '/poteto-mode 我的独立指令', second), '/poteto-mode 我的独立指令');
});

test('paragraphs in workflow notes cannot become stale user text on the next invocation', () => {
  const original = '保留用户的补充。\n\n以及第二段。';
  const first = commandDraft({ name: 'poteto-mode' }, original, '本次流程步骤：设计方案\n第一段旧笔记\n\n第二段旧笔记');
  const next = commandDraft({ name: 'poteto-mode' }, first, '本次流程步骤：设计方案\n新的设计决定');
  assert.equal(next, '/poteto-mode 本次流程步骤：设计方案\n新的设计决定\n\n' + original);
});


test('stages require outcomes or blocking reasons and retain work when focus moves', () => {
  assert.throws(() => changeStage(emptyRoute(), 'to-spec', { ...emptyStage(), status: 'completed' }), /result/);
  assert.throws(() => changeStage(emptyRoute(), 'to-spec', { ...emptyStage(), status: 'blocked' }), /blocker/);
  const spec = changeStage(emptyRoute(), 'to-spec', { ...emptyStage(), status: 'active', result: 'Draft spec', files: ['docs/spec.md'] });
  const tickets = changeStage(spec, 'to-tickets', { ...emptyStage(), status: 'active' });
  assert.equal(tickets.stages['to-spec'].status, 'pending');
  assert.deepEqual(tickets.stages['to-spec'].files, ['docs/spec.md']);
  assert.equal(tickets.stages['to-spec'].result, 'Draft spec');
  assert.equal(nextStageIndex(recipes[0], tickets), 2);
  const blocked = changeStage(tickets, 'to-tickets', { ...tickets.stages['to-tickets'], status: 'blocked', blocker: 'Need acceptance criteria' });
  assert.equal(blocked.stages['to-tickets'].blocker, 'Need acceptance criteria');
  const resumed = changeStage(blocked, 'to-tickets', { ...blocked.stages['to-tickets'], status: 'completed', result: 'Criteria agreed; three tickets recorded' });
  assert.equal(resumed.stages['to-tickets'].blocker, '');
  assert.equal(resumed.stages['to-tickets'].status, 'completed');
});

test('v2 completion is kept as historical confirmation without inventing artifacts', () => {
  const value = { favorites: [], recent: [], runs: { session: { recipe: 'matt-feature', routes: { 'matt-feature': ['to-spec'] } } } };
  const state = readPreferences({ getItem: (key: string) => key.endsWith('.v2') ? JSON.stringify(value) : null });
  const stage = state.runs.session.routes['matt-feature'].stages['to-spec'];
  assert.equal(stage.status, 'completed');
  assert.equal(stage.legacy, true);
  assert.equal(stage.result, '');
  assert.deepEqual(stage.files, []);
});


test('mounted workflow pages observe saves and stop receiving updates after unmount', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  let observed = initialPreferences(storage).value;
  const stop = subscribePreferences(storage, () => { observed = readPreferences(storage); });
  const matt = recordProgress(observed, 'shared', 'matt-feature', { goal: 'Matt goal', stages: {} });
  savePreferences(storage, matt);
  const pstack = recordProgress(readPreferences(storage), 'shared', 'pstack-feature', { goal: 'PStack goal', stages: {} });
  savePreferences(storage, pstack);
  assert.equal(observed.runs.shared.routes['matt-feature'].goal, 'Matt goal');
  assert.equal(observed.runs.shared.routes['pstack-feature'].goal, 'PStack goal');
  stop();
  savePreferences(storage, { ...pstack, favorites: ['mattpocock/tdd'] });
  assert.deepEqual(observed.favorites, []);
  assert.deepEqual(readPreferences(storage).favorites, ['mattpocock/tdd']);
});
