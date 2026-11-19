import { recipes } from './recipes.js';

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

const storageKey = 'dsh-super-code.workflows.v2';
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
function normalizeRoutes(routes, legacy) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) throw new Error('Invalid workflow routes');
  return Object.fromEntries(Object.entries(routes).flatMap(([id, completed]) => {
    const valid = step => legacy ? Number.isSafeInteger(step) && step >= 0 : typeof step === 'string';
    if (!Array.isArray(completed) || !completed.every(valid)) throw new Error('Invalid workflow steps');
    const recipe = recipes.find(recipe => recipe.id === id);
    if (!recipe) return [];
    const ids = legacy ? completed.map(index => legacySteps[id]?.[index]) : completed;
    return [[id, recipe.steps.filter(step => ids.includes(step.id)).map(step => step.id)]];
  }));
}
export function readPreferences(storage) {
  const current = storage.getItem(storageKey), saved = current ?? storage.getItem('dsh-super-code.workflows.v1');
  if (!saved) return empty();
  const value = JSON.parse(saved);
  if (!value || !['favorites', 'recent'].every(key => Array.isArray(value[key]) && value[key].every(id => typeof id === 'string'))
    || !value.runs || typeof value.runs !== 'object' || Array.isArray(value.runs)
    || Object.values(value.runs).some(run => !run || typeof run.recipe !== 'string')) throw new Error('Invalid workflow preferences');
  return { favorites: [...new Set(value.favorites)], recent: [...new Set(value.recent)].slice(0, 12),
    runs: Object.fromEntries(Object.entries(value.runs).slice(-32).flatMap(([session, run]) => {
      const routes = normalizeRoutes(current === null ? { [run.recipe]: run.completed } : run.routes, current === null);
      const recipe = recipes.some(recipe => recipe.id === run.recipe) ? run.recipe : Object.keys(routes)[0];
      return recipe ? [[session, { recipe, routes }]] : [];
    })) };
}
export function recordProgress(preferences, sessionId, recipeId, completed) {
  const previous = preferences.runs[sessionId];
  const runs = Object.fromEntries(Object.entries(preferences.runs).filter(([id]) => id !== sessionId).slice(-31));
  return { ...preferences, runs: { ...runs, [sessionId]: { recipe: recipeId, routes: { ...previous?.routes, [recipeId]: completed } } } };
}
export function savePreferences(storage, value) {
  storage.setItem(storageKey, JSON.stringify(value));
  return value;
}
export function initialPreferences(storage) {
  try { return { value: readPreferences(storage), error: false }; }
  catch { return { value: empty(), error: true }; }
}
