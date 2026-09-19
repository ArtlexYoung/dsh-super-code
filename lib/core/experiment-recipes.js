/** Documentation only: experiments run in task-owned shell scripts, never here. */
export const EXPERIMENT_RECIPES = ['reduce', 'differential', 'interleavings', 'metamorphic'];
const examples = {
    reduce: `const probe = xs => xs.filter(x => x === 2).length > 1
  ? {kind:'fail', signature:'duplicate-two'} : {kind:'pass'};
const result = await reduceFailure([0,2,8,2,9], 'duplicate-two', probe, budget);
const {input,...summary}=result;
console.log(JSON.stringify({...summary,inputLength:input.length,inputPreview:input.slice(0,8)}));`,
    differential: `// Independent reference: sum retains duplicates; this candidate incorrectly drops them.
const sum = xs => xs.reduce((a,b) => a+b, 0);
const probe = differential(sum, xs => sum([...new Set(xs)]));
const result = await findCounterexample([[0,1], [0,2,8,2,9]], probe, budget);
// A general difference does not identify the original fault; do not auto-reduce it.
const {input,verdict,...summary}=result;
console.log(JSON.stringify({...summary,...(input ? {inputLength:input.length,inputPreview:input.slice(0,8)} : {}),
  ...(verdict ? {signature:verdict.signature} : {})}));`,
    interleavings: `// Explicit start/completion boundaries, two requests, fresh state per trial.
async function observe(schedule, guarded) {
  let version=0, latest=-1, visible=-1;
  const gates=[Promise.withResolvers(), Promise.withResolvers()], jobs=[];
  for (const {lane,index} of schedule) {
    if (index===0) {
      const token=++version; latest=lane;
      jobs[lane]=(async()=>{ await gates[lane].promise;
        if (!guarded || token===version) visible=lane; })();
    } else { gates[lane].resolve(); await jobs[lane]; }
  }
  return {latest,visible};
}
const schedules=interleavings(2,2,6);
const probe=differential(s=>observe(s,true), s=>observe(s,false));
const result=await findCounterexample(schedules,probe,budget);
const {input,verdict,...summary}=result;
console.log(JSON.stringify({coverage:schedules.coverage,...summary,
  ...(input ? {inputLength:input.length,inputPreview:input.slice(0,8)} : {}),...(verdict ? {signature:verdict.signature} : {})}));`,
    metamorphic: `// Contract: a sum is invariant under permutation. The candidate violates it.
const probe=metamorphic('sum-permutation', xs=>xs[0], xs=>xs.reverse(), (a,b)=>a===b);
const result=await findCounterexample([[1,2,3]],probe,budget);
const {input,verdict,...summary}=result;
console.log(JSON.stringify({...summary,...(input ? {inputLength:input.length,inputPreview:input.slice(0,8)} : {}),
  ...(verdict ? {signature:verdict.signature} : {})}));`,
};
const imports = {
    reduce: 'reduceFailure', differential: 'differential, findCounterexample',
    interleavings: 'interleavings, differential, findCounterexample', metamorphic: 'metamorphic, findCounterexample',
};
const notes = {
    reduce: 'Use a task-specific failure predicate/signature. Confirmation runs twice and counts toward budget. one-removal assumes repeatable probes; it is not a global minimum or proof of the same root cause.',
    differential: 'Use an independent, trusted reference. Each probe runs two observations. checked covers supplied samples only. behavior-difference identifies any mismatch, not one fault; reduce only with a task-specific predicate/signature, otherwise report a difference witness.',
    interleavings: 'Control real await boundaries with barriers, not sleeps; reset state per schedule. Two ordered lanes, at most 256 steps. coverage describes enumeration, not checked schedules; search stops at the first difference. Each differential probe runs two observations.',
    metamorphic: 'Derive the transform/relation from a real contract. Each probe runs two observations. checked covers supplied samples only; a relation violation does not identify its root cause.',
};
export function readExperimentRecipe(recipe) {
    if (!Object.hasOwn(examples, recipe))
        throw new Error('Unknown experiment recipe');
    const moduleUrl = new URL('../experiments.js', import.meta.url).href;
    return `Experiment: ${recipe}
Module: ${moduleUrl}
Demo, not project evidence. Adapt to authorized, repeatable checks with isolated state and cloneable data. Run in foreground bash with timeoutMs (e.g. 10000); library deadlines/abort are cooperative, not hard interruption. Share one probe budget per batch. Exceptions propagate; unknown/stopped are not pass. Array previews show at most 8 entries; full data stays in result. Save large reports to task files; avoid printing large entries.
${notes[recipe]}
\`\`\`js
import { ExperimentBudget, ${imports[recipe]} } from ${JSON.stringify(moduleUrl)};
const budget=new ExperimentBudget({maxChecks:100,timeoutMs:2000});
${examples[recipe]}
\`\`\``;
}
//# sourceMappingURL=experiment-recipes.js.map