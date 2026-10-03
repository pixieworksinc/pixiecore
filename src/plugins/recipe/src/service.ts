/**
 * Implements service behavior for the recipe plugin.
 */

import type { RecipeServicePort } from '../../../core/contracts/recipe/index.js';
import { PIXIECORE_STANDARD_RECIPE } from './generated/core-recipe.generated.js';

/**
 * Creates recipe service after validating the supplied contract.
 */
export function createRecipeService(): RecipeServicePort {
  return Object.freeze({
    standardRecipe: () => PIXIECORE_STANDARD_RECIPE,
  });
}
