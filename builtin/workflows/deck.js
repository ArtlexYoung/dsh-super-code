import catalog from './catalog.json';

export const cardsFor = (recipe, run) => run.cards || recipe.steps.map(step => ({ ...step, dependsOn: [] }));

export function cardState(card, run) {
  const state = run.stages[card.id]?.status || 'pending';
  if (['completed', 'blocked'].includes(state)) return state;
  return card.dependsOn.some(id => run.stages[id]?.status !== 'completed') ? 'waiting' : state;
}

/** Validate saved or edited definitions once, before publishing them to the board. */
export function replaceCards(run, cards, pack) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 64) throw new Error('Invalid card count');
  const ids = new Set(), skills = new Set(catalog.find(item => item.id === pack)?.skills.map(skill => skill.name) || []);
  for (const card of cards) {
    if (!card || typeof card.id !== 'string' || !/^[\w-]{1,80}$/.test(card.id)) throw new Error('Invalid card identity');
    if (ids.has(card.id)) throw new Error('Duplicate card');
    ids.add(card.id);
    if (!skills.has(card.skill)) throw new Error('Unknown Skill');
    if (!['title', 'goal', 'output'].every(key => Array.isArray(card[key]) && card[key].length === 2 && card[key].every(text => typeof text === 'string' && text.trim().length > 0 && text.length <= 4000))) throw new Error('Invalid card content');
    if (!Array.isArray(card.dependsOn) || card.dependsOn.length > 64 || !card.dependsOn.every(id => typeof id === 'string')) throw new Error('Invalid dependency');
  }
  const visited = new Set(), visiting = new Set(), byId = new Map(cards.map(card => [card.id, card]));
  const visit = id => {
    if (!ids.has(id)) throw new Error('Missing dependency');
    if (visiting.has(id)) throw new Error('Dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  cards.forEach(card => visit(card.id));
  const stages = { ...run.stages };
  for (const card of cards) {
    const previous = run.cards?.find(item => item.id === card.id);
    if (previous && stages[card.id]?.status === 'completed' && ['skill', 'goal', 'output', 'dependsOn'].some(key => JSON.stringify(previous[key]) !== JSON.stringify(card[key]))) {
      stages[card.id] = { ...stages[card.id], status: 'pending' };
    }
  }
  return { ...run, stages, cards: cards.map(({ id, skill, title, goal, output, dependsOn }) => ({ id, skill, title, goal, output, dependsOn: [...new Set(dependsOn)] })) };
}

export function moveCard(run, id, direction) {
  const cards = [...run.cards], index = cards.findIndex(card => card.id === id), next = index + direction;
  if (index === -1 || next < 0 || next >= cards.length) return run;
  [cards[index], cards[next]] = [cards[next], cards[index]];
  return { ...run, cards };
}
