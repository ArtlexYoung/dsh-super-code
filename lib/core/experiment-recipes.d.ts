/** Documentation only: experiments run in task-owned shell scripts, never here. */
export declare const EXPERIMENT_RECIPES: readonly ["reduce", "differential", "interleavings", "metamorphic"];
export type ExperimentRecipe = typeof EXPERIMENT_RECIPES[number];
export declare function readExperimentRecipe(recipe: ExperimentRecipe): string;
//# sourceMappingURL=experiment-recipes.d.ts.map