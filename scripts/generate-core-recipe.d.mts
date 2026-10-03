/** Options accepted by side-effect-free core Recipe generation. */
export interface CoreRecipeOptions {
  readonly root?: string;
  readonly mode?: 'write' | 'check';
}

/** Result shared by the generator CLI and direct tests. */
export interface CoreRecipeResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

/** Runs Recipe generation without process or console side effects. */
export function runCoreRecipe(options?: CoreRecipeOptions): Promise<CoreRecipeResult>;
