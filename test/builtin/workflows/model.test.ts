import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workflowCatalog } from '../../../scripts/skills/catalog.mjs';
import { recipes } from '../../../builtin/workflows/recipes.js';
import { skillAvailability, filterSkills, commandDraft, initialPreferences, readPreferences, recordProgress, savePreferences } from '../../../builtin/workflows/model.js';

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
  const value = { favorites: ['matt/tdd'], recent: ['matt/tdd'], runs: { session: { recipe: 'matt-fix', routes: { 'matt-fix': ['diagnosing-bugs', 'retro'] } } } };
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
  assert.deepEqual(read.runs.session.routes['matt-feature'], ['to-spec']);
  assert.deepEqual(read.runs.oil.routes['oil-design'], ['task', 'implement']);
  assert.deepEqual(read.runs.fix.routes['matt-fix'], ['diagnosing-bugs', 'code-review', 'retro']);
  assert.deepEqual(read.favorites, ['mattpocock/grilling']);
});

test('independent routes keep progress when switching and use stable checkpoint identities', () => {
  const empty = initialPreferences({ getItem: () => null }).value;
  const feature = recordProgress(empty, 'session', 'matt-feature', ['to-spec']);
  const fix = recordProgress(feature, 'session', 'matt-fix', ['diagnosing-bugs']);
  assert.deepEqual(fix.runs.session.routes, { 'matt-feature': ['to-spec'], 'matt-fix': ['diagnosing-bugs'] });
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
