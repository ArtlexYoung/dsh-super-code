import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workflowCatalog } from '../../../scripts/skills/catalog.mjs';
import { recipes } from '../../../builtin/workflows/recipes.js';
import { skillAvailability, filterSkills, commandDraft, initialPreferences, readPreferences, savePreferences } from '../../../builtin/workflows/model.js';

test('workflow catalog covers every distributed Skill and every route resolves to a real entry', async () => {
  const catalog = await workflowCatalog();
  assert.deepEqual(catalog.map(pack => pack.skills.length), [27, 58, 12, 1]);
  assert.deepEqual(JSON.parse(await readFile(new URL('../../../builtin/workflows/catalog.json', import.meta.url), 'utf8')), catalog);
  for (const recipe of recipes) {
    const pack = catalog.find(pack => pack.id === recipe.pack)!;
    for (const [name] of recipe.steps) assert.ok(pack.skills.some(skill => skill.name === name), `${recipe.id}/${name}`);
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
  const value = { favorites: ['matt/tdd'], recent: ['matt/tdd'], runs: { session: { recipe: 'matt-fix', completed: [0, 2] } } };
  savePreferences(storage, value);
  assert.deepEqual(readPreferences(storage), value);
  assert.throws(() => savePreferences({ setItem: () => { throw new Error('quota'); } }, value), /quota/);
  data = '{}';
  assert.equal(initialPreferences(storage).error, true);
  data = '{"favorites":[],"recent":[],"runs":{"session":{"recipe":"x","completed":[-1]}}}';
  assert.throws(() => readPreferences(storage));
});
