/** Declarative composition of PixieCore's trusted bundled plugin catalog. */
/**
 * Describes the plugin recipe definition contract.
 */
export interface PluginRecipeDefinition {
  readonly schema: 'pixiecore.recipe/v1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly locked: true;
  readonly plugins: readonly string[];
  readonly activate: readonly string[];
}

/** Validated recipe state that is safe to apply to one PluginManager scope. */
export interface PluginRecipeActivationPlan {
  readonly recipeId: string;
  readonly locked: true;
  readonly pluginIds: readonly string[];
  readonly activationRootIds: readonly string[];
}

/** Scope-local service contributed by the mandatory Recipe bootstrap plugin. */
export interface RecipeServicePort {
  /**
   * Handles standard recipe for the owning PixieCore boundary.
   */
  standardRecipe(): PluginRecipeDefinition;
}
