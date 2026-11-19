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
  if (draft === command || draft.startsWith(command + ' ')) return draft;
  return `${command} ${context ? context + '\n\n' : ''}${draft}`;
}

const storageKey = 'dsh-super-code.workflows.v1';
const empty = () => ({ favorites: [], recent: [], runs: {} });
export function readPreferences(storage) {
  const saved = storage.getItem(storageKey);
  if (!saved) return empty();
  const value = JSON.parse(saved);
  if (!value || !['favorites', 'recent'].every(key => Array.isArray(value[key]) && value[key].every(id => typeof id === 'string'))
    || !value.runs || typeof value.runs !== 'object' || Array.isArray(value.runs)
    || Object.values(value.runs).some(run => !run || typeof run.recipe !== 'string' || !Array.isArray(run.completed)
      || run.completed.some(step => !Number.isSafeInteger(step) || step < 0))) throw new Error('Invalid workflow preferences');
  return { favorites: [...new Set(value.favorites)], recent: [...new Set(value.recent)].slice(0, 12),
    runs: Object.fromEntries(Object.entries(value.runs).slice(-32).flatMap(([session, run]) => {
      const recipe = recipes.find(recipe => recipe.id === run.recipe);
      return recipe ? [[session, { recipe: run.recipe, completed: [...new Set(run.completed.filter(step => step < recipe.steps.length))] }]] : [];
    })) };
}
export function savePreferences(storage, value) {
  storage.setItem(storageKey, JSON.stringify(value));
  return value;
}
export function initialPreferences(storage) {
  try { return { value: readPreferences(storage), error: false }; }
  catch { return { value: empty(), error: true }; }
}
