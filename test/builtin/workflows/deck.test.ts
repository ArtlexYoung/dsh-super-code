import test from 'node:test';
import assert from 'node:assert/strict';
import { recipes } from '../../../builtin/workflows/recipes.js';
import { cardsFor, replaceCards, cardState, moveCard } from '../../../builtin/workflows/deck.js';
import { emptyRoute, emptyStage, changeStage, readPreferences, savePreferences, recordProgress } from '../../../builtin/workflows/model.js';

test('author suggestions can be entered freely; explicit prerequisites follow saved outcomes', () => {
  const recipe = recipes[0], run = emptyRoute(), cards = cardsFor(recipe, run);
  assert.equal(cardState(cards[3], run), 'pending');
  const linked = replaceCards(run, cards.map((card, index) => ({ ...card, dependsOn: index === 3 ? [cards[0].id, cards[1].id] : [] })), recipe.pack);
  assert.equal(cardState(linked.cards[3], linked), 'waiting');
  const first = changeStage(linked, cards[0].id, { ...emptyStage(), status: 'completed', result: 'Goal recorded' });
  assert.equal(cardState(linked.cards[3], first), 'waiting');
  const second = changeStage(first, cards[1].id, { ...emptyStage(), status: 'completed', result: 'Spec accepted' });
  assert.equal(cardState(linked.cards[3], second), 'pending');
  const reopened = changeStage(second, cards[0].id, emptyStage());
  assert.equal(cardState(linked.cards[3], reopened), 'waiting');
});

test('custom tasks, ordering, prerequisites and old outcomes survive storage without changing the author template', () => {
  const recipe = recipes[0], cards = cardsFor(recipe, emptyRoute());
  const added = { ...cards[3], id: 'task-a', title: ['修复金额排序', 'Fix amount sorting'], dependsOn: [cards[1].id] };
  const edited = replaceCards(emptyRoute(), [...cards, added], recipe.pack);
  const moved = moveCard(edited, added.id, -1);
  assert.equal(moved.cards[4].id, added.id);
  assert.equal(recipe.steps.length, 5);
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const value = recordProgress({ favorites: [], recent: [], runs: {} }, 'a', recipe.id, moved);
  savePreferences(storage, value);
  assert.deepEqual(readPreferences(storage), value);
  data.clear();
  data.set('dsh-super-code.workflows.v3', JSON.stringify(recordProgress(value, 'b', recipe.id, { goal: 'Old goal', stages: { 'to-spec': { ...emptyStage(), status: 'completed', result: 'Keep me' } } })));
  assert.equal(readPreferences(storage).runs.b.routes[recipe.id].stages['to-spec'].result, 'Keep me');
});

test('task dependencies reject cycles, missing tasks, invalid Skill names and duplicates', () => {
  const cards = cardsFor(recipes[0], emptyRoute());
  assert.throws(() => replaceCards(emptyRoute(), cards.map((card, i) => ({ ...card, dependsOn: [cards[(i + 1) % cards.length].id] })), recipes[0].pack), /cycle/i);
  assert.throws(() => replaceCards(emptyRoute(), [{ ...cards[0], dependsOn: ['missing'] }], recipes[0].pack), /depend/i);
  assert.throws(() => replaceCards(emptyRoute(), [cards[0], cards[0]], recipes[0].pack), /duplicate/i);
  assert.throws(() => replaceCards(emptyRoute(), [{ ...cards[0], skill: 'unknown-command' }], recipes[0].pack), /Skill/);
  assert.throws(() => replaceCards(emptyRoute(), [{ ...cards[0], skill: 'poteto-mode' }], recipes[0].pack), /Skill/);
});


test('changing an accepted task contract reopens it while preserving prior evidence', () => {
  const recipe=recipes[0], cards=cardsFor(recipe,emptyRoute());
  const run=changeStage({ ...emptyRoute(),cards },cards[0].id,{ ...emptyStage(),status:'completed',result:'Existing evidence',files:['docs/decision.md'] });
  const renamed=replaceCards(run,cards.map((card,index)=>index===0?{...card,title:['新标题','New title']}:card),recipe.pack);
  assert.equal(renamed.stages[cards[0].id].status,'completed');
  const changed=replaceCards(renamed,renamed.cards.map((card,index)=>index===0?{...card,goal:['新增要求','New requirement']}:card),recipe.pack);
  assert.equal(changed.stages[cards[0].id].status,'pending');
  assert.equal(changed.stages[cards[0].id].result,'Existing evidence');
  assert.deepEqual(changed.stages[cards[0].id].files,['docs/decision.md']);
});
