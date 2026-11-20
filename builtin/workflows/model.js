import { recipes } from './recipes.js';
import { cardsFor, replaceCards, cardState } from './deck.js';

export function skillAvailability(skill, nativeSkills) {
  const native = nativeSkills.find(item => item.name === skill.name);
  if (!native) return 'unavailable';
  const relative = native.path?.replaceAll('\\', '/').match(/(?:^|\/)(?:skills\/dsh-super-code|builtin\/skills)\/(.+)$/i)?.[1];
  if (relative !== skill.path) return 'overridden';
  return skill.userInvocable && native.userInvocable !== false ? 'ready' : 'reference';
}

export function filterSkills(skills, { query, pack, favorites, onlyFavorites }) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter(skill => (!pack || skill.pack === pack) && (!onlyFavorites || favorites.includes(skill.id))
    && terms.every(term => `${skill.name} ${skill.description} ${skill.pack}`.toLocaleLowerCase().includes(term)));
}

export function commandDraft(skill, draft, context = '') {
  const command = `/${skill.name}`;
  if (draft === command || draft.startsWith(command + ' ')) {
    const boundary = draft.indexOf('\n\n'), header = boundary === -1 ? draft : draft.slice(0, boundary);
    if (!context || !/(?:^|\n| )(?:本次流程步骤：|Workflow step: )/.test(header)) return draft;
    return `${command} ${context}\n\n${boundary === -1 ? '' : draft.slice(boundary + 2)}`;
  }
  return `${command} ${context ? context + '\n\n' : ''}${draft}`;
}

const storageKey = 'dsh-super-code.workflows.v4';
const observers = new WeakMap();
const empty = () => ({ favorites: [], recent: [], runs: {} });
const legacySteps = {
  'matt-feature': ['grilling', 'to-spec', 'prototype', 'implement-spec', 'code-review'],
  'matt-fix': ['diagnosing-bugs', 'tdd', 'code-review', 'retro'],
  'matt-research': ['research', 'domain-modeling', 'codebase-design', 'handoff'],
  'pstack-delivery': ['setup-pstack', 'architect', 'poteto-mode', 'show-me-your-work', 'reflect'],
  'pstack-quality': ['blast-radius', 'sharpen', 'technical-writing', 'show-me-your-work'],
  'openspec-change': ['openspec-explore', 'openspec-propose', 'openspec-apply-change', 'openspec-verify-change', 'openspec-archive-change'],
  'oil-design': ['task', 'structure', 'implement', 'verify'],
};
export const emptyRoute = () => ({ goal: '', stages: {} });
export const emptyStage = () => ({ status: 'pending', result: '', blocker: '', files: [] });

/** Stage acceptance is explicit; host execution never awards it. */
export function changeStage(route, stepId, stage) {
  if (stage.status === 'completed' && !stage.result.trim() && !stage.files.length) throw new Error('A result is required');
  if (stage.status === 'blocked' && !stage.blocker.trim()) throw new Error('A blocker is required');
  const stages = Object.fromEntries(Object.entries(route.stages).map(([id, value]) => [id,
    stage.status === 'active' && value.status === 'active' ? { ...value, status: 'pending' } : value]));
  stages[stepId] = { status: stage.status, result: stage.result.trim(), blocker: stage.status === 'blocked' ? stage.blocker.trim() : '', files: [...new Set(stage.files)] };
  return { ...route, stages };
}
export function nextStageIndex(recipe, route) {
  const cards = cardsFor(recipe, route);
  const active = cards.findIndex(step => cardState(step, route) === 'active');
  if (active !== -1) return active;
  return cards.findIndex(step => cardState(step, route) === 'pending');
}
function normalizeRoutes(routes, version) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) throw new Error('Invalid workflow routes');
  return Object.fromEntries(Object.entries(routes).flatMap(([id, saved]) => {
    const recipe = recipes.find(recipe => recipe.id === id);
    if (version < 3) {
      if (!Array.isArray(saved) || !saved.every(step => version === 1 ? Number.isSafeInteger(step) && step >= 0 : typeof step === 'string')) throw new Error('Invalid workflow steps');
      if (!recipe && id !== 'oil-design') return [];
      const completed = version === 1 ? saved.map(index => legacySteps[id]?.[index]) : saved;
      return [[id, { goal: '', stages: Object.fromEntries((recipe?.steps || legacySteps[id].map(id => ({ id }))).filter(step => completed.includes(step.id)).map(step => [step.id, { ...emptyStage(), status: 'completed', legacy: true }])) }]];
    }
    if (!saved || typeof saved.goal !== 'string' || saved.goal.length > 4000 || !saved.stages || typeof saved.stages !== 'object' || Array.isArray(saved.stages)) throw new Error('Invalid workflow record');
    // Removed workflow pages remain readable in storage; hiding a page must not erase its history.
    if (!recipe) return [[id, saved]];
    const definitions = saved.cards ? replaceCards(saved, saved.cards, recipe.pack) : saved;
    const cards = cardsFor(recipe, definitions);
    const stages = Object.fromEntries(Object.entries(saved.stages).filter(([id]) => cards.some(step => step.id === id)).map(([id, value]) => {
      if (!value || !['pending', 'active', 'blocked', 'completed'].includes(value.status)
        || !['result', 'blocker'].every(key => typeof value[key] === 'string' && value[key].length <= 4000)
        || !Array.isArray(value.files) || value.files.length > 16 || !value.files.every(path => typeof path === 'string' && path.length > 0 && path.length <= 4096)) throw new Error('Invalid workflow stage');
      return [id, { status: value.status, result: value.result, blocker: value.blocker, files: [...new Set(value.files)], ...(value.legacy === true ? { legacy: true } : {}) }];
    }));
    return [[id, { goal: saved.goal, stages, ...(saved.cards ? { cards: definitions.cards } : {}) }]];
  }));
}
export function readPreferences(storage) {
  const versions = [4, 3, 2, 1].map(version => ({ version, raw: storage.getItem(`dsh-super-code.workflows.v${version}`) }));
  const saved = versions.find(item => item.raw !== null);
  if (!saved) return empty();
  const value = JSON.parse(saved.raw);
  if (!value || !['favorites', 'recent'].every(key => Array.isArray(value[key]) && value[key].every(id => typeof id === 'string'))
    || !value.runs || typeof value.runs !== 'object' || Array.isArray(value.runs)
    || Object.values(value.runs).some(run => !run || typeof run.recipe !== 'string')) throw new Error('Invalid workflow preferences');
  return { favorites: [...new Set(value.favorites)], recent: [...new Set(value.recent)].slice(0, 12),
    runs: Object.fromEntries(Object.entries(value.runs).slice(-32).flatMap(([session, run]) => {
      const routes = normalizeRoutes(saved.version === 1 ? { [run.recipe]: run.completed } : run.routes, saved.version);
      const recipe = recipes.some(recipe => recipe.id === run.recipe) ? run.recipe : Object.keys(routes)[0];
      return recipe ? [[session, { recipe, routes }]] : [];
    })) };
}
export function recordProgress(preferences, sessionId, recipeId, route) {
  const previous = preferences.runs[sessionId];
  const runs = Object.fromEntries(Object.entries(preferences.runs).filter(([id]) => id !== sessionId).slice(-31));
  return { ...preferences, runs: { ...runs, [sessionId]: { recipe: recipeId, routes: { ...Object.fromEntries(Object.entries(previous?.routes || {}).filter(([id]) => id !== recipeId)), [recipeId]: route } } } };
}
export function savePreferences(storage, value) {
  storage.setItem(storageKey, JSON.stringify(value));
  for (const listener of observers.get(storage) || []) listener();
  return value;
}
export function subscribePreferences(storage, listener) {
  if (!observers.has(storage)) observers.set(storage, new Set());
  const listeners = observers.get(storage);
  listeners.add(listener);
  const external = event => { if (event.storageArea === storage && event.key === storageKey) listener(); };
  globalThis.addEventListener?.('storage', external);
  return () => { listeners.delete(listener); globalThis.removeEventListener?.('storage', external); };
}
export function initialPreferences(storage) {
  try { return { value: readPreferences(storage), error: false }; }
  catch { return { value: empty(), error: true }; }
}
